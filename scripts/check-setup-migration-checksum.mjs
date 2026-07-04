import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const setup = readFileSync('worker/src/routes/setup.ts', 'utf8');

assert.match(setup, /checksum:\s*string/, 'setup migrations must load stored checksums');
assert.match(setup, /checksum\s*===\s*migration\.checksum/, 'setup must skip only matching checksums');
assert.match(setup, /on conflict \(version\) do update[\s\S]*checksum = excluded\.checksum/i, 'setup must refresh changed grouped migrations');

console.log('setup migration checksum check passed');
