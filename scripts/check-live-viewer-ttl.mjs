import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('worker/src/do/live-data.ts', 'utf8');

assert.match(source, /viewerExpiresAt:\s*now\s*\+\s*normalizeViewerTtlMs\(url\.searchParams\.get\('viewer_ttl_ms'\)\)/);
assert.match(source, /this\.viewerExpiresAt\.set\(attachment\.clientId,\s*attachment\.viewerExpiresAt\)/);
assert.match(source, /this\.runBackground\('do_viewer_expiry',\s*this\.scheduleExpiryAlarm\(now\)\)/);
assert.match(source, /const expiresAt = this\.viewerExpiresAt\.get\(id\)/);
assert.match(source, /ws\.readyState !== WebSocket\.READY_STATE_OPEN/);

console.log('live viewer ttl check passed');
