import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const errorBoundarySource = readFileSync(
  join(import.meta.dirname, '..', 'src', 'components', 'ErrorBoundary.tsx'),
  'utf8',
);

test('ErrorBoundary hides internal error details outside development', () => {
  assert.match(errorBoundarySource, /const showDetail = import\.meta\.env\.DEV/);
  assert.match(errorBoundarySource, /showDetail && this\.state\.error/);
  assert.match(errorBoundarySource, /this\.state\.error\.message/);
});
