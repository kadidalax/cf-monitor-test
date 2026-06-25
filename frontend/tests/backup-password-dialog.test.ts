import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const promptSource = readFileSync(join(import.meta.dirname, '..', 'src', 'utils', 'reauth.ts'), 'utf8');
const siteSource = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'admin', 'SettingsSite.tsx'), 'utf8');

test('password prompt binds labels and stays readable', () => {
  assert.match(promptSource, /interface RequestPasswordOptions/);
  assert.match(promptSource, /label\.htmlFor = inputId/);
  assert.match(promptSource, /input\.id = inputId/);
  assert.match(promptSource, /input\.autocomplete = options\.autocomplete \?\? 'current-password'/);
  assert.match(promptSource, /options\.validate\?\.\(input\.value\)/);
  assert.match(promptSource, /role', 'alert'/);
  assert.match(promptSource, /'background:#fff'/);
  assert.match(promptSource, /'color:#111827'/);
});

test('backup export asks for one six-character backup password before downloading', () => {
  assert.match(siteSource, /function backupEncryptPasswordError/);
  assert.match(siteSource, /备份文件密码，不是管理员登录密码/);
  assert.match(siteSource, /至少 6 位/);
  assert.match(siteSource, /autocomplete: 'new-password'/);
  assert.match(siteSource, /validate: backupEncryptPasswordError/);
  assert.match(siteSource, /Array\.from\(password\)\.length/);
  assert.doesNotMatch(siteSource, /confirm: true/);
});
