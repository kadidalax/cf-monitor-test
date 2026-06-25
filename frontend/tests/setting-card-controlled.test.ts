import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(
  join(import.meta.dirname, '..', 'src', 'components', 'admin', 'SettingCard.tsx'),
  'utf8',
);

test('SettingCard accepts optional controlled open props', () => {
  assert.match(source, /open\?:\s*boolean/);
  assert.match(source, /onOpenChange\?:\s*\(open:\s*boolean\)\s*=>\s*void/);
});

test('SettingCard derives display state from controlled prop with internal fallback', () => {
  // 受控判定：open 是否为受控由 prop 是否传入决定
  assert.match(source, /controlledOpen\s*!==\s*undefined/);
  // 内部非受控 state 仍保留
  assert.match(source, /useState\(defaultOpen\)/);
});

test('SettingCard toggle routes through onOpenChange when controlled', () => {
  assert.match(source, /onOpenChange\?\.\(/);
});
