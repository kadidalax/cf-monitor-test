import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const index = readFileSync('worker/src/index.ts', 'utf8');

assert.doesNotMatch(index, /dev-agent|BUILD_MARK\s*=\s*['"]agent-ws/i, 'version endpoint must not expose dev build marks');
assert.match(index, /build:\s*`release-\$\{appVersion\}`/, 'version endpoint should expose a stable release build mark');

console.log('release version build check passed');
