import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

const settingsSchema = read('worker/src/settings/schema.ts');
const activeThemeSchema = settingsSchema.match(/active_theme:\s*\{[\s\S]*?maxLength:\s*64,\s*\}/)?.[0] || '';
assert.match(activeThemeSchema, /defaultValue:\s*'monitor'/, 'active_theme must default to monitor');
assert.match(settingsSchema, /text\s*===\s*'default'\s*\?\s*'monitor'\s*:\s*text/, 'legacy active_theme=default must normalize to monitor');

const publicSettings = read('frontend/src/utils/publicSettings.ts');
assert.match(publicSettings, /active_theme:\s*'monitor'/, 'frontend public settings fallback must be monitor');
assert.match(publicSettings, /text\s*===\s*'default'\s*\?\s*'monitor'\s*:\s*text/, 'frontend public settings must normalize legacy default theme');

for (const migration of [
  'supabase/migrations/20260615000000_core_schema.sql',
  'supabase/migrations/20260618000000_feature_schema.sql',
]) {
  assert.match(read(migration), /\('active_theme',\s*'monitor'\)/, `${migration} must seed active_theme as monitor`);
}

assert.match(
  read('frontend/src/pages/admin/Themes.tsx'),
  /Monitor 主题/,
  'delete-theme copy should name the real fallback theme',
);
