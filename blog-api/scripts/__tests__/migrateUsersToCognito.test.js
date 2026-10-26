const mockSend = jest.fn();

jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({ send: (...args) => mockSend(...args) })),
  AdminCreateUserCommand: jest.fn(input => ({ input }))
}));

const { buildCreateUserCommand, generateTemporaryPassword, migrate } = require('../migrateUsersToCognito');

const POOL = 'ap-south-1_abc123';

describe('migrateUsersToCognito', () => {
  beforeEach(() => {
    mockSend.mockReset().mockResolvedValue({});
  });

  describe('buildCreateUserCommand', () => {
    it('creates the user with a temporary password and no email', () => {
      const command = buildCreateUserCommand('alice', 'T', POOL);

      expect(command.input).toEqual({
        UserPoolId: POOL,
        Username: 'alice',
        TemporaryPassword: 'T',
        MessageAction: 'SUPPRESS'
      });
    });
  });

  describe('generateTemporaryPassword', () => {
    it('meets the pool password policy (12+ characters, lower, upper, number)', () => {
      for (let i = 0; i < 200; i++) {
        const password = generateTemporaryPassword();
        expect(password.length).toBeGreaterThanOrEqual(12);
        expect(password).toMatch(/[a-z]/);
        expect(password).toMatch(/[A-Z]/);
        expect(password).toMatch(/\d/);
      }
    });

    it('is different every time', () => {
      expect(new Set(Array.from({ length: 50 }, generateTemporaryPassword)).size).toBe(50);
    });
  });

  describe('migrate', () => {
    const users = [{ username: 'alice' }, { username: 'bob' }];

    it('dry run sends nothing and prints no passwords', async () => {
      const out = [];

      const result = await migrate({ users, userPoolId: POOL, apply: false, write: line => out.push(line) });

      expect(mockSend).not.toHaveBeenCalled();
      expect(result).toEqual({ created: 0, skipped: 0, wouldCreate: 2 });
      expect(out.join('\n')).toMatch(/dry run/i);
      expect(out.join('\n')).not.toMatch(/temporaryPassword/i);
    });

    it('--apply creates every user and prints username,temporaryPassword CSV to the output only', async () => {
      const out = [];

      const result = await migrate({ users, userPoolId: POOL, apply: true, write: line => out.push(line) });

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ created: 2, skipped: 0, wouldCreate: 0 });
      expect(out[0]).toBe('username,temporaryPassword');
      expect(out[1]).toMatch(/^alice,.{12,}$/);
      expect(out[2]).toMatch(/^bob,.{12,}$/);
      const sentPassword = mockSend.mock.calls[0][0].input.TemporaryPassword;
      expect(out[1]).toBe(`alice,${sentPassword}`);
    });

    it('skips users that already exist and does not print a password for them', async () => {
      mockSend.mockRejectedValueOnce(Object.assign(new Error('exists'), { name: 'UsernameExistsException' }));
      const out = [];

      const result = await migrate({ users, userPoolId: POOL, apply: true, write: line => out.push(line) });

      expect(result).toEqual({ created: 1, skipped: 1, wouldCreate: 0 });
      expect(out.join('\n')).not.toContain('alice,');
      expect(out.join('\n')).toContain('bob,');
    });

    it('stops on any other error', async () => {
      mockSend.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));

      await expect(migrate({ users, userPoolId: POOL, apply: true, write: () => {} })).rejects.toThrow('denied');
    });
  });
});
