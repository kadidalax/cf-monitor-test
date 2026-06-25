import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const instanceSource = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'Instance.tsx'), 'utf8');
const pingChartSource = readFileSync(join(import.meta.dirname, '..', 'src', 'utils', 'pingChart.ts'), 'utf8');

test('public instance history requests use cursor pagination', () => {
  assert.match(instanceSource, /function historyQuery/);
  assert.match(instanceSource, /records\/load\?\$\{historyQuery\(\{ uuid, start, end, cursor: end, limit \}\)\}/);
  assert.match(instanceSource, /records\/gpu\?\$\{historyQuery\(\{ uuid, start, end, cursor: end, limit: 200 \}\)\}/);
  assert.match(instanceSource, /fetchPingTaskSeries\(uuid, \{ limit: 360, maxTasks: 8, rangeHours: timeRangeHours\[timeRange\], cursor: new Date\(\)\.toISOString\(\), signal: controller\.signal \}\)/);
});

test('ping history helper sends cursor to batch and fallback endpoints', () => {
  assert.match(pingChartSource, /cursor = new Date\(\)\.toISOString\(\)/);
  assert.match(pingChartSource, /records\/ping\/batch\?[^`]*&cursor=\$\{encodeURIComponent\(cursor\)\}/);
  assert.match(pingChartSource, /records\/ping\?[^`]*&cursor=\$\{encodeURIComponent\(cursor\)\}/);
  assert.match(pingChartSource, /records: normalizePingRecords\(records\)/);
});
