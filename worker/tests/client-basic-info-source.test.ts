import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const clientSource = readFileSync(join(import.meta.dirname, '..', 'src', 'routes', 'client.ts'), 'utf8');

test('agent basic info live metadata does not overwrite admin billing fields', () => {
  const match = clientSource.match(/function buildSafeLiveBasicInfoClient[\s\S]*?async function syncLiveBasicInfoMetadata/);
  assert.ok(match, 'Missing buildSafeLiveBasicInfoClient block');
  const block = match[0];

  assert.doesNotMatch(block, /\bprice:/);
  assert.doesNotMatch(block, /\bbilling_cycle:/);
  assert.doesNotMatch(block, /\bcurrency:/);
  assert.doesNotMatch(block, /\bexpired_at:/);
  assert.doesNotMatch(block, /\bauto_renewal:/);
});
