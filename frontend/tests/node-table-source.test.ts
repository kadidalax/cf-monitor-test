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

test('public node table shows resource percentages beside progress bars', () => {
  assert.match(source, /SortHeader column="cpu" style=\{\{ width: 118 \}\}/);
  assert.match(source, /SortHeader column="ram" style=\{\{ width: 118 \}\}/);
  assert.match(source, /SortHeader column="disk" style=\{\{ width: 118 \}\}/);

  const cellRule = rule('.node-table-resource-cell');
  assert.match(cellRule, /display:\s*grid/);
  assert.match(cellRule, /grid-template-columns:\s*minmax\(58px,\s*1fr\) max-content/);
  assert.match(cellRule, /align-items:\s*center/);
});

test('public node table defaults to backend manual order', () => {
  assert.match(source, /type SortKey = 'manual' \|/);
  assert.match(source, /useState<SortKey>\('manual'\)/);
  assert.match(source, /case 'manual':[\s\S]{0,120}getSortOrder\(a\) - getSortOrder\(b\)/);
});
