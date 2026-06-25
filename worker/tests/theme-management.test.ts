import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const themeRoutes = readFileSync(join(import.meta.dirname, '..', 'src', 'routes', 'theme.ts'), 'utf8');
const workerIndex = readFileSync(join(import.meta.dirname, '..', 'src', 'index.ts'), 'utf8');
const dbQueries = readFileSync(join(import.meta.dirname, '..', 'src', 'db', 'queries.ts'), 'utf8');
const supabaseClient = readFileSync(join(import.meta.dirname, '..', 'src', 'db', 'supabase-api', 'client.ts'), 'utf8');

test('theme database facade exposes Supabase RPC storage operations', () => {
  for (const name of [
    'listThemes',
    'getTheme',
    'upsertTheme',
    'updateThemeSettings',
    'deleteTheme',
    'getThemeAsset',
  ]) {
    assert.match(dbQueries, new RegExp(`function ${name}|${name}\\(`));
  }
  for (const rpc of [
    'cfm_themes',
    'cfm_theme',
    'cfm_upsert_theme',
    'cfm_update_theme_settings',
    'cfm_delete_theme',
    'cfm_theme_asset',
  ]) {
    assert.match(supabaseClient, new RegExp(rpc));
  }
  assert.doesNotMatch(dbQueries, /database\.sql|pg\./);
});

test('theme routes provide admin management endpoints', () => {
  assert.match(themeRoutes, /export const adminThemeRoutes/);
  assert.match(themeRoutes, /adminThemeRoutes\.get\('\/'/);
  assert.match(themeRoutes, /adminThemeRoutes\.post\('\/upload'/);
  assert.match(themeRoutes, /adminThemeRoutes\.post\('\/set'/);
  assert.match(themeRoutes, /adminThemeRoutes\.post\('\/settings'/);
  assert.match(themeRoutes, /adminThemeRoutes\.post\('\/delete'/);
  assert.match(themeRoutes, /parseThemeZip/);
  assert.match(themeRoutes, /主题包解析失败/);
  assert.match(themeRoutes, /validateThemeConfig/);
  assert.doesNotMatch(themeRoutes, /validateCurrentAdminPassword|current_password|当前管理员密码/);
  assert.match(themeRoutes, /deleteTheme\(database, short\)/);
  assert.match(themeRoutes, /setSetting\(database, 'active_theme', 'monitor'\)/);
  assert.match(themeRoutes, /insertAuditLog/);
  assert.match(themeRoutes, /invalidatePublicMetadataCache/);
});

test('theme routes expose and configure built-in display themes', () => {
  assert.match(themeRoutes, /const BUILTIN_THEMES/);
  assert.match(themeRoutes, /short: 'monitor'/);
  assert.match(themeRoutes, /description: '项目内置Monitor主题'/);
  assert.match(themeRoutes, /short: 'next'/);
  assert.match(themeRoutes, /previewUrl: '\/theme-previews\/monitor\.svg'/);
  assert.match(themeRoutes, /previewUrl: '\/theme-previews\/next\.svg'/);
  assert.match(themeRoutes, /function builtinThemePreviewUrl/);
  assert.match(themeRoutes, /function normalizeActiveTheme/);
  assert.match(themeRoutes, /function isBuiltinTheme/);
  assert.match(themeRoutes, /upsertTheme\(database, builtin.theme/);
  assert.doesNotMatch(themeRoutes, /short === 'default'\) return c\.json\(\{ error: '主题 ID 无效' \}/);
});

test('theme routes provide public CSS, asset, and manifest endpoints', () => {
  assert.match(themeRoutes, /export const publicThemeRoutes/);
  assert.match(themeRoutes, /publicThemeRoutes\.get\('\/active\.css'/);
  assert.match(themeRoutes, /publicThemeRoutes\.get\('\/assets\/:theme\/\*'/);
  assert.match(themeRoutes, /publicThemeRoutes\.get\('\/manifest\/:theme'/);
  assert.match(themeRoutes, /buildThemeCss/);
  assert.match(themeRoutes, /text\/css; charset=utf-8/);
  assert.match(themeRoutes, /return cssResponse\(''\)/);
  assert.match(themeRoutes, /base64ToBytes/);
  assert.match(themeRoutes, /Cache-Control/);
  assert.match(themeRoutes, /themeAssetHeaders/);
  assert.match(themeRoutes, /X-Content-Type-Options/);
  assert.match(themeRoutes, /script-src 'none'/);
});

test('worker mounts theme routes before generic public and admin routes', () => {
  assert.match(workerIndex, /import \{ adminThemeRoutes, publicThemeRoutes \} from '\.\/routes\/theme'/);
  assert.ok(
    workerIndex.indexOf("app.route('/api/theme', publicThemeRoutes)") <
      workerIndex.indexOf("app.route('/api', publicRoutes)"),
    'public theme routes should be mounted before generic /api routes',
  );
  assert.ok(
    workerIndex.indexOf("app.route('/api/admin/themes', adminThemeRoutes)") <
      workerIndex.indexOf("app.route('/api/admin', adminRoutes)"),
    'admin theme routes should be mounted before generic admin routes',
  );
});
