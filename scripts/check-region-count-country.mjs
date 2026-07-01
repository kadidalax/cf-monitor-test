import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync('frontend/src/utils/monitorView.ts', 'utf8');

assert.match(
  source,
  /resolveFlagCode/,
  'node region count must normalize regions to country codes',
);
assert.doesNotMatch(
  source,
  /\.map\(\(client\)\s*=>\s*client\.region\)/,
  'node region count must not count raw city-level region strings',
);

console.log('region count country check passed');
