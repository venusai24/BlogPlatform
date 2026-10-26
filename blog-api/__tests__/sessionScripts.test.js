const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = ['up.sh', 'down.sh', 'status.sh'].map(name => path.join(ROOT, 'scripts', 'session', name));
const NOW = Date.parse('2026-10-17T12:00:00Z') / 1000;

// A fake `aws` on the PATH that answers the three read-only calls status.sh makes, from env vars.
function fakeAws() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-aws-'));
  const script = `#!/usr/bin/env bash
echo "$@" >> "$FAKE_AWS_LOG"
case "$*" in
  *get-resources*Layer*) 
    case "$*" in
      *"length(ResourceTagMappingList)"*) echo "\${FAKE_TAGGED_COUNT:-0}" ;;
      *Session*) echo "\${FAKE_SESSION_TAG:-None}" ;;
      *) echo "unexpected: $*" >&2; exit 2 ;;
    esac ;;
  *describe-nat-gateways*) echo "\${FAKE_NAT_COUNT:-0}" ;;
  *describe-load-balancers*) echo "\${FAKE_ALB_COUNT:-0}" ;;
  *) echo "unexpected aws call: $*" >&2; exit 2 ;;
esac
`;
  fs.writeFileSync(path.join(dir, 'aws'), script, { mode: 0o755 });
  return dir;
}

function runStatus(env = {}) {
  const dir = fakeAws();
  const log = path.join(dir, 'calls.log');
  const result = spawnSync('bash', [path.join(ROOT, 'scripts', 'session', 'status.sh')], {
    env: { PATH: `${dir}:${process.env.PATH}`, FAKE_AWS_LOG: log, NOW_EPOCH: String(NOW), ...env },
    encoding: 'utf8'
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  fs.rmSync(dir, { recursive: true, force: true });
  return { ...result, calls };
}

describe('session scripts', () => {
  it.each(SCRIPTS)('%s exists and parses (bash -n)', (script) => {
    expect(fs.existsSync(script)).toBe(true);
    const result = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it.each(SCRIPTS)('%s fails on errors and unset variables', (script) => {
    expect(fs.readFileSync(script, 'utf8')).toMatch(/^set -euo pipefail$/m);
  });

  describe('status.sh', () => {
    it('exits 0 when nothing is running', () => {
      const result = runStatus();
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/0 ephemeral resources/i);
    });

    it('exits 0 for a session younger than MAX_HOURS, and prints its start and age', () => {
      const result = runStatus({ FAKE_TAGGED_COUNT: '40', FAKE_SESSION_TAG: '2026-10-17T08:00:00Z', FAKE_NAT_COUNT: '1', FAKE_ALB_COUNT: '1' });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('2026-10-17T08:00:00Z');
      expect(result.stdout).toMatch(/4(\.0)? hours/);
    });

    it('exits 1 for a session older than MAX_HOURS (default 12)', () => {
      const result = runStatus({ FAKE_TAGGED_COUNT: '40', FAKE_SESSION_TAG: '2026-10-16T08:00:00Z' });

      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toMatch(/older than 12/i);
    });

    it('honours MAX_HOURS', () => {
      const env = { FAKE_TAGGED_COUNT: '40', FAKE_SESSION_TAG: '2026-10-17T08:00:00Z' };
      expect(runStatus({ ...env, MAX_HOURS: '3' }).status).toBe(1);
      expect(runStatus({ ...env, MAX_HOURS: '5' }).status).toBe(0);
    });

    it.each(['None', 'unset', ''])('exits 1 when resources exist but the Session tag is %p', (tag) => {
      const result = runStatus({ FAKE_TAGGED_COUNT: '40', FAKE_SESSION_TAG: tag });

      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toMatch(/session tag/i);
    });

    it('exits 1 for an hourly-billed NAT gateway even if nothing is tagged', () => {
      const result = runStatus({ FAKE_NAT_COUNT: '2' });

      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(/2 NAT gateway/i);
    });

    it('exits 1 for a blogplatform load balancer even if nothing is tagged', () => {
      const result = runStatus({ FAKE_ALB_COUNT: '1' });

      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(/1 load balancer/i);
    });

    it('is read-only: it only calls describe/get operations', () => {
      const result = runStatus({ FAKE_TAGGED_COUNT: '3', FAKE_SESSION_TAG: '2026-10-17T08:00:00Z' });

      const lines = result.calls.trim().split('\n');
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        const [service, operation] = line.split(' ');
        expect(['resourcegroupstaggingapi', 'ec2', 'elbv2']).toContain(service);
        expect(operation).toMatch(/^(get|describe)-/);
      }
    });

    it('asks only about ap-south-1 and the ephemeral layer', () => {
      const result = runStatus();
      expect(result.calls).toMatch(/--region ap-south-1/);
      expect(result.calls).toMatch(/Key=Project,Values=blogplatform/);
      expect(result.calls).toMatch(/Key=Layer,Values=ephemeral/);
    });
  });

  describe('up.sh', () => {
    const run = (env) => spawnSync('bash', [path.join(ROOT, 'scripts', 'session', 'up.sh')], {
      env: { PATH: '/usr/bin:/bin', ...env }, encoding: 'utf8'
    });

    it('requires IMAGE_TAG', () => {
      const result = run({});
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/IMAGE_TAG/);
    });

    it('requires WEB_IMAGE_TAG for the HTTPS edge (the default)', () => {
      const result = run({ IMAGE_TAG: 'abc' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/WEB_IMAGE_TAG/);
    });

    it('rejects an unknown EDGE', () => {
      const result = run({ IMAGE_TAG: 'abc', EDGE: 'carrier_pigeon' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/EDGE/);
    });
  });
});

describe('Makefile', () => {
  const make = (...args) => spawnSync('make', ['-C', ROOT, ...args], { encoding: 'utf8' });

  it('help is the default target and lists up, down and status', () => {
    const result = make();
    expect(result.status).toBe(0);
    for (const target of ['up', 'down', 'status']) {
      expect(result.stdout).toMatch(new RegExp(`\\b${target}\\b`));
    }
  });

  it.each(['up', 'down', 'status'])('make %s calls scripts/session/%s.sh', (target) => {
    const result = make('-n', target);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`scripts/session/${target}.sh`);
  });
});
