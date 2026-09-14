import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';

const { readTimeCursorParam } = createWorkerLoader({ expose: {
  'worker/src/routes/public.ts': ['readTimeCursorParam'],
} }).load('worker/src/routes/public.ts');

for (const cursor of [
  'v1|2026-09-13T00:00:00+00:00|9223372036854775807|2147483647',
  'v1|2026-09-13T00:00:00.123456Z|9007199254740993|0',
  'v1|2026-09-13T00:00:00.123457Z|9007199254740993|1',
]) {
  test(`D02: single-series cursor preserves full precision ${cursor}`, () => {
    assert.equal(readTimeCursorParam(cursor, true).cursor, cursor);
    assert.ok(readTimeCursorParam(cursor).error, 'batch cursor contract stays timestamp-based');
  });
}

for (const cursor of [
  'v1|invalid|1|0', 'v1|2026-09-13T00:00:00Z|9223372036854775808|0',
  'v1|2026-09-13T00:00:00Z|1|2147483648', 'v1|2026-09-13T00:00:00Z|0|0',
  'v1|2026-09-13T00:00:00Z|1|-1', 'v2|2026-09-13T00:00:00Z|1|0',
]) test(`D02: malformed or out-of-range cursor is rejected ${cursor}`, () => {
  assert.ok(readTimeCursorParam(cursor, true).error);
});

test('D02: legacy timestamp cursors remain compatible', () => {
  assert.equal(readTimeCursorParam('2026-09-13T08:00:00+08:00', true).cursor, '2026-09-13T00:00:00.000Z');
  assert.equal(readTimeCursorParam(undefined, true).cursor, undefined);
});
