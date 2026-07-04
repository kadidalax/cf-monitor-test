import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const app = readFileSync('frontend/src/App.tsx', 'utf8');

assert.match(app, /path="notification"\s+element=\{<Navigate to="\/admin\/notifications\/settings" replace/, 'legacy notification root must redirect to canonical route');
assert.match(app, /path="notification\/:tab"\s+element=\{<LegacyAdminNotificationRedirect \/>/, 'legacy notification tabs must redirect to canonical route');
assert.doesNotMatch(app, /path="notification"\s+element=\{<AdminNotifications \/>/, 'legacy notification root must not render the page directly');
assert.doesNotMatch(app, /path="notification\/:tab"\s+element=\{<AdminNotifications \/>/, 'legacy notification tabs must not render the page directly');

console.log('notification canonical routes check passed');
