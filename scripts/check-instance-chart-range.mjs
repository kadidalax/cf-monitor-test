import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync('frontend/src/pages/Instance.tsx', 'utf8');
const monitorChartSection = source.split('{/* Chart section */}')[1]?.split('{/* Ping chart */}')[0] || '';

assert.match(
  source,
  /const monitorXAxisDomain = \[recordsRangeEnd - timeRangeMs\[timeRange\], recordsRangeEnd\] as \[number, number\];/,
  'instance monitor charts must keep the selected time range even when history has fewer points',
);
assert.match(
  monitorChartSection,
  /domain=\{monitorXAxisDomain\}/,
  'instance monitor charts must use the selected time range domain',
);
assert.doesNotMatch(
  monitorChartSection,
  /domain=\{\['dataMin', 'dataMax'\]\}/,
  'dataMin/dataMax collapses 3d/24h views to the available data span',
);

console.log('instance chart range check passed');
