import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(join(import.meta.dirname, '..', 'src', 'utils', 'osIcon.ts'), 'utf8');

test('empty os labels stay blank instead of falling back to Linux', () => {
  assert.match(source, /if \(!osString\?\.trim\(\)\) return '-';/);
  assert.match(source, /name:\s*'-'/);
});
