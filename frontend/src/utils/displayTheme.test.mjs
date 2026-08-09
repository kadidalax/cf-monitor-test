import assert from 'node:assert/strict';

const {
  displayThemes,
  defaultDisplayTheme,
  displayThemeLabels,
  normalizeDisplayTheme,
  getNextDisplayTheme,
} = await import('./displayTheme.ts');

// 两套内置主题：Next 已由 Aurora 全面接替并移除
assert.deepEqual([...displayThemes], ['monitor', 'aurora']);
assert.equal(defaultDisplayTheme, 'monitor');
assert.ok(!displayThemes.includes('next'), 'next 必须已退场');

// 归一化
assert.equal(normalizeDisplayTheme('aurora'), 'aurora');
assert.equal(normalizeDisplayTheme('monitor'), 'monitor');
assert.equal(normalizeDisplayTheme('uploaded-theme'), 'monitor'); // 上传主题回落基座
assert.equal(normalizeDisplayTheme(undefined), 'monitor');
assert.equal(normalizeDisplayTheme(null), 'monitor');
assert.equal(normalizeDisplayTheme(42), 'monitor');

// --- 回归锁：移除主题必须给出迁移目标，不能静默回落默认值 ---
// 陌生值一律回落 defaultDisplayTheme（monitor）。若移除 next 时忘了登记别名，
// 已选 Next 的存量用户会被打回 Monitor，而不是落到接替它的 Aurora——
// 表现为"升级后主题自己变了"，且不会有任何报错。
assert.equal(normalizeDisplayTheme('next'), 'aurora', 'next 必须迁移到 aurora，而非回落 monitor');
assert.notEqual(normalizeDisplayTheme('next'), defaultDisplayTheme, '迁移目标不得等同于默认回落');
assert.equal(normalizeDisplayTheme('cf-monitor'), 'aurora', 'cf-monitor 原指向 next，须跟随改指 aurora');

// 轮转
assert.equal(getNextDisplayTheme('monitor'), 'aurora');
assert.equal(getNextDisplayTheme('aurora'), 'monitor');

// 轮转一圈必须回到起点
let cursor = defaultDisplayTheme;
for (let i = 0; i < displayThemes.length; i += 1) cursor = getNextDisplayTheme(cursor);
assert.equal(cursor, defaultDisplayTheme, '轮转一圈必须回到起点');

// 轮转必须覆盖全部主题，不能漏掉任何一套
const visited = new Set();
cursor = defaultDisplayTheme;
for (let i = 0; i < displayThemes.length; i += 1) {
  visited.add(cursor);
  cursor = getNextDisplayTheme(cursor);
}
assert.deepEqual([...visited].sort(), [...displayThemes].sort());

// 非法值进入轮转时回落到第一套，不返回 undefined
assert.equal(getNextDisplayTheme('unknown-theme'), 'monitor');

// 每套主题都有展示名，供切换按钮 tooltip 使用；退场主题不得残留展示名
for (const theme of displayThemes) {
  assert.equal(typeof displayThemeLabels[theme], 'string');
  assert.ok(displayThemeLabels[theme].length > 0, `${theme} 缺少展示名`);
}
assert.equal(Object.keys(displayThemeLabels).length, displayThemes.length, '展示名表不得有多余条目');

console.log('displayTheme tests passed');
