import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

const login = read('frontend/src/pages/Login.tsx');
assert.doesNotMatch(login, /<Monitor\b/, 'login page must use the project app icon, not a generic Monitor icon');
assert.match(login, /src="\/app-icon\.png"/, 'login page logo must use /app-icon.png');
assert.match(login, /refreshActiveThemeStylesheet/, 'login page must load the active theme stylesheet');
assert.match(login, /setDisplayThemeFromSettings\(normalizeDisplayTheme\(data\.active_theme\)\)/, 'login page must apply public active_theme');
assert.match(login, /hasLocalDisplayThemePreference\(\)/, 'login page must not overwrite local display-theme preference');

const adminLayout = read('frontend/src/pages/admin/AdminLayout.tsx');
assert.doesNotMatch(adminLayout, /defaultDisplayTheme/, 'logout must not force the default theme');
assert.match(adminLayout, /setDisplayTheme\(displayTheme\)/, 'logout must preserve the current display theme as the local preference');
assert.match(adminLayout, /setDisplayTheme\(displayTheme\)[\s\S]*logout\(\)[\s\S]*navigate\("\/"\)/, 'logout must preserve theme before returning to public page');

console.log('login theme shell check passed');
