import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const liveDataSource = readFileSync(join(import.meta.dirname, '..', 'src', 'do', 'live-data.ts'), 'utf8');

test('ping snapshots persist all due results when any ping value needs a write', () => {
  const start = liveDataSource.indexOf('private async filterTrustedPingResultsByInterval');
  assert.notEqual(start, -1);
  const method = liveDataSource.slice(start);

  assert.match(method, /const dueResults: PingPersistenceResult\[] = \[];/);
  assert.match(method, /dueResults\.push\(result\);/);
  assert.match(method, /return accepted\.length > 0 \? dueResults : \[];/);
});

test('ping snapshot throttle uses each task interval before falling back to the global interval', () => {
  assert.match(liveDataSource, /private pingResultIntervalMs\(intervalSec\?: number\): number/);
  assert.match(liveDataSource, /const minIntervalMs = this\.pingResultIntervalMs\(result\.intervalSec\);/);
});
