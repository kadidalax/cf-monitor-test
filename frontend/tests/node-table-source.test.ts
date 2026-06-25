import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const css = readFileSync(join(import.meta.dirname, '..', 'src', 'index.css'), 'utf8');
const source = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'NodeTable.tsx'), 'utf8');

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, 's'));
  assert.ok(match?.groups?.body, `Missing CSS rule: ${selector}`);
  return match.groups.body;
}

test('public node table keeps identity and status content on one centered row', () => {
  assert.match(source, /SortHeader column="name" style=\{\{ width: 180 \}\}/);
  assert.match(source, /SortHeader column="os" style=\{\{ width: 132 \}\}/);
  assert.match(source, /SortHeader column="status" style=\{\{ width: 136 \}\}/);
  assert.match(source, /className="node-table-status-stack"/);

  const statusRule = rule('.node-table-status-stack');
  assert.match(statusRule, /align-items:\s*center/);
  assert.match(statusRule, /white-space:\s*nowrap/);
});
