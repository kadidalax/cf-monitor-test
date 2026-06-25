import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const app = readFileSync(join(import.meta.dirname, '..', 'src', 'App.tsx'), 'utf8');
const menu = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'admin', 'adminMenu.tsx'), 'utf8');
const themes = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'admin', 'Themes.tsx'), 'utf8');
const css = readFileSync(join(import.meta.dirname, '..', 'src', 'index.css'), 'utf8');
const layout = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'Layout.tsx'), 'utf8');
const displayThemeContext = readFileSync(join(import.meta.dirname, '..', 'src', 'contexts', 'DisplayThemeContext.tsx'), 'utf8');
const themeEvents = readFileSync(join(import.meta.dirname, '..', 'src', 'utils', 'themeEvents.ts'), 'utf8');

test('admin app exposes theme management route and menu item', () => {
  assert.match(app, /const AdminThemes = lazy\(\(\) => import\('\.\/pages\/admin\/Themes'\)\)/);
  assert.match(app, /<Route path="themes" element=\{<AdminThemes \/>\} \/>/);
  assert.match(menu, /Palette/);
  assert.match(menu, /path: '\/admin\/themes'/);
  assert.match(menu, /label: '主题管理'/);
  assert.match(menu, /pathname\.startsWith\('\/admin\/themes'\)/);
  assert.match(menu, /return '主题管理'/);
});

test('theme management page uses card grid upload and theme actions', () => {
  assert.match(themes, /function AdminThemes/);
  assert.doesNotMatch(themes, /import NodeCard/);
  assert.doesNotMatch(themes, /fetchPublicBootstrap/);
  assert.doesNotMatch(themes, /admin-theme-live-preview/);
  assert.match(themes, /className="admin-themes-page"/);
  assert.match(themes, /className="admin-parent-title-row admin-server-title-row"/);
  assert.match(themes, /className="admin-theme-page-actions"/);
  assert.match(themes, /className="admin-theme-page-actions"[\s\S]*className="admin-theme-package-guidance"[\s\S]*上传主题包/);
  assert.doesNotMatch(themes, /admin-theme-overview-hero/);
  assert.doesNotMatch(themes, /uploadedThemeCount/);
  assert.match(themes, /className="admin-theme-grid"/);
  assert.match(themes, /type="file"/);
  assert.match(themes, /accept="\.zip,application\/zip"/);
  assert.match(themes, /apiFetch\('\/admin\/themes'/);
  assert.match(themes, /apiFetch\('\/admin\/themes\/upload'/);
  assert.match(themes, /apiFetch\('\/admin\/themes\/set'/);
  assert.match(themes, /apiFetch\('\/admin\/themes\/settings'/);
  assert.match(themes, /apiFetch\('\/admin\/themes\/delete'/);
  assert.match(themes, /启用/);
  assert.match(themes, /配置/);
  assert.match(themes, /删除/);
  assert.doesNotMatch(themes, /current_password/);
  assert.doesNotMatch(themes, /当前管理员密码/);
  assert.match(themes, /useDisplayTheme/);
  assert.match(themes, /notifyThemeUpdated/);
  assert.match(themes, /setDisplayTheme\(normalizeDisplayTheme\(nextActiveTheme\)\)/);
  assert.doesNotMatch(themes, /详情/);
  assert.doesNotMatch(themes, /detailTheme/);
  assert.doesNotMatch(themes, /disabled=\{theme\.short === 'default'\}/);
});

test('built-in themes have ordinary node-card preview images', () => {
  assert.equal(existsSync(join(import.meta.dirname, '..', 'public', 'theme-previews', 'monitor.svg')), true);
  assert.equal(existsSync(join(import.meta.dirname, '..', 'public', 'theme-previews', 'next.svg')), true);
});

test('theme configuration supports manifest fields and custom CSS', () => {
  assert.match(themes, /configuration\?\.data/);
  assert.match(themes, /renderConfigField/);
  assert.match(themes, /type === 'switch'/);
  assert.match(themes, /type === 'select'/);
  assert.match(themes, /type === 'number'/);
  assert.match(themes, /type === 'richtext'/);
  assert.match(themes, /type === 'color'/);
  assert.match(themes, /type === 'image'/);
  assert.match(themes, /type === 'range'/);
  assert.match(themes, /customCss/);
  assert.match(themes, /自定义 CSS/);
  assert.match(themes, /可以调整前台页面的颜色、背景、字体、间距、圆角、阴影、导航栏、节点卡片、统计卡片、按钮、徽章和响应式样式/);
  assert.match(themes, /不能修改后台页面、数据来源、接口逻辑、通知规则或新增交互功能/);
  assert.match(themes, /可改区域示例/);
  assert.match(themes, /插入/);
  assert.match(themes, /预览/);
  assert.match(themes, /恢复/);
  assert.match(themes, /return clearPreviewCss/);
  assert.match(themes, /\.nav-bar/);
  assert.match(themes, /\.node-card/);
  assert.match(themes, /\.monitor-stat-card/);
  assert.match(themes, /\.usage-bar-fill/);
});

test('theme management page exposes package guidance without a details action', () => {
  assert.doesNotMatch(themes, /主题详情/);
  assert.doesNotMatch(themes, /主题 ID/);
  assert.match(themes, /cf-monitor-theme\.json/);
  assert.match(themes, /\.woff2/);
  assert.match(themes, /color、image、range/);
});

test('theme management styles define a stable card grid', () => {
  assert.match(css, /\.admin-theme-grid\s*\{/);
  assert.match(css, /\.admin-theme-package-guidance\s*\{/);
  assert.match(css, /grid-template-columns:\s*repeat\(auto-fill, minmax\(260px, 1fr\)\)/);
  assert.match(css, /\.admin-theme-preview\s*\{/);
  assert.match(css, /\.admin-theme-card\s*\{[^}]*min-height:\s*0;/s);
  assert.match(css, /\.admin-theme-preview\s*\{[^}]*max-height:\s*150px;/s);
  assert.match(css, /\.admin-theme-description\s*\{[^}]*min-height:\s*0;/s);
  assert.match(css, /\.admin-theme-actions\s*\{[^}]*gap:\s*6px;/s);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.admin-theme-upload-action\s*\{[\s\S]{0,120}margin-left:\s*auto/);
  assert.doesNotMatch(css, /\.admin-theme-live-preview/);
  assert.match(css, /\.admin-theme-actions\s*\{/);
});

test('public active theme stylesheet loader is installed once', () => {
  assert.match(layout, /cf-monitor-active-theme-css/);
  assert.match(layout, /\/api\/theme\/active\.css/);
  assert.match(layout, /ensureActiveThemeStylesheet/);
  assert.match(layout, /setDisplayThemeFromSettings/);
  assert.match(layout, /if \(!hasLocalDisplayThemePreference\(\)\)/);
  assert.match(layout, /setDisplayThemeFromSettings\(normalizeDisplayTheme\(data\.active_theme\)\)/);
  assert.match(layout, /subscribeThemeUpdated/);
  assert.match(layout, /fetchPublicSettings\(\{ force: true/);
  assert.match(layout, /refreshActiveThemeStylesheet/);
});

test('top-right display theme toggle survives public settings refreshes', () => {
  assert.match(displayThemeContext, /DISPLAY_THEME_SOURCE_KEY = 'cf-monitor-display-theme-source'/);
  assert.match(displayThemeContext, /hasLocalDisplayThemePreference/);
  assert.match(displayThemeContext, /setDisplayThemeFromSettings/);
  assert.match(displayThemeContext, /storeDisplayTheme\(next, 'local'\)/);
  assert.match(displayThemeContext, /storeDisplayTheme\(theme, 'server'\)/);
  assert.doesNotMatch(layout, /setDisplayTheme\(normalizeDisplayTheme\(data\.active_theme\)\)/);
});

test('theme updates notify open public pages across tabs', () => {
  assert.match(themeEvents, /THEME_UPDATED_EVENT/);
  assert.match(themeEvents, /localStorage\.setItem\(THEME_UPDATED_EVENT/);
  assert.match(themeEvents, /new BroadcastChannel\(CHANNEL_NAME\)/);
  assert.match(themeEvents, /window\.addEventListener\('storage', onStorage\)/);
});
