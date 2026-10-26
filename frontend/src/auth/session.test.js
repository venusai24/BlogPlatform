describe('session', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    localStorage.clear();
    jest.resetModules();
  });

  describe('app provider (the default)', () => {
    const load = () => {
      delete process.env.REACT_APP_AUTH_PROVIDER;
      return require('./session');
    };

    it('reads the token and username from localStorage', () => {
      localStorage.setItem('token', 't1');
      localStorage.setItem('username', 'alice');
      const session = load();

      expect(session.getToken()).toBe('t1');
      expect(session.getUsername()).toBe('alice');
      expect(session.isLoggedIn()).toBe(true);
      expect(session.isCognito()).toBe(false);
    });

    it('is logged out without both', () => {
      localStorage.setItem('token', 't1');
      expect(load().isLoggedIn()).toBe(false);
    });

    it('clearSession removes both', () => {
      localStorage.setItem('token', 't1');
      localStorage.setItem('username', 'alice');
      const session = load();

      session.clearSession();

      expect(localStorage.getItem('token')).toBeNull();
      expect(localStorage.getItem('username')).toBeNull();
    });
  });

  describe('cognito provider', () => {
    const load = (oidc) => {
      process.env.REACT_APP_AUTH_PROVIDER = 'cognito';
      jest.doMock('./oidc', () => oidc);
      return require('./session');
    };

    it('asks the OIDC module, ignoring localStorage', () => {
      localStorage.setItem('token', 'stale-app-token');
      const session = load({ getAccessToken: () => 'cognito-token', getUsername: () => 'alice', logout: jest.fn() });

      expect(session.getToken()).toBe('cognito-token');
      expect(session.getUsername()).toBe('alice');
      expect(session.isLoggedIn()).toBe(true);
      expect(session.isCognito()).toBe(true);
    });

    it('is logged out when the OIDC module has no user', () => {
      const session = load({ getAccessToken: () => null, getUsername: () => null, logout: jest.fn() });
      expect(session.isLoggedIn()).toBe(false);
    });

    it('signOut ends the Cognito session', () => {
      const oidc = { getAccessToken: () => 't', getUsername: () => 'a', logout: jest.fn() };
      load(oidc).signOut();
      expect(oidc.logout).toHaveBeenCalledTimes(1);
    });
  });

  it('signOut in app mode clears storage and does not touch Cognito', () => {
    delete process.env.REACT_APP_AUTH_PROVIDER;
    localStorage.setItem('token', 't1');
    localStorage.setItem('username', 'alice');
    const session = require('./session');

    session.signOut();

    expect(localStorage.getItem('token')).toBeNull();
  });
});
