import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAgentTokenMaxAgeMs,
  isAgentTokenExpired,
  isAgentTokenMaxAgeConfigInvalid,
} from '../src/utils/agent-token-policy.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

test('agent token max age is disabled unless configured with positive days', () => {
  assert.equal(getAgentTokenMaxAgeMs({}), 0);
  assert.equal(getAgentTokenMaxAgeMs({ AGENT_TOKEN_MAX_AGE_DAYS: '' }), 0);
  assert.equal(getAgentTokenMaxAgeMs({ AGENT_TOKEN_MAX_AGE_DAYS: '0' }), 0);
  assert.equal(getAgentTokenMaxAgeMs({ AGENT_TOKEN_MAX_AGE_DAYS: '-3' }), 0);
  assert.equal(getAgentTokenMaxAgeMs({ AGENT_TOKEN_MAX_AGE_DAYS: '0.5' }), 0);
  assert.equal(getAgentTokenMaxAgeMs({ AGENT_TOKEN_MAX_AGE_DAYS: '7' }), 7 * DAY_MS);
  assert.equal(getAgentTokenMaxAgeMs({ AGENT_TOKEN_MAX_AGE_DAYS: '99999' }), 3650 * DAY_MS);
  assert.equal(isAgentTokenMaxAgeConfigInvalid({}), false);
  assert.equal(isAgentTokenMaxAgeConfigInvalid({ AGENT_TOKEN_MAX_AGE_DAYS: '0' }), true);
  assert.equal(isAgentTokenMaxAgeConfigInvalid({ AGENT_TOKEN_MAX_AGE_DAYS: '0.5' }), true);
  assert.equal(isAgentTokenMaxAgeConfigInvalid({ AGENT_TOKEN_MAX_AGE_DAYS: 'oops' }), true);
  assert.equal(isAgentTokenMaxAgeConfigInvalid({ AGENT_TOKEN_MAX_AGE_DAYS: '30' }), false);
});

test('agent token expiration uses rotation time and fails closed without timestamps', () => {
  const now = Date.parse('2026-06-17T00:00:00.000Z');
  const maxAgeMs = 30 * DAY_MS;

  assert.equal(isAgentTokenExpired({ token_rotated_at: '2026-06-01T00:00:00.000Z' }, maxAgeMs, now), false);
  assert.equal(isAgentTokenExpired({ token_rotated_at: '2026-04-01T00:00:00.000Z' }, maxAgeMs, now), true);
  assert.equal(isAgentTokenExpired({ created_at: '2026-04-01T00:00:00.000Z' }, maxAgeMs, now), true);
  assert.equal(isAgentTokenExpired({}, maxAgeMs, now), true);
  assert.equal(isAgentTokenExpired({}, 0, now), false);
});
