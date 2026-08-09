import assert from 'node:assert/strict';

const {
  displayThemes,
  defaultDisplayTheme,
  displayThemeLabels,
  normalizeDisplayTheme,
  getNextDisplayTheme,
} = await import('./displayTheme.ts');

// 三套内置主题
assert.deepEqual([...displayThemes], ['monitor', 'next', 'aurora']);
assert.equal(defaultDisplayTheme, 'monitor');

// 归一化
assert.equal(normalizeDisplayTheme('aurora'), 'aurora');
assert.equal(normalizeDisplayTheme('next'), 'next');
assert.equal(normalizeDisplayTheme('monitor'), 'monitor');
assert.equal(normalizeDisplayTheme('cf-monitor'), 'next'); // 历史别名
assert.equal(normalizeDisplayTheme('uploaded-theme'), 'monitor'); // 上传主题回落基座
assert.equal(normalizeDisplayTheme(undefined), 'monitor');
assert.equal(normalizeDisplayTheme(null), 'monitor');
assert.equal(normalizeDisplayTheme(42), 'monitor');

// 轮转
assert.equal(getNextDisplayTheme('monitor'), 'next');
assert.equal(getNextDisplayTheme('next'), 'aurora');
assert.equal(getNextDisplayTheme('aurora'), 'monitor');

// 轮转一圈必须回到起点（二元实现下不可能通过）
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

// 每套主题都有展示名，供切换按钮 tooltip 使用
for (const theme of displayThemes) {
  assert.equal(typeof displayThemeLabels[theme], 'string');
  assert.ok(displayThemeLabels[theme].length > 0, `${theme} 缺少展示名`);
}

console.log('displayTheme tests passed');
