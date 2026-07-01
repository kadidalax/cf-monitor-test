import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync('frontend/src/components/MiniPingChartFloat.tsx', 'utf8');
const nodeCardSource = readFileSync('frontend/src/components/NodeCard.tsx', 'utf8');

assert.doesNotMatch(source, /<Popover\.Anchor\b/, '@radix-ui/themes Popover.Anchor drops children; use radix-ui PopoverPrimitive.Anchor');
assert.doesNotMatch(source, /<PopoverPrimitive\.Anchor\b/, 'ping chart button must be a real popover trigger, not only an anchor');
assert.match(source, /<PopoverPrimitive\.Trigger\s+asChild\b/, 'ping chart button must register as the popover trigger so second click closes it');
assert.doesNotMatch(source, /setOpen\(\(current\) => !current\)/, 'manual toggle fights Radix outside-click handling; let Popover.Trigger toggle');
assert.doesNotMatch(source, /const handleTriggerClick = useCallback\(\(event: React\.MouseEvent<HTMLElement>\) => \{[^}]*event\.stopPropagation\(\);/, 'ping chart click must bubble to the parent Link so navigation can be cancelled after Radix toggles');
assert.match(source, /const handleTriggerPointerDown = useCallback\(\(event: React\.PointerEvent<HTMLElement>\) => \{[^}]*event\.stopPropagation\(\);/, 'ping chart pointer down should stay isolated from the node card link');
assert.doesNotMatch(source, /<Popover\.Trigger>/, 'Radix trigger must not also toggle this nested link button');

assert.match(nodeCardSource, /handleCardLinkClick/, 'node card link must cancel navigation for nested action buttons');
assert.match(nodeCardSource, /closest\('\[data-node-card-action="true"\]'\)/, 'node card link must detect ping chart action clicks explicitly');
assert.match(nodeCardSource, /event\.preventDefault\(\)/, 'ping chart action clicks must cancel the parent card link default navigation');
assert.match(nodeCardSource, /data-node-card-action="true"/, 'ping chart trigger button must be marked as a node card action');

console.log('mini ping chart toggle check passed');
