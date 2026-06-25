import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAuthUser, shouldClearAuthForStatus } from '../src/contexts/auth-state.ts';

test('normalizeAuthUser accepts only complete user identity objects', () => {
  assert.deepEqual(normalizeAuthUser({ uuid: ' user-1 ', username: ' admin ' }), {
    uuid: 'user-1',
    username: 'admin',
  });

  for (const value of [
    null,
    {},
    { uuid: 'user-1' },
    { username: 'admin' },
    { uuid: '', username: 'admin' },
    { uuid: 'user-1', username: '   ' },
    { uuid: 123, username: 'admin' },
  ]) {
    assert.equal(normalizeAuthUser(value), null);
  }
});

test('shouldClearAuthForStatus only clears invalid auth sessions', () => {
  assert.equal(shouldClearAuthForStatus(401), true);
  assert.equal(shouldClearAuthForStatus(403), true);

  for (const status of [0, 200, 400, 404, 409, 429, 500, 503]) {
    assert.equal(shouldClearAuthForStatus(status), false, `status ${status}`);
  }
});
