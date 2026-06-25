import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync('frontend/src/components/MiniPingChartFloat.tsx', 'utf8');

assert.doesNotMatch(source, /<Popover\.Anchor\b/, '@radix-ui/themes Popover.Anchor drops children; use radix-ui PopoverPrimitive.Anchor');
assert.doesNotMatch(source, /<PopoverPrimitive\.Anchor\b/, 'ping chart button must be a real popover trigger, not only an anchor');
assert.match(source, /<PopoverPrimitive\.Trigger\s+asChild\b/, 'ping chart button must register as the popover trigger so second click closes it');
assert.doesNotMatch(source, /setOpen\(\(current\) => !current\)/, 'manual toggle fights Radix outside-click handling; let Popover.Trigger toggle');
assert.match(source, /event\.stopPropagation\(\)/, 'ping chart trigger must not bubble into the node card link');
assert.doesNotMatch(source, /<Popover\.Trigger>/, 'Radix trigger must not also toggle this nested link button');

console.log('mini ping chart toggle check passed');
