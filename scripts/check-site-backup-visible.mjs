import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const page = readFileSync('frontend/src/pages/admin/SettingsSite.tsx', 'utf8');

assert.doesNotMatch(page, /title="备份与恢复"[^>]*defaultOpen=\{false\}/, 'backup restore card must not be collapsed by default');
assert.match(page, /title="备份与恢复"[^>]*defaultOpen\b/, 'backup restore card must be open by default');
assert.match(page, /<Download[^>]*\/> 导出加密完整备份/, 'backup export button must stay visible');
assert.match(page, /<Upload[^>]*\/> 导入备份/, 'backup import button must stay visible');

console.log('site backup visibility check passed');
