jest.mock('../logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const logger = require('../logger');
const config = require('../../config');
const faults = require('../faults');

describe('faults', () => {
  const original = { nodeEnv: config.nodeEnv, faults: { ...config.faults } };
  beforeEach(() => {
    jest.clearAllMocks();
    config.nodeEnv = 'test';
    config.faults = { enabled: false, embedErrorRate: 0, llmErrorRate: 0, relayPause: false };
  });
  afterAll(() => {
    config.nodeEnv = original.nodeEnv;
    config.faults = original.faults;
  });

  describe('maybeFail', () => {
    it('throws at rate 1', () => {
      config.faults.embedErrorRate = 1;
      expect(() => faults.maybeFail('embed', () => 0.999)).toThrow(faults.FaultInjectedError);
    });

    it('never throws at rate 0', () => {
      for (let i = 0; i < 100; i++) {
        expect(() => faults.maybeFail('embed', () => 0)).not.toThrow();
        expect(() => faults.maybeFail('llm', () => 0)).not.toThrow();
      }
    });

    it('throws when the roll is below the rate and not otherwise', () => {
      config.faults.llmErrorRate = 0.5;
      expect(() => faults.maybeFail('llm', () => 0.49)).toThrow();
      expect(() => faults.maybeFail('llm', () => 0.5)).not.toThrow();
      expect(() => faults.maybeFail('llm', () => 0.9)).not.toThrow();
    });

    it('embed fault is named ThrottlingException', () => {
      config.faults.embedErrorRate = 1;
      try {
        faults.maybeFail('embed', () => 0);
        throw new Error('did not throw');
      } catch (err) {
        expect(err.name).toBe('ThrottlingException');
        expect(err).toBeInstanceOf(faults.FaultInjectedError);
      }
    });

    it('llm fault is named FaultInjectedError', () => {
      config.faults.llmErrorRate = 1;
      try {
        faults.maybeFail('llm', () => 0);
        throw new Error('did not throw');
      } catch (err) {
        expect(err.name).toBe('FaultInjectedError');
      }
    });

    it('logs every injected fault', () => {
      config.faults.embedErrorRate = 1;
      expect(() => faults.maybeFail('embed', () => 0)).toThrow();
      expect(logger.warn).toHaveBeenCalledWith({ fault: 'embed' }, 'fault injected');
    });

    it('the two kinds are independent', () => {
      config.faults.embedErrorRate = 1;
      expect(() => faults.maybeFail('llm', () => 0)).not.toThrow();
    });

    it('rejects an unknown kind', () => {
      expect(() => faults.maybeFail('disk')).toThrow(/Unknown fault kind/);
    });
  });

  describe('production guard', () => {
    it('ignored in production unless enabled', () => {
      config.nodeEnv = 'production';
      config.faults = { enabled: false, embedErrorRate: 1, llmErrorRate: 1, relayPause: true };

      expect(() => faults.maybeFail('embed', () => 0)).not.toThrow();
      expect(() => faults.maybeFail('llm', () => 0)).not.toThrow();
      expect(faults.relayPaused()).toBe(false);
    });

    it('honoured in production once explicitly enabled', () => {
      config.nodeEnv = 'production';
      config.faults = { enabled: true, embedErrorRate: 1, llmErrorRate: 0, relayPause: true };

      expect(() => faults.maybeFail('embed', () => 0)).toThrow();
      expect(faults.relayPaused()).toBe(true);
    });

    it('applies outside production without needing the enabled flag', () => {
      config.nodeEnv = 'development';
      config.faults = { enabled: false, embedErrorRate: 1, llmErrorRate: 0, relayPause: false };

      expect(() => faults.maybeFail('embed', () => 0)).toThrow();
    });
  });

  describe('relayPaused', () => {
    it('is false by default and true when FAULT_RELAY_PAUSE is set', () => {
      expect(faults.relayPaused()).toBe(false);
      config.faults.relayPause = true;
      expect(faults.relayPaused()).toBe(true);
    });
  });

  describe('startup warning', () => {
    function loadWith({ nodeEnv, env }) {
      const saved = {};
      for (const [k, v] of Object.entries({ NODE_ENV: nodeEnv, ...env })) {
        saved[k] = process.env[k];
        process.env[k] = v;
      }
      try {
        let log;
        jest.isolateModules(() => {
          jest.doMock('../logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
          require('../faults');
          log = require('../logger');
        });
        return log;
      } finally {
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
      }
    }

    it('logs an error once when production ignores fault settings', () => {
      const log = loadWith({ nodeEnv: 'production', env: { FAULT_EMBED_ERROR_RATE: '0.5' } });
      expect(log.error).toHaveBeenCalledTimes(1);
      expect(log.error.mock.calls[0][1]).toMatch(/ignored/i);
    });

    it('stays quiet when nothing is set', () => {
      const log = loadWith({ nodeEnv: 'production', env: {} });
      expect(log.error).not.toHaveBeenCalled();
    });

    it('stays quiet when production has faults explicitly enabled', () => {
      const log = loadWith({ nodeEnv: 'production', env: { FAULT_INJECTION_ENABLED: 'true', FAULT_EMBED_ERROR_RATE: '0.5' } });
      expect(log.error).not.toHaveBeenCalled();
    });
  });
});
