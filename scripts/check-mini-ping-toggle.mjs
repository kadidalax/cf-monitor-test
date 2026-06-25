import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync('frontend/src/components/MiniPingChartFloat.tsx', 'utf8');

assert.match(source, /setOpen\(\(current\) => !current\)/, 'ping chart trigger must toggle open state');
assert.match(source, /<Popover\.Anchor\b/, 'ping chart trigger should only anchor the popover');
assert.doesNotMatch(source, /<Popover\.Trigger>/, 'Radix trigger must not also toggle this nested link button');

console.log('mini ping chart toggle check passed');
