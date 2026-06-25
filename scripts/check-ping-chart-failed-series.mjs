import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const chartUtils = readFileSync('frontend/src/utils/pingChart.ts', 'utf8');
const miniChart = readFileSync('frontend/src/components/MiniPingChart.tsx', 'utf8');
const instancePage = readFileSync('frontend/src/pages/Instance.tsx', 'utf8');

assert.match(
  chartUtils,
  /export function getPingSeriesWithRecords/,
  'ping chart must keep failed-only tasks visible when they have records',
);

for (const [name, source] of [
  ['MiniPingChart', miniChart],
  ['Instance', instancePage],
]) {
  assert.match(source, /getPingSeriesWithRecords/, `${name} must use the shared record visibility rule`);
  assert.doesNotMatch(
    source,
    /records\.some\(\(record\)\s*=>\s*(?:Number\()?record\.value(?:\))?\s*>=\s*0/,
    `${name} must not hide failed-only ping tasks from the legend`,
  );
}

console.log('ping chart failed series check passed');
