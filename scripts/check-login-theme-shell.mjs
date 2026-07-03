import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

const login = read('frontend/src/pages/Login.tsx');
assert.doesNotMatch(login, /<Monitor\b/, 'login page must use the project app icon, not a generic Monitor icon');
assert.match(login, /src="\/app-icon\.png"/, 'login page logo must use /app-icon.png');
assert.match(login, /refreshActiveThemeStylesheet/, 'login page must load the active theme stylesheet');
assert.match(login, /setDisplayThemeFromSettings\(normalizeDisplayTheme\(data\.active_theme\)\)/, 'login page must apply public active_theme');

const adminLayout = read('frontend/src/pages/admin/AdminLayout.tsx');
assert.match(adminLayout, /setDisplayThemeFromSettings\(defaultDisplayTheme\)/, 'logout must clear local display-theme override');
assert.match(adminLayout, /setDisplayThemeFromSettings\(defaultDisplayTheme\)[\s\S]*logout\(\)[\s\S]*navigate\("\/"\)/, 'logout must reset display theme before returning to public page');

console.log('login theme shell check passed');
