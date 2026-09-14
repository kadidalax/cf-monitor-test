import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, pbkdf2Sync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Log, LogLevel, Miniflare } from 'miniflare';

test('native workerd executes password RPC, legacy verification and the existing rate-limit fetch protocol', { timeout: 60000 }, async t => {
  const root = new URL('../../', import.meta.url);
  const compiled = await build({
    stdin: { resolveDir: fileURLToPath(root), loader: 'ts', contents: `
      import { RateLimitDO } from './worker/src/do/rate-limit';
      import { hashAdminPassword, verifyAdminPassword } from './worker/src/auth/password-service';
      export { RateLimitDO };
      export default {
        async fetch(request, env) {
          const body = await request.json();
          const account = 'synthetic-native-owner';
          const stub = env.RATE_LIMIT.getByName('password:' + account);
          if (body.operation === 'roundtrip') {
            const first = await hashAdminPassword(env, account, body.password);
            const second = await hashAdminPassword(env, account, body.password);
            return Response.json({
              work_factor: first.split('$')[1] === '100000',
              distinct_salts: first !== second,
              correct: await verifyAdminPassword(env, account, body.password, first),
              wrong: await verifyAdminPassword(env, account, body.other, first),
              old_pbkdf2: await verifyAdminPassword(env, account, body.password, body.oldPbkdf2),
              old_sha256: await verifyAdminPassword(env, account, body.password, body.oldSha256),
            });
          }
          if (body.operation === 'bounds') {
            let rejected = 0;
            for (const work of [
              () => stub.hashPassword(null),
              () => stub.hashPassword('x'.repeat(4097)),
              () => stub.verifyPassword(body.password, {}),
              () => stub.verifyPassword(body.password, 'x'.repeat(1025)),
            ]) {
              try { await work(); } catch (error) { if (error.message === 'Invalid password input') rejected += 1; }
            }
            let unavailable = 0;
            for (const work of [
              () => hashAdminPassword({}, account, body.password),
              () => verifyAdminPassword({}, account, body.password, body.oldSha256),
            ]) {
              try { await work(); } catch (error) { if (error.message === 'Password service unavailable') unavailable += 1; }
            }
            return Response.json({ rejected, unavailable,
              no_http_password_endpoint: (await stub.fetch(new Request('https://do/hash-password', { method: 'POST' }))).status === 404 });
          }
          const rate = env.RATE_LIMIT.getByName('public-api');
          const allowed = [];
          for (let index = 0; index < 3; index += 1) {
            const response = await rate.fetch(new Request('https://do/rate-limit', { method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bucket: 'native-password-regression', ip: 'synthetic-client', max: 2, windowMs: 60000 }) }));
            allowed.push((await response.json()).allowed);
          }
          return Response.json({ allowed });
        },
      };`,
    },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    external: ['cloudflare:*', 'node:*'], logLevel: 'silent',
  });
  const toml = await readFile(new URL('worker/wrangler.toml', root), 'utf8');
  const mf = new Miniflare({
    modules: true, script: compiled.outputFiles[0].text,
    compatibilityDate: /compatibility_date\s*=\s*"([^"]+)"/.exec(toml)[1],
    compatibilityFlags: ['nodejs_compat'], log: new Log(LogLevel.ERROR), port: 0,
    durableObjects: { RATE_LIMIT: { className: 'RateLimitDO', useSQLite: true } },
    outboundService: async () => { throw new Error('External requests are forbidden in the native password fixture'); },
  });
  t.after(() => mf.dispose());
  await mf.ready;
  const password = 'synthetic-native-password-passphrase';
  const salt = Buffer.alloc(16, 4);
  const inputs = {
    password, other: 'synthetic-native-different-passphrase',
    oldPbkdf2: `pbkdf2_sha256$10000$${salt.toString('base64')}$${pbkdf2Sync(password, salt, 10000, 32, 'sha256').toString('base64')}`,
    oldSha256: createHash('sha256').update(password + 'cf-monitor-salt').digest('hex'),
  };
  async function run(operation) {
    const response = await mf.dispatchFetch('https://native.example.test/check', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...inputs, operation }) });
    assert.equal(response.status, 200);
    return response.json();
  }
  await t.test('real RPC retains work factor, random salt and legacy verification', async () => {
    assert.deepEqual(await run('roundtrip'), {
      work_factor: true, distinct_salts: true, correct: true, wrong: false, old_pbkdf2: true, old_sha256: true,
    });
  });
  await t.test('native RPC enforces input boundaries and does not add an HTTP password endpoint', async () => {
    assert.deepEqual(await run('bounds'), { rejected: 4, unavailable: 2, no_http_password_endpoint: true });
  });
  await t.test('existing SQLite limiter still denies the third request', async () => {
    assert.deepEqual(await run('rate-limit'), { allowed: [true, true, false] });
  });
});
