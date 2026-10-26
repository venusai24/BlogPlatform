function loadConfig(env = {}) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try {
    let config;
    jest.isolateModules(() => { config = require('../index'); });
    return config;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

describe('AUTH_PROVIDER config', () => {
  let exit;
  let write;
  beforeEach(() => {
    exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
    write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    exit.mockRestore();
    write.mockRestore();
  });

  it('defaults to the app provider with no Cognito settings', () => {
    const config = loadConfig();
    expect(config.authProvider).toBe('app');
    expect(config.cognitoUserPoolId).toBeUndefined();
    expect(exit).not.toHaveBeenCalled();
  });

  it('reads the Cognito settings', () => {
    const config = loadConfig({ AUTH_PROVIDER: 'cognito', COGNITO_USER_POOL_ID: 'ap-south-1_abc', COGNITO_CLIENT_ID: 'c1' });
    expect(config.authProvider).toBe('cognito');
    expect(config.cognitoUserPoolId).toBe('ap-south-1_abc');
    expect(config.cognitoClientId).toBe('c1');
    expect(exit).not.toHaveBeenCalled();
  });

  it('exits 1 on an unknown provider', () => {
    loadConfig({ AUTH_PROVIDER: 'okta' });
    expect(exit).toHaveBeenCalledWith(1);
  });

  it.each([
    [{ COGNITO_USER_POOL_ID: undefined, COGNITO_CLIENT_ID: 'c1' }],
    [{ COGNITO_USER_POOL_ID: 'ap-south-1_abc', COGNITO_CLIENT_ID: undefined }]
  ])('exits 1 when the cognito provider is missing a setting (%j)', (missing) => {
    loadConfig({ AUTH_PROVIDER: 'cognito', ...missing });
    expect(exit).toHaveBeenCalledWith(1);
  });
});
