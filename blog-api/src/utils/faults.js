// Fault injection for resilience experiments (ADR-015). Everything is config-driven and off by default.
//
//   FAULT_EMBED_ERROR_RATE   0-1, share of embed() calls that fail like Bedrock throttling
//   FAULT_LLM_ERROR_RATE     0-1, share of chat() calls that fail
//   FAULT_RELAY_PAUSE        true, the outbox relay stops claiming records
//
// In production these are ignored unless FAULT_INJECTION_ENABLED=true, so a leftover setting cannot
// degrade a real deployment.
const config = require('../config');
const logger = require('./logger');

class FaultInjectedError extends Error {
  constructor(kind) {
    super(`Injected ${kind} fault`);
    // The embed fault mimics what Bedrock returns when it throttles, so retry handling is exercised.
    this.name = kind === 'embed' ? 'ThrottlingException' : 'FaultInjectedError';
    this.fault = kind;
  }
}

// config.faults filtered through the production guard.
function effective() {
  const { faults, nodeEnv } = config;
  if (nodeEnv === 'production' && !faults.enabled) {
    return { enabled: false, embedErrorRate: 0, llmErrorRate: 0, relayPause: false };
  }
  return faults;
}

const RATE_KEY = { embed: 'embedErrorRate', llm: 'llmErrorRate' };

// Throws a FaultInjectedError with probability equal to the configured rate for `kind`.
function maybeFail(kind, random = Math.random) {
  const key = RATE_KEY[kind];
  if (!key) throw new Error(`Unknown fault kind: ${kind}`);
  const rate = effective()[key];
  if (rate > 0 && random() < rate) {
    logger.warn({ fault: kind }, 'fault injected');
    throw new FaultInjectedError(kind);
  }
}

function relayPaused() {
  return effective().relayPause;
}

// Said once at startup: someone set a fault in production without the explicit opt-in.
const { faults, nodeEnv } = config;
if (nodeEnv === 'production' && !faults.enabled && (faults.embedErrorRate > 0 || faults.llmErrorRate > 0 || faults.relayPause)) {
  logger.error(
    { embedErrorRate: faults.embedErrorRate, llmErrorRate: faults.llmErrorRate, relayPause: faults.relayPause },
    'Fault injection settings are ignored in production because FAULT_INJECTION_ENABLED is not true'
  );
}

module.exports = { maybeFail, relayPaused, FaultInjectedError };
