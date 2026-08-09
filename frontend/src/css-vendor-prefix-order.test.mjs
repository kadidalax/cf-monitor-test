import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// --- 回归锁：厂商前缀属性必须写在标准属性之前 ---
// Lightning CSS（Vite 的 CSS 压缩器）会把「标准属性在前、同名 -webkit- 别名在后」
// 判定为后者覆盖前者，压缩时直接丢掉标准属性，只留下前缀版本。
// 而 Chromium 并不认 -webkit-backdrop-filter（CSS.supports 返回 false），
// 结果是：dev 服务器（不压缩）一切正常，线上构建产物里效果整个消失。
//
// 2026-08-10 实测：`.nav-bar` 与 Aurora 玻璃材质在线上全部失效，
// 而本地 dev 一直显示正常，因此长期未被发现。改成「前缀在前」后两条声明都会保留。
//
// TSX 里 <style>{`...`}</style> 的 CSS 目前是运行时注入、不经压缩，暂不受影响，
// 但同样纳入检查：这类 CSS 一旦被挪进 index.css，坑会无声重现。
//
// 注意：dev 服务器测不出这类问题，验证视觉效果时要对着 frontend/dist 的产物跑。

const SRC = fileURLToPath(new URL('./', import.meta.url));

function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collect(p, out);
    else if (/\.(css|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = collect(SRC);
const offenders = [];
const webkitProps = new Set();
const standardProps = new Set();

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const cur = lines[i].trim();
    const next = (lines[i + 1] || '').trim();

    const std = cur.match(/^([a-z-]+)\s*:/);
    if (std && !std[1].startsWith('-')) {
      standardProps.add(std[1]);
      const pre = next.match(/^-webkit-([a-z-]+)\s*:/);
      if (pre && pre[1] === std[1]) {
        offenders.push(`${file.slice(SRC.length)}:${i + 1}  "${cur}" 之后紧跟 "${next}"`);
      }
    }

    const pre = cur.match(/^-webkit-([a-z-]+)\s*:/);
    if (pre) webkitProps.add(pre[1]);
  }
}

assert.deepEqual(
  offenders,
  [],
  `标准属性不得写在同名 -webkit- 前缀属性之前，压缩后标准属性会被丢弃：\n  ${offenders.join('\n  ')}`,
);

// 反向确认：有标准对应物的前缀属性必须带标准兜底，否则 Chromium 上直接失效。
// 部分属性只存在前缀形式（从未进标准），单独排除。
const PREFIX_ONLY = new Set(['font-smoothing', 'box-orient', 'line-clamp', 'tap-highlight-color', 'overflow-scrolling']);
const checked = [...webkitProps].filter(p => !PREFIX_ONLY.has(p));
for (const prop of checked) {
  assert.ok(standardProps.has(prop), `-webkit-${prop} 存在但没有标准 ${prop} 兜底，Chromium 不认前缀版本`);
}

console.log(`css-vendor-prefix-order.test.mjs: passed（扫描 ${files.length} 个文件；兜底检查：${checked.join(', ')}）`);
