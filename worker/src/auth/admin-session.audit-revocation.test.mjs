import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';

test('W08: forced session validation rejects a revoked version despite a warm read cache', async () => {
  let version = 1;
  const { validateAdminSession } = createWorkerLoader({ db: {
    getUserByUuid: async () => ({ uuid: 'synthetic-owner', username: 'synthetic-owner', session_version: version }),
  } }).load('worker/src/auth/admin-session.ts');
  const payload = { userId: 'synthetic-owner', username: 'synthetic-owner', sessionVersion: 1 };
  assert.ok(await validateAdminSession({}, payload));
  version = 2;
  assert.equal(await validateAdminSession({}, payload, { fresh: true }), null);
});
