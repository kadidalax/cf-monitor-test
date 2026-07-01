import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const indexSource = readFileSync('frontend/src/pages/Index.tsx', 'utf8');
const listSource = readFileSync('frontend/src/components/WebsiteMonitorList.tsx', 'utf8');

assert.match(
  indexSource,
  /const handleWebsitePeriodChange = \(hours: number\) => \{[\s\S]*?setWebsitesLoading\(true\);[\s\S]*?setWebsitePeriodHours\(hours\);[\s\S]*?\};/,
  'website monitor period changes must enter loading before the next period render',
);
assert.match(
  indexSource,
  /onPeriodChange=\{handleWebsitePeriodChange\}/,
  'website monitor list must use the guarded period change handler',
);
assert.match(
  listSource,
  /const renderPeriodHours = loading \? lastPeriodRef\.current : periodHours;/,
  'website monitor list must keep the last rendered period while new checks load',
);

console.log('website monitor period loading check passed');
