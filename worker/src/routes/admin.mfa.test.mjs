import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';

const adminSource = await readFile(new URL('./admin.ts', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../index.ts', import.meta.url), 'utf8');
const sessionSource = await readFile(new URL('../auth/session.ts', import.meta.url), 'utf8');

for (const route of [
  "get('/account/mfa'",
  "post('/account/mfa/setup'",
  "post('/account/mfa/enable'",
  "post('/account/mfa/recovery-codes'",
  "post('/account/mfa/disable'",
  "post('/account/mfa/step-up'",
]) {
  assert.ok(adminSource.includes(`adminRoutes.${route}`), `missing MFA route: ${route}`);
}

assert.match(adminSource, /verifyPassword\(/);
assert.match(adminSource, /generateTotpSecret\(/);
assert.match(adminSource, /buildTotpUri\(/);
assert.match(adminSource, /generateRecoveryCodes\(/);
assert.match(adminSource, /db\.enableUserTotp\(/);
assert.match(adminSource, /db\.disableUserTotp\(/);
assert.match(adminSource, /db\.replaceUserRecoveryCodes\(/);
assert.match(adminSource, /setMfaStepUpCookie\(/);
assert.match(indexSource, /isMfaStepUpProtectedRequest\(/);
assert.match(indexSource, /MFA_STEP_UP_REQUIRED/);
assert.match(sessionSource, /cf_monitor_mfa_stepup/);
assert.match(sessionSource, /sameSite:\s*'Strict'/);
assert.match(sessionSource, /maxAge:\s*MFA_STEP_UP_MAX_AGE_SECONDS/);
const usernameRoute = adminSource.slice(adminSource.indexOf("adminRoutes.post('/account/username'"), adminSource.indexOf("adminRoutes.post('/account/chpasswd'"));
const passwordRoute = adminSource.slice(adminSource.indexOf("adminRoutes.post('/account/chpasswd'"), adminSource.indexOf('// ============ 审计日志'));
assert.match(usernameRoute, /setAdminSessionCookie\([^]*?clearMfaStepUpCookie\(/);
assert.match(passwordRoute, /setAdminSessionCookie\([^]*?clearMfaStepUpCookie\(/);
for (const method of ['totp', 'recovery_code']) test(`${method} verification never swallows a signing-key configuration error`, async () => {
  const loader = createWorkerLoader();
  const { confirmUserMfaFactor } = loader.load('worker/src/auth/mfa-factor.ts');
  const { AuthConfigurationError } = loader.load('worker/src/auth/jwt.ts');
  await assert.rejects(() => confirmUserMfaFactor({}, {
    uuid: 'synthetic-config-owner', session_version: 1, totp_enabled_at: new Date().toISOString(), totp_secret_enc: 'v1.synthetic.iv',
  }, { method, code: method === 'totp' ? '123456' : 'A'.repeat(24), purpose: 'mfa-step-up', operationToken: 'synthetic-session' }, {}),
  error => error instanceof AuthConfigurationError);
});

const setupRoute = adminSource.slice(adminSource.indexOf("adminRoutes.post('/account/mfa/setup'"), adminSource.indexOf("adminRoutes.post('/account/mfa/enable'"));
const enableRoute = adminSource.slice(adminSource.indexOf("adminRoutes.post('/account/mfa/enable'"), adminSource.indexOf("adminRoutes.post('/account/mfa/recovery-codes'"));
assert.match(setupRoute, /loadLoginRateLimitStates\(/);
assert.match(setupRoute, /recordLoginFailure\(/);
assert.match(enableRoute, /loadLoginRateLimitStates\(/);
assert.match(enableRoute, /recordLoginFailure\(/);
