const AUTHORITY = 'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_abc123';
const ENV = {
  REACT_APP_COGNITO_REGION: 'ap-south-1',
  REACT_APP_COGNITO_USER_POOL_ID: 'ap-south-1_abc123',
  REACT_APP_COGNITO_CLIENT_ID: 'client-1',
  REACT_APP_COGNITO_DOMAIN: 'https://bp-prod-789012.auth.ap-south-1.amazoncognito.com'
};

const fakeJwt = (claims) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`;
};

function load() {
  const mocks = {
    manager: {
      signinRedirect: jest.fn().mockResolvedValue(),
      signinRedirectCallback: jest.fn().mockResolvedValue({ access_token: 'a' }),
      removeUser: jest.fn().mockResolvedValue()
    },
    UserManager: jest.fn(),
    WebStorageStateStore: jest.fn()
  };
  mocks.UserManager.mockImplementation(() => mocks.manager);
  let oidc;
  jest.isolateModules(() => {
    jest.doMock('oidc-client-ts', () => ({ UserManager: mocks.UserManager, WebStorageStateStore: mocks.WebStorageStateStore }));
    oidc = require('./oidc');
  });
  return { oidc, ...mocks };
}

describe('oidc', () => {
  const saved = { ...process.env };
  const realLocation = window.location;
  beforeEach(() => {
    Object.assign(process.env, ENV);
    sessionStorage.clear();
    delete window.location;
    window.location = { origin: 'https://app.example.click', assign: jest.fn() };
  });
  afterEach(() => {
    process.env = { ...saved };
    window.location = realLocation;
  });

  it('configures the code flow against the Cognito issuer, with tokens kept in sessionStorage', async () => {
    const { oidc, UserManager, WebStorageStateStore } = load();
    await oidc.login(); // the manager is created on first use, so email/password builds never construct one

    expect(UserManager).toHaveBeenCalledWith(expect.objectContaining({
      authority: AUTHORITY,
      client_id: 'client-1',
      redirect_uri: 'https://app.example.click/callback',
      post_logout_redirect_uri: 'https://app.example.click/login',
      response_type: 'code',
      scope: 'openid profile'
    }));
    expect(WebStorageStateStore).toHaveBeenCalledWith({ store: window.sessionStorage });
  });

  it('login() redirects to Cognito managed login', async () => {
    const { oidc, manager } = load();
    await oidc.login();
    expect(manager.signinRedirect).toHaveBeenCalledTimes(1);
  });

  it('handleCallback() completes the sign-in', async () => {
    const { oidc, manager } = load();
    await expect(oidc.handleCallback()).resolves.toEqual({ access_token: 'a' });
    expect(manager.signinRedirectCallback).toHaveBeenCalledTimes(1);
  });

  it('logout() clears the local user, then ends the Cognito session at its /logout endpoint', async () => {
    const { oidc, manager } = load();

    await oidc.logout();

    expect(manager.removeUser).toHaveBeenCalledTimes(1);
    expect(window.location.assign).toHaveBeenCalledWith(
      `${ENV.REACT_APP_COGNITO_DOMAIN}/logout?client_id=client-1&logout_uri=${encodeURIComponent('https://app.example.click/login')}`
    );
    expect(manager.removeUser.mock.invocationCallOrder[0]).toBeLessThan(window.location.assign.mock.invocationCallOrder[0]);
  });

  describe('getAccessToken / getUsername', () => {
    const key = `oidc.user:${AUTHORITY}:client-1`;
    const store = (user) => sessionStorage.setItem(key, JSON.stringify(user));
    const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

    it('reads the signed-in user synchronously from sessionStorage', () => {
      const token = fakeJwt({ username: 'alice', sub: 'sub-1' });
      store({ access_token: token, expires_at: inAnHour() });
      const { oidc } = load();

      expect(oidc.getAccessToken()).toBe(token);
      expect(oidc.getUsername()).toBe('alice');
    });

    it('returns null when nobody is signed in', () => {
      const { oidc } = load();
      expect(oidc.getAccessToken()).toBeNull();
      expect(oidc.getUsername()).toBeNull();
    });

    it('treats an expired token as signed out', () => {
      store({ access_token: fakeJwt({ username: 'alice' }), expires_at: Math.floor(Date.now() / 1000) - 10 });
      const { oidc } = load();
      expect(oidc.getAccessToken()).toBeNull();
      expect(oidc.getUsername()).toBeNull();
    });

    it('survives corrupt storage', () => {
      sessionStorage.setItem(key, 'not json');
      const { oidc } = load();
      expect(oidc.getAccessToken()).toBeNull();
    });
  });
});
