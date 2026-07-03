import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

const login = read('frontend/src/pages/Login.tsx');
assert.doesNotMatch(login, /<Monitor\b/, 'login page must use the project app icon, not a generic Monitor icon');
assert.match(login, /src="\/app-icon\.png"/, 'login page logo must use /app-icon.png');
assert.match(login, /refreshActiveThemeStylesheet/, 'login page must load the active theme stylesheet');
assert.match(login, /setDisplayThemeFromSettings\(normalizeDisplayTheme\(data\.active_theme\)\)/, 'login page must apply public active_theme');
assert.match(login, /hasLocalDisplayThemePreference\(\)/, 'login page must not overwrite local display-theme preference');

const layout = read('frontend/src/pages/Layout.tsx');
assert.match(layout, /hasLocalDisplayThemePreference\(\)/, 'public layout must not overwrite local display-theme preference');

const adminLayout = read('frontend/src/pages/admin/AdminLayout.tsx');
assert.doesNotMatch(adminLayout, /defaultDisplayTheme/, 'logout must not force the default theme');
assert.match(adminLayout, /document\.documentElement\.getAttribute\("data-monitor-theme"\)/, 'logout must read the currently applied display theme');
assert.match(adminLayout, /setDisplayTheme\(currentDisplayTheme\)[\s\S]*logout\(\)[\s\S]*navigate\("\/"\)/, 'logout must preserve theme before returning to public page');

const publicRoutes = read('worker/src/routes/public.ts');
assert.doesNotMatch(
  publicRoutes,
  /LOGOUT_CLEAR_SITE_DATA_HEADER\s*=\s*[^;]*storage/i,
  'logout must not clear browser storage because it contains display-theme preference',
);

console.log('login theme shell check passed');
