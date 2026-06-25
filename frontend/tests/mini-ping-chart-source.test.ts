import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const chartSource = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'MiniPingChart.tsx'), 'utf8');

test('mini ping chart uses a smooth curve instead of sharp linear segments', () => {
  assert.match(chartSource, /type="monotone"/);
  assert.doesNotMatch(chartSource, /type="linear"/);
});
