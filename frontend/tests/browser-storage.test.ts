import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  getLocalStorageItem,
  getSessionStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
  setSessionStorageItem,
} from '../src/utils/browserStorage.ts';

function withThrowingStorage(name: 'localStorage' | 'sessionStorage', fn: () => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      throw new Error('storage blocked');
    },
  });
  try {
    fn();
  } finally {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete (globalThis as Record<string, unknown>)[name];
  }
}

test('browser storage helpers survive blocked storage access', () => {
  withThrowingStorage('localStorage', () => {
    assert.equal(getLocalStorageItem('theme'), null);
    assert.equal(setLocalStorageItem('theme', 'dark'), false);
    assert.equal(removeLocalStorageItem('theme'), false);
  });
  withThrowingStorage('sessionStorage', () => {
    assert.equal(getSessionStorageItem('user'), null);
    assert.equal(setSessionStorageItem('user', '{}'), false);
  });
});

test('startup theme and node view storage reads are guarded', () => {
  const srcDir = join(import.meta.dirname, '..', 'src');
  const main = readFileSync(join(srcDir, 'main.tsx'), 'utf8');
  const themeContext = readFileSync(join(srcDir, 'contexts', 'ThemeContext.tsx'), 'utf8');
  const displayThemeContext = readFileSync(join(srcDir, 'contexts', 'DisplayThemeContext.tsx'), 'utf8');
  const nodeDisplay = readFileSync(join(srcDir, 'components', 'NodeDisplay.tsx'), 'utf8');

  for (const source of [main, themeContext, displayThemeContext, nodeDisplay]) {
    assert.match(source, /getLocalStorageItem/);
    assert.doesNotMatch(source, /localStorage\.getItem/);
  }
});

test('clipboard copy failures show a toast instead of bubbling', () => {
  const dashboard = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'admin', 'Dashboard.tsx'), 'utf8');
  assert.match(dashboard, /try \{[\s\S]*navigator\.clipboard\.writeText\(text\)/);
  assert.match(dashboard, /toast\.error\('复制失败，请手动复制'\)/);
});
