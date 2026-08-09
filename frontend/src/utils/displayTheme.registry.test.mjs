import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const { displayThemes } = await import('./displayTheme.ts');

// 一套内置主题分散在四处：前端 displayThemes、Worker BUILTIN_THEMES、index.css 的
// 主题变量块、main.tsx 的 Radix 强调色表。少写任何一处都不会报错——normalizeDisplayTheme
// 会把陌生值静默归一成 monitor，表现为「后台能选、切过去毫无变化」。本文件把四处锁在一起。
// 退场主题的迁移别名同样是两处独立定义（前端 + Worker），一并锁住。

const workerThemeRoute = readFileSync(new URL('../../../worker/src/routes/theme.ts', import.meta.url), 'utf8');
const frontendModule = readFileSync(new URL('./displayTheme.ts', import.meta.url), 'utf8');

const builtinBlock = workerThemeRoute.slice(
  workerThemeRoute.indexOf('const BUILTIN_THEMES = ['),
  workerThemeRoute.indexOf('] as const;', workerThemeRoute.indexOf('const BUILTIN_THEMES = [')),
);
assert.ok(builtinBlock.length > 0, '未能在 worker/src/routes/theme.ts 里定位 BUILTIN_THEMES');

const builtinShorts = [...builtinBlock.matchAll(/short:\s*'([A-Za-z0-9_-]+)'/g)].map(m => m[1]);
const builtinPreviews = [...builtinBlock.matchAll(/previewUrl:\s*'([^']+)'/g)].map(m => m[1]);

// --- 回归锁：Worker 内置主题清单必须与前端主题清单逐项相同 ---
// 只在 Worker 加一套，后台会列出它，但前端 normalizeDisplayTheme 认不得，
// 保存后回落 monitor；只在前端加一套，后台则根本选不到。
assert.deepEqual(
  builtinShorts,
  [...displayThemes],
  'worker BUILTIN_THEMES 与前端 displayThemes 必须完全一致（含顺序）',
);

// --- 回归锁：每套内置主题的预览图必须真实存在 ---
assert.equal(builtinPreviews.length, builtinShorts.length, '每套内置主题都要有 previewUrl');
for (const [index, previewUrl] of builtinPreviews.entries()) {
  const short = builtinShorts[index];
  assert.equal(previewUrl, `/theme-previews/${short}.svg`, `${short} 的 previewUrl 命名不符合约定`);
  const file = new URL(`../../public${previewUrl}`, import.meta.url);
  assert.ok(existsSync(file), `${short} 的预览图 ${previewUrl} 不存在，后台主题卡片会裂图`);
}

// --- 回归锁：每套主题都要有 CSS 变量块，否则切过去和默认主题长得一样 ---
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
for (const theme of displayThemes) {
  assert.ok(
    css.includes(`html[data-monitor-theme='${theme}']`),
    `index.css 缺少 ${theme} 的主题块——切换后不会有任何视觉变化`,
  );
}

// 深色模式必须单独覆盖：只写浅色块会让深色下沿用上一套主题的深色变量。
// 两条路径都要有——显式 data-theme-appearance='dark' 和跟随系统的 prefers-color-scheme。
for (const theme of displayThemes) {
  if (theme === 'monitor') continue; // monitor 是 :root 默认，深色由基础 html[data-theme-appearance='dark'] 兜底
  assert.ok(
    css.includes(`html[data-theme-appearance='dark'][data-monitor-theme='${theme}']`),
    `${theme} 缺少显式深色块`,
  );
  assert.ok(
    css.includes(`html:not([data-theme-appearance='light'])[data-monitor-theme='${theme}']`),
    `${theme} 缺少跟随系统的深色块`,
  );
}

// --- 回归锁：Radix 强调色表必须覆盖全部主题 ---
// 该表是 Record<DisplayTheme, ...>，漏项 tsc 会报错；但值写成 Radix 不认识的色名
// 只会在运行时静默失效，所以这里同时校验取值。
const mainTsx = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
const accentBlock = mainTsx.slice(
  mainTsx.indexOf('const ACCENT_BY_DISPLAY_THEME'),
  mainTsx.indexOf('};', mainTsx.indexOf('const ACCENT_BY_DISPLAY_THEME')),
);
assert.ok(accentBlock.length > 0, '未能在 main.tsx 里定位 ACCENT_BY_DISPLAY_THEME');

const RADIX_ACCENT_COLORS = new Set([
  'gray', 'gold', 'bronze', 'brown', 'yellow', 'amber', 'orange', 'tomato', 'red', 'ruby',
  'crimson', 'pink', 'plum', 'purple', 'violet', 'iris', 'indigo', 'blue', 'cyan', 'teal',
  'jade', 'green', 'grass', 'lime', 'mint', 'sky',
]);
for (const theme of displayThemes) {
  const match = accentBlock.match(new RegExp(`${theme}:\\s*'([a-z]+)'`));
  assert.ok(match, `ACCENT_BY_DISPLAY_THEME 缺少 ${theme}`);
  assert.ok(
    RADIX_ACCENT_COLORS.has(match[1]),
    `${theme} 的强调色 '${match[1]}' 不是 Radix 合法色名，运行时会被忽略`,
  );
}

// --- 回归锁：退场主题的迁移别名，前端与 Worker 必须一致 ---
// 前端 legacyDisplayThemeMap 决定浏览器渲染哪套主题；
// Worker LEGACY_THEME_ALIASES 决定后台把哪套标成「当前」、以及 /api/theme 各端点如何解析。
// 两处独立定义，漏改一处的表现是「前台显示 Aurora，后台没有任何主题标为当前」。
function parseMap(source, anchor) {
  const start = source.indexOf(anchor);
  assert.ok(start >= 0, `未能定位 ${anchor}`);
  const block = source.slice(start, source.indexOf('};', start));
  const out = {};
  for (const m of block.matchAll(/'?([A-Za-z0-9_-]+)'?:\s*'([A-Za-z0-9_-]+)'/g)) out[m[1]] = m[2];
  return out;
}

const frontendAliases = parseMap(frontendModule, 'const legacyDisplayThemeMap');
const workerAliases = parseMap(workerThemeRoute, 'const LEGACY_THEME_ALIASES');

assert.ok(Object.keys(frontendAliases).length > 0, '未解析到前端迁移别名表');
assert.deepEqual(
  frontendAliases,
  workerAliases,
  '前端 legacyDisplayThemeMap 与 Worker LEGACY_THEME_ALIASES 必须逐项一致',
);

// 别名目标必须是仍然存在的主题，否则等于把用户迁到一个不存在的地方
for (const [from, to] of Object.entries(frontendAliases)) {
  assert.ok(displayThemes.includes(to), `别名 ${from} → ${to} 的目标不在 displayThemes 中`);
  assert.ok(!displayThemes.includes(from), `${from} 仍在 displayThemes 中，不该同时是别名`);
}

// --- 回归锁：Next 已退场，且退得干净 ---
assert.ok(!displayThemes.includes('next'), 'next 必须已从主题清单移除');
assert.equal(frontendAliases.next, 'aurora', 'next 必须登记为迁移到 aurora');
assert.ok(
  !existsSync(new URL('../../public/theme-previews/next.svg', import.meta.url)),
  'next.svg 预览图应已删除',
);
assert.ok(
  !css.includes(`data-monitor-theme='next'`),
  'index.css 不得残留 next 主题选择器',
);
assert.ok(
  !workerThemeRoute.includes(`short: 'next'`),
  'Worker BUILTIN_THEMES 不得残留 next',
);

// --- 回归锁：退场主题的 short 必须是保留字 ---
// 移除内置主题会让 isBuiltinTheme 对它返回 false，上传端点的"不能覆盖内置主题"
// 便不再拦它。而它一旦被上传占用：别名会把启用请求重定向到接替者、列表过滤把它藏起来、
// 删除端点经别名后又判定为内置——上传成功却永久卡死且不可见。
assert.match(
  workerThemeRoute,
  /function isReservedThemeShort/,
  '必须存在保留 short 判定（内置 + 退场别名）',
);
assert.match(
  workerThemeRoute,
  /if \(isReservedThemeShort\(parsed\.theme\.short\)\) return c\.json\(\{ error: '不能覆盖内置主题' \}, 400\);/,
  '上传端点必须用保留字判定，只查 isBuiltinTheme 会放过退场主题名',
);
assert.match(
  workerThemeRoute,
  /\.filter\(theme => !isReservedThemeShort\(theme\.short\)\)/,
  '上传主题列表必须排除保留 short',
);

console.log('displayTheme.registry.test.mjs: all assertions passed');