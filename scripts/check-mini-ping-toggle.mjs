import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync('frontend/src/components/MiniPingChartFloat.tsx', 'utf8');

assert.match(source, /setOpen\(\(current\) => !current\)/, 'ping chart trigger must toggle open state');
assert.doesNotMatch(source, /<Popover\.Anchor\b/, '@radix-ui/themes Popover.Anchor drops children; use radix-ui PopoverPrimitive.Anchor');
assert.match(source, /<PopoverPrimitive\.Anchor\s+asChild\b/, 'ping chart trigger must render as a visible primitive anchor');
assert.doesNotMatch(source, /<Popover\.Trigger>/, 'Radix trigger must not also toggle this nested link button');

console.log('mini ping chart toggle check passed');
