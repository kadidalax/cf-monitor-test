import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, pbkdf2Sync } from 'node:crypto';
import { createDurableState, createWorkerLoader } from '../test-support/worker-module.mjs';

// Synthetic inputs only. Credentials, hash values and RPC arguments are never diagnostics.
const password = 'synthetic-free-cpu-passphrase';
const replacement = 'synthetic-replacement-passphrase';
const username = 'synthetic-free-cpu-owner';
const bindingValues = {
  JWT_SECRET: 'synthetic-free-cpu-jwt-secret-longer-than-32-bytes',
  SUPABASE_SECRET_KEY: 'sb_secret_synthetic_free_cpu_only',
};

function storedHash(value = password, iterations = 100000) {
  const salt = Buffer.alloc(16, 9);
  return `pbkdf2_sha256$${iterations}$${salt.toString('base64')}$${pbkdf2Sync(value, salt, iterations, 32, 'sha256').toString('base64')}`;
}

function matchesHash(value, encoded) {
  const [algorithm, iterations, salt, hash] = encoded.split('$');
  return algorithm === 'pbkdf2_sha256' && iterations === '100000'
    && pbkdf2Sync(value, Buffer.from(salt, 'base64'), Number(iterations), 32, 'sha256').equals(Buffer.from(hash, 'base64'));
}

function cryptoBoundary(onPbkdf2) {
  return {
    getRandomValues: crypto.getRandomValues.bind(crypto),
    randomUUID: crypto.randomUUID.bind(crypto),
    subtle: new Proxy(crypto.subtle, {
      get(target, property) {
        const method = target[property];
        if (typeof method !== 'function') return method;
        return (...args) => {
          if ((property === 'deriveBits' || property === 'deriveKey') && args[0]?.name === 'PBKDF2') onPbkdf2(args[0].iterations);
          return method.apply(target, args);
        };
      },
    }),
  };
}

function fixture({ hash = storedHash(), existing = true, banEntry = true, fault } = {}) {
  const events = { entryKdf: 0, doIterations: [], rpc: [], failures: 0, audits: [], logs: [], errors: [], rehash: 0, updates: 0, creates: 0 };
  const jobs = [];
  let user = existing ? { uuid: 'synthetic-owner-id', username, passwd: hash, session_version: 1 } : null;
  const db = {
    getUserByUsername: async (_db, name) => user?.username === name ? { ...user } : null,
    getUserByUuid: async (_db, id) => user?.uuid === id ? { ...user } : null,
    countUsers: async () => Number(Boolean(user)),
    getLoginRateLimitsByBuckets: async () => new Map(),
    deleteLoginRateLimitsBefore: async () => {},
    recordLoginRateLimitFailures: async () => { events.failures += 1; },
    clearObservedLoginRateLimits: async () => {},
    insertAuditLog: async (_db, _user, action) => { events.audits.push(action); },
    createInitialAdmin: async (_db, uuid, name, passwd) => {
      events.creates += 1;
      if (user) return false;
      user = { uuid, username: name, passwd, session_version: 1 };
      return true;
    },
    rehashUserPassword: async (_db, uuid, previous, next) => {
      events.rehash += 1;
      if (user?.uuid !== uuid || user.passwd !== previous) return false;
      user = { ...user, passwd: next };
      return true;
    },
    updateUserPasswordAndRotateSession: async (_db, uuid, passwd) => {
      events.updates += 1;
      if (user?.uuid !== uuid) return null;
      user = { ...user, passwd, session_version: user.session_version + 1 };
      return { ...user };
    },
  };
  const logger = Object.fromEntries(['log', 'warn', 'error', 'info', 'debug'].map(level => [level, (...args) => {
    events.logs.push(args.map(value => String(value)).join(' '));
  }]));
  const doLoader = createWorkerLoader({ globals: { console: logger, crypto: cryptoBoundary(iterations => events.doIterations.push(iterations)) } });
  const { RateLimitDO } = doLoader.load('worker/src/do/rate-limit.ts');
  const instances = new Map();
  const env = { ...bindingValues };
  function get(name) {
    if (!instances.has(name)) {
      const durable = createDurableState();
      if (name.startsWith('password:')) {
        Object.defineProperty(durable.state, 'storage', { get() { throw new Error('Password RPC touched durable storage'); } });
      }
      instances.set(name, new RateLimitDO(durable.state, env));
    }
    const instance = instances.get(name);
    return new Proxy(instance, {
      get(target, method) {
        if (!['hashPassword', 'verifyPassword'].includes(method)) {
          const value = target[method];
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return async (...args) => {
          events.rpc.push({ name, method });
          if (fault === 'throw' || fault === method) throw new Error('synthetic-private-upstream-detail');
          if (fault === 'malformed') return { unexpected: true };
          return target[method](...structuredClone(args));
        };
      },
    });
  }
  if (fault !== 'missing') env.RATE_LIMIT = { idFromName: name => name, get, getByName: get };
  const entry = createWorkerLoader({ db, globals: {
    console: logger,
    crypto: cryptoBoundary(() => {
      events.entryKdf += 1;
      if (banEntry) throw new Error('Entry Worker PBKDF2 is forbidden');
    }),
  } });
  const { publicRoutes } = entry.load('worker/src/routes/public.ts');
  const { adminRoutes } = entry.load('worker/src/routes/admin.ts');
  const publicApp = new publicRoutes.constructor();
  publicApp.use('*', async (_c, next) => { await next(); });
  publicApp.route('/', publicRoutes);
  const admin = new publicRoutes.constructor();
  admin.use('*', async (c, next) => { c.set('userId', user?.uuid); c.set('username', user?.username); await next(); });
  admin.route('/', adminRoutes);
  for (const routes of [publicApp, admin]) {
    routes.onError((error, c) => { events.errors.push(String(error.message)); return c.json({ error: 'Synthetic infrastructure failure' }, 500); });
  }
  const context = { waitUntil: task => jobs.push(task) };
  const post = (routes, path, body) => routes.request(`https://panel.example.test${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1' }, body: JSON.stringify(body),
  }, env, context);
  return {
    events, instances, env,
    get user() { return user; },
    public: (path, body) => post(publicApp, path, body),
    admin: (path, body) => post(admin, path, body),
    async drain() { while (jobs.length) await Promise.all(jobs.splice(0)); },
    algorithm: doLoader.load('worker/src/auth/password.ts'),
  };
}

test('entry Worker can log in with PBKDF2 forbidden while the isolated DO uses real crypto', async () => {
  const f = fixture();
  assert.equal(await f.algorithm.verifyPassword(password, f.user.passwd), true, 'DO crypto control must verify the fixture');
  f.events.doIterations.length = 0;
  const response = await f.public('/login', { username, password });
  await f.drain();
  assert.equal(response.status, 200, `entry PBKDF2 attempts: ${f.events.entryKdf}`);
  assert.equal(f.events.entryKdf, 0);
  assert.deepEqual(f.events.doIterations, [100000]);
  assert.deepEqual(f.events.rpc.map(call => call.method), ['verifyPassword']);
  assert.equal(f.events.failures, 0);
  assert.equal(f.events.rpc.every(call => call.name.startsWith('password:')), true);
});

test('initial ownership hashes in the DO before the atomic administrator write', async () => {
  const f = fixture({ existing: false });
  const response = await f.public('/admin/recovery', { username, password, supabase_secret_key: bindingValues.SUPABASE_SECRET_KEY });
  await f.drain();
  assert.equal(response.status, 200);
  assert.equal(f.events.creates, 1);
  assert.equal(matchesHash(password, f.user.passwd), true);
  assert.deepEqual(f.events.rpc.map(call => call.method), ['hashPassword']);
  assert.equal(f.events.entryKdf, 0);
});

for (const kind of ['unknown user', 'wrong password']) test(`${kind} preserves dummy cost and failed-login accounting through the DO`, async () => {
  const f = fixture();
  const response = await f.public('/login', { username: kind === 'unknown user' ? 'synthetic-unknown' : username,
    password: kind === 'wrong password' ? replacement : password });
  await f.drain();
  assert.equal(response.status, 401);
  assert.equal(f.events.failures, 1);
  assert.deepEqual(f.events.doIterations, [100000]);
  assert.equal(f.events.entryKdf, 0);
});

for (const kind of ['older PBKDF2', 'legacy SHA256']) test(`${kind} login upgrades in the DO and retains the old-hash conditional write`, async () => {
  const hash = kind === 'older PBKDF2' ? storedHash(password, 10000)
    : createHash('sha256').update(password + 'cf-monitor-salt').digest('hex');
  const f = fixture({ hash });
  const response = await f.public('/login', { username, password });
  await f.drain();
  assert.equal(response.status, 200);
  assert.equal(f.events.rehash, 1);
  assert.equal(matchesHash(password, f.user.passwd), true);
  assert.deepEqual(f.events.rpc.map(call => call.method), ['verifyPassword', 'hashPassword']);
  assert.equal(f.events.entryKdf, 0);
});

test('MFA password confirmation and both password-change computations stay outside the entry Worker', async () => {
  const f = fixture();
  const setup = await f.admin('/account/mfa/setup', { password });
  assert.equal(setup.status, 200);
  assert.equal(typeof (await setup.json()).setup_token, 'string');
  const changed = await f.admin('/account/chpasswd', { old_password: password, new_password: replacement });
  await f.drain();
  assert.equal(changed.status, 200);
  assert.equal(matchesHash(replacement, f.user.passwd), true);
  assert.equal(matchesHash(password, f.user.passwd), false);
  assert.equal(f.user.session_version, 2);
  assert.deepEqual(f.events.rpc.map(call => call.method), ['verifyPassword', 'verifyPassword', 'hashPassword']);
  assert.equal(f.events.entryKdf, 0);
});

test('wrong current passwords cannot start MFA setup or change the account password', async () => {
  const f = fixture();
  const setup = await f.admin('/account/mfa/setup', { password: replacement });
  assert.equal(setup.status, 401);
  assert.equal(Object.hasOwn(await setup.json(), 'setup_token'), false);
  assert.equal(f.events.failures, 1);
  const changed = await f.admin('/account/chpasswd', { old_password: replacement, new_password: replacement });
  await f.drain();
  assert.equal(changed.status, 400);
  assert.equal(f.events.updates, 0);
  assert.equal(f.user.session_version, 1);
  assert.equal(f.events.entryKdf, 0);
});

for (const scenario of ['login', 'unknown', 'recovery', 'MFA', 'change', 'new hash']) test(`RPC failure during ${scenario} does not become a bad password or a local KDF fallback`, async () => {
  const f = fixture({ existing: scenario !== 'recovery', banEntry: false, fault: scenario === 'new hash' ? 'hashPassword' : 'throw' });
  const response = scenario === 'recovery'
    ? await f.public('/admin/recovery', { username, password, supabase_secret_key: bindingValues.SUPABASE_SECRET_KEY })
    : scenario === 'MFA' ? await f.admin('/account/mfa/setup', { password })
    : ['change', 'new hash'].includes(scenario) ? await f.admin('/account/chpasswd', { old_password: password, new_password: replacement })
    : await f.public('/login', { username: scenario === 'unknown' ? 'synthetic-unknown' : username, password });
  await f.drain();
  assert.equal(response.status >= 500, true);
  assert.equal(f.events.entryKdf, 0);
  assert.equal(f.events.failures, 0);
  assert.equal(f.events.audits.includes('login_failed'), false);
  assert.equal(f.events.creates + f.events.updates + f.events.rehash, 0);
  assert.equal([...f.events.errors, ...f.events.logs].some(value => value.includes('synthetic-private-upstream-detail')), false);
});

for (const fault of ['missing', 'malformed']) test(`${fault} password RPC fails closed without recording a password failure`, async () => {
  const f = fixture({ fault, banEntry: false });
  const response = await f.public('/login', { username, password });
  await f.drain();
  assert.equal(response.status >= 500, true);
  assert.equal(f.events.entryKdf, 0);
  assert.equal(f.events.failures, 0);
  assert.equal(f.events.audits.includes('login_failed'), false);
});

test('password RPC validates bounded inputs and keeps secrets out of durable state and instance fields', async () => {
  const f = fixture();
  const name = 'password:synthetic-bounds';
  const stub = f.env.RATE_LIMIT.getByName(name);
  const instance = f.instances.get(name);
  assert.equal(typeof instance.hashPassword, 'function', 'the private password RPC must exist');
  const fields = Reflect.ownKeys(instance).map(key => [key, instance[key]]);
  for (const value of [null, {}, '', 'x'.repeat(4097)]) {
    await assert.rejects(() => stub.hashPassword(value));
    await assert.rejects(() => stub.verifyPassword(value, storedHash()));
  }
  for (const value of [null, {}, '', 'x'.repeat(1025)]) await assert.rejects(() => stub.verifyPassword(password, value));
  assert.equal(f.events.doIterations.length, 0, 'rejected inputs must not reach the KDF');
  const longest = 'x'.repeat(4096);
  const hash = await stub.hashPassword(longest);
  assert.equal(await stub.verifyPassword(longest, hash), true);
  assert.equal(await stub.verifyPassword(password, 'malformed-stored-hash'), false);
  assert.equal(Reflect.ownKeys(instance).length, fields.length);
  assert.equal(fields.every(([key, value]) => instance[key] === value), true);
  assert.equal(f.events.logs.length, 0);
});

for (const route of ['recovery', 'change']) test(`${route} rejects an oversized new password before any calculation or write`, async () => {
  const f = fixture({ existing: route !== 'recovery', banEntry: false });
  const longPassword = 'x'.repeat(4097);
  const response = route === 'recovery'
    ? await f.public('/admin/recovery', { username, password: longPassword, supabase_secret_key: bindingValues.SUPABASE_SECRET_KEY })
    : await f.admin('/account/chpasswd', { old_password: password, new_password: longPassword });
  await f.drain();
  assert.equal(response.status, 400);
  assert.equal(f.events.entryKdf + f.events.doIterations.length, 0);
  assert.equal(f.events.creates + f.events.updates, 0);
});
