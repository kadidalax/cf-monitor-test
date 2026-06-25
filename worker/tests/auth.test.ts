import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { Hono } from 'hono';
import { sign } from 'hono/jwt';

import { generateToken, verifyAdminToken } from '../src/auth/jwt.ts';
import { hashPassword, needsPasswordRehash, validateAdminPasswordStrength, verifyPassword } from '../src/auth/password.ts';
import {
  clearAdminSessionCookie,
  ensureAdminCsrfCookie,
  getAdminSessionToken,
  verifyAdminCsrfToken,
} from '../src/auth/session.ts';
import { validateSetupDiagnosticsToken } from '../src/utils/setup-diagnostics-token.ts';

const adminBootstrapSource = readFileSync(join(import.meta.dirname, '..', 'src', 'auth', 'admin-bootstrap.ts'), 'utf8');
const adminSessionSource = readFileSync(join(import.meta.dirname, '..', 'src', 'auth', 'admin-session.ts'), 'utf8');
const sessionSource = readFileSync(join(import.meta.dirname, '..', 'src', 'auth', 'session.ts'), 'utf8');
const indexSource = readFileSync(join(import.meta.dirname, '..', 'src', 'index.ts'), 'utf8');
const publicRoutesSource = readFileSync(join(import.meta.dirname, '..', 'src', 'routes', 'public.ts'), 'utf8');
const adminRoutesSource = readFileSync(join(import.meta.dirname, '..', 'src', 'routes', 'admin.ts'), 'utf8');
const env = {
  JWT_SECRET: '0'.repeat(32),
};

function cookiePair(setCookie: string): string {
  return setCookie.split(';', 1)[0];
}

test('admin CSRF cookie is reusable only when the header matches', async () => {
  const app = new Hono();
  app.get('/csrf', (c) => c.json({ token: ensureAdminCsrfCookie(c) }));
  app.post('/csrf', (c) => c.json({ ok: verifyAdminCsrfToken(c) }));

  const issued = await app.request('https://example.com/csrf');
  assert.equal(issued.status, 200);
  const { token } = await issued.json() as { token: string };
  assert.match(token, /^[A-Za-z0-9_-]{32,128}$/);

  const cookie = cookiePair(issued.headers.get('Set-Cookie') || '');
  assert.match(cookie, /^cf_monitor_csrf=/);

  const accepted = await app.request('https://example.com/csrf', {
    headers: {
      Cookie: cookie,
      'X-CSRF-Token': token,
    },
    method: 'POST',
  });
  assert.deepEqual(await accepted.json(), { ok: true });

  const rejected = await app.request('https://example.com/csrf', {
    headers: {
      Cookie: cookie,
      'X-CSRF-Token': 'wrong-token',
    },
    method: 'POST',
  });
  assert.deepEqual(await rejected.json(), { ok: false });
});

test('setup diagnostics token is optional but strong when configured', () => {
  assert.equal(validateSetupDiagnosticsToken(undefined), null);
  assert.equal(validateSetupDiagnosticsToken(''), null);
  assert.match(
    validateSetupDiagnosticsToken('short-token') || '',
    /SETUP_DIAGNOSTICS_TOKEN must be at least 32 bytes/,
  );
  assert.equal(validateSetupDiagnosticsToken('0123456789abcdef0123456789abcdef'), null);
});

test('admin session token is accepted from cookies but not bearer headers', async () => {
  const app = new Hono();
  app.get('/session', (c) => c.json({ token: getAdminSessionToken(c) }));

  const cookieSession = await app.request('https://example.com/session', {
    headers: {
      Cookie: 'cf_monitor_session=from-cookie',
      Authorization: 'Bearer from-bearer',
    },
  });
  assert.deepEqual(await cookieSession.json(), { token: 'from-cookie' });

  const bearerOnly = await app.request('https://example.com/session', {
    headers: { Authorization: 'Bearer from-bearer' },
  });
  assert.deepEqual(await bearerOnly.json(), { token: null });
});

test('admin JWT verification requires a valid sessionVersion claim', async () => {
  const token = await generateToken('user-1', 'admin', 3, env);
  assert.deepEqual(await verifyAdminToken(token, env), {
    userId: 'user-1',
    username: 'admin',
    sessionVersion: 3,
  });

  const missingSessionVersion = await sign({
    userId: 'user-1',
    username: 'admin',
    exp: Math.floor(Date.now() / 1000) + 60,
  }, env.JWT_SECRET, 'HS256');

  assert.equal(await verifyAdminToken(missingSessionVersion, env), null);
});

test('admin CSRF token comparison uses a constant-time string helper', () => {
  assert.match(sessionSource, /function constantTimeStringEqual/);
  assert.match(sessionSource, /constantTimeStringEqual\(cookieToken, headerToken\)/);
  assert.doesNotMatch(sessionSource, /cookieToken === headerToken/);
});

test('admin session validation is cached briefly and invalidatable', () => {
  assert.match(adminSessionSource, /const ADMIN_SESSION_CACHE_MS = 10_000/);
  assert.match(adminSessionSource, /adminSessionCache/);
  assert.match(adminSessionSource, /adminSessionRequests/);
  assert.match(adminSessionSource, /export function invalidateAdminSessionCache/);
  assert.match(adminSessionSource, /Pick<db\.User, 'uuid' \| 'username' \| 'session_version'>/);
});

test('admin session edge cache still requires CSRF for unsafe methods', () => {
  assert.match(indexSource, /if \(await getAdminSessionEdgeCache\(payload\)\) \{/);
  assert.match(indexSource, /if \(!safeMethod && !verifyAdminCsrfToken\(c\)\) \{[\s\S]*return c\.json\(\{ error: 'CSRF token 无效，请刷新页面后重试' \}, 403\);[\s\S]*return withDatabase\(c\.env, async \(\) => \{/);
  assert.match(indexSource, /putAdminSessionEdgeCache\(c, payload\);/);
});

test('admin JWT secret must be at least 32 bytes', async () => {
  await assert.rejects(
    () => generateToken('user-1', 'admin', 1, { JWT_SECRET: 'too-short' }),
    /JWT_SECRET must be at least 32 bytes/,
  );
});

test('admin password hashes use the current PBKDF2 cost without downgrading stronger hashes', async () => {
  const password = 'correct horse battery staple';
  const hash = await hashPassword(password);
  assert.match(hash, /^pbkdf2_sha256\$10000\$/);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(needsPasswordRehash(hash), false);

  const oldSalt = Buffer.alloc(16).toString('base64');
  const oldHash = Buffer.alloc(32).toString('base64');
  assert.equal(needsPasswordRehash(`pbkdf2_sha256$5000$${oldSalt}$${oldHash}`), true);
  assert.equal(needsPasswordRehash(`pbkdf2_sha256$10000$${oldSalt}$${oldHash}`), false);
  assert.equal(needsPasswordRehash(`pbkdf2_sha256$20000$${oldSalt}$${oldHash}`), false);
  assert.equal(needsPasswordRehash(`pbkdf2_sha256$60000$${oldSalt}$${oldHash}`), false);
  assert.equal(needsPasswordRehash(`pbkdf2_sha256$210000$${oldSalt}$${oldHash}`), false);
});

test('admin password strength only requires six characters', () => {
  assert.equal(validateAdminPasswordStrength('123456', 'admin'), null);
  assert.equal(validateAdminPasswordStrength('aaaaaa', 'admin'), null);
  assert.match(validateAdminPasswordStrength('12345', 'admin') || '', /至少需要 6 位/);
});

test('admin bootstrap errors keep explicit code fields for Node test compatibility', () => {
  assert.match(adminBootstrapSource, /readonly code: AdminBootstrapErrorCode/);
  assert.match(adminBootstrapSource, /this\.code = code/);
  assert.doesNotMatch(adminBootstrapSource, /constructor\(readonly code:/);
  assert.match(adminBootstrapSource, /validateAdminPasswordStrength\(password, username\)/);
});

test('admin bootstrap rotates sessions when replacing the legacy default password', () => {
  const legacyPasswordReplacement = adminBootstrapSource.match(
    /if \(username === LEGACY_DEFAULT_ADMIN\.username\) \{[\s\S]*?return;\r?\n  \}/,
  )?.[0] ?? '';

  assert.match(legacyPasswordReplacement, /db\.updateUserPasswordAndRotateSession\(/);
  assert.doesNotMatch(legacyPasswordReplacement, /db\.updateUserPassword\(/);
});

test('logout session helpers require CSRF for active sessions and clear browser-side residue on success', async () => {
  const app = new Hono();
  app.post('/logout', (c) => {
    if (getAdminSessionToken(c) && !verifyAdminCsrfToken(c)) {
      return c.json({ error: 'CSRF token 无效，请刷新页面后重试' }, 403);
    }
    clearAdminSessionCookie(c);
    c.header('Clear-Site-Data', '"cache", "storage"');
    return c.json({ success: true });
  });
  const csrfToken = 'csrf-token-value-with-32-chars-001';
  const cookie = `cf_monitor_session=session-token; cf_monitor_csrf=${csrfToken}`;

  const rejected = await app.request('https://example.com/logout', {
    headers: { Cookie: cookie },
    method: 'POST',
  });
  assert.equal(rejected.status, 403);

  const accepted = await app.request('https://example.com/logout', {
    headers: {
      Cookie: cookie,
      'X-CSRF-Token': csrfToken,
    },
    method: 'POST',
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get('Clear-Site-Data'), '"cache", "storage"');
  const setCookie = accepted.headers.get('Set-Cookie') || '';
  assert.match(setCookie, /cf_monitor_session=/);
  assert.match(setCookie, /cf_monitor_csrf=/);
  assert.match(setCookie, /Max-Age=0/i);
});

test('username changes and logout revoke existing admin JWTs server-side', () => {
  assert.match(adminRoutesSource, /db\.updateUserUsernameAndRotateSession\(database, userId, nextUsername\)/);
  assert.match(adminRoutesSource, /deleteAdminSessionEdgeCache\(c, userId, currentUser\.session_version\)/);
  assert.match(publicRoutesSource, /payload = token \? await verifyAdminToken\(token, c\.env\) : null/);
  assert.match(publicRoutesSource, /await db\.rotateUserSession\(database, user\.uuid\)/);
  assert.match(publicRoutesSource, /invalidateAdminSessionCache\(user\.uuid\)/);
  assert.match(publicRoutesSource, /deleteAdminSessionEdgeCache\(c, payload\.userId, payload\.sessionVersion\)/);
});

test('unknown login users still run dummy password verification', () => {
  const unknownUserBranch = publicRoutesSource.match(
    /if \(!user\) \{[\s\S]*?return c\.json\(\{ error: '用户名或密码错误' \}, 401\);\r?\n  \}/,
  )?.[0] ?? '';

  assert.match(publicRoutesSource, /const DUMMY_ADMIN_PASSWORD_HASH = 'pbkdf2_sha256\$/);
  assert.match(unknownUserBranch, /timed\(metrics, 'verify_password'/);
  assert.match(unknownUserBranch, /verifyPassword\(password, DUMMY_ADMIN_PASSWORD_HASH\)/);
});
