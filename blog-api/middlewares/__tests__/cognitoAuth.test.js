const mockVerify = jest.fn();

jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: jest.fn(() => ({ verify: (...args) => mockVerify(...args) })) }
}));
jest.mock('../../src/config', () => ({ cognitoUserPoolId: 'ap-south-1_abc123', cognitoClientId: 'client-1' }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { CognitoJwtVerifier } = require('aws-jwt-verify');
const cognitoAuth = require('../cognitoAuth');

function run(headers) {
  return new Promise((resolve) => {
    const req = { headers };
    const res = {
      status: jest.fn(function () { return this; }),
      json: jest.fn(() => resolve({ req, res, next })),
    };
    const next = jest.fn(() => resolve({ req, res, next }));
    cognitoAuth(req, res, next);
  });
}

describe('cognitoAuth', () => {
  beforeEach(() => mockVerify.mockReset());

  it('verifies access tokens for the configured pool and client', () => {
    expect(CognitoJwtVerifier.create).toHaveBeenCalledWith({
      userPoolId: 'ap-south-1_abc123',
      tokenUse: 'access',
      clientId: 'client-1'
    });
  });

  it('sets req.user from the access token claims', async () => {
    mockVerify.mockResolvedValue({ sub: 'sub-123', username: 'alice', token_use: 'access' });

    const { req, next } = await run({ authorization: 'Bearer good.token' });

    expect(mockVerify).toHaveBeenCalledWith('good.token');
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({ userId: 'sub-123', username: 'alice' });
  });

  it('401 without a token', async () => {
    const { res, next } = await run({});

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('401 for an Authorization header that is not a bearer token', async () => {
    const { res } = await run({ authorization: 'Basic abc' });
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('403 when verification throws', async () => {
    mockVerify.mockRejectedValue(new Error('Token expired'));

    const { res, next } = await run({ authorization: 'Bearer bad.token' });

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('does not leak why verification failed', async () => {
    mockVerify.mockRejectedValue(new Error('JWT signature invalid for key abc'));

    const { res } = await run({ authorization: 'Bearer bad.token' });

    expect(JSON.stringify(res.json.mock.calls)).not.toContain('signature');
  });
});
