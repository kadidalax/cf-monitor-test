import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('worker/src/routes/websocket.ts', 'utf8');

assert.match(source, /c\.req\.query\('token'\)/, 'agent WebSocket must accept ?token= for Worker clients that cannot set Authorization headers');
assert.match(source, /bearerToken\(c\)\s*\|\|/, 'Authorization header must remain preferred while query token is a fallback');

console.log('agent ws query token check passed');
