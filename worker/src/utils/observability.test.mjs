import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..');

// 不能 import observability.ts：它经 '../db/queries' 无扩展名导入，
// node 的 TS 剥离解析不了。注册表因此从源码里解析出来——
// 反正写入点也是扫源码，两边同源才谈得上「对得上」。
const OBSERVABILITY_SRC = readFileSync(join(HERE, 'observability.ts'), 'utf8');
const STORED_HEALTH_COMPONENTS = (() => {
  const block = OBSERVABILITY_SRC.match(
    /export const STORED_HEALTH_COMPONENTS = \[([\s\S]*?)\] as const;/,
  );
  if (!block) throw new Error('没能从 observability.ts 里解析出 STORED_HEALTH_COMPONENTS');
  return [...block[1].matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]);
})();

function collectTsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

// 把整份源码压成单行再匹配：这些调用大多是多行参数，
// 逐行正则会整片漏掉，看起来「零个写入点」而测试照样绿。
const SOURCE = collectTsFiles(SRC_ROOT)
  .map(file => readFileSync(file, 'utf8'))
  .join('\n')
  .replace(/\s+/g, ' ');

// 每个写入点的组件名都是第几个参数，写死在这里。
const WRITE_SITES = [
  { fn: 'bestEffortRecordHealthEvent', argIndex: 1 },
  { fn: 'recordHealthEvent', argIndex: 1 },
  { fn: 'runBackground', argIndex: 0 },
  { fn: 'recordHotPathHealthOk', argIndex: 0 },
  { fn: 'runScheduledStep', argIndex: 1 },
  { fn: 'record', argIndex: 2 },
];

function literalsAt(fn, argIndex) {
  const found = new Set();
  // 只收字面量：变量形参（component）交给 tsc 的 StoredHealthComponent 去管，
  // 这里管的是「有没有人写了注册表外的字符串」。
  const call = new RegExp(`\\b${fn}\\(([^()]*(?:\\([^()]*\\)[^()]*)*)\\)`, 'g');
  for (const match of SOURCE.matchAll(call)) {
    const args = splitTopLevelArgs(match[1]);
    const arg = args[argIndex];
    if (arg && /^'[a-z0-9_]+'$/.test(arg.trim())) {
      found.add(arg.trim().slice(1, -1));
    }
  }
  return found;
}

function splitTopLevelArgs(text) {
  const args = [];
  let depth = 0;
  let current = '';
  let quote = '';
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      args.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  args.push(current);
  return args;
}

const writtenComponents = new Set();
for (const { fn, argIndex } of WRITE_SITES) {
  for (const name of literalsAt(fn, argIndex)) writtenComponents.add(name);
}

// 有的写入点先把名字存进变量再传（live-data.ts 的
// `const component = 'agent_policy_website_probe_tasks'`），
// 调用处看不到字面量。这类赋值也算写入点。
for (const match of SOURCE.matchAll(/\bcomponent(?:: [A-Za-z]+)? = '([a-z0-9_]+)'/g)) {
  writtenComponents.add(match[1]);
}

test('注册表本身无重复', () => {
  assert.equal(STORED_HEALTH_COMPONENTS.length, 18, '注册表条数变了：确认是有意增删，再改这个数字');
  assert.equal(
    new Set(STORED_HEALTH_COMPONENTS).size,
    STORED_HEALTH_COMPONENTS.length,
    '重复名字会让健康页出现两条同名组件，且后写的静默盖掉前一条',
  );
});

test('扫描确实找到了写入点（否则下面两条断言是空转）', () => {
  // 没有这条，任何一次重构改掉函数名都会让扫描结果变成空集，
  // 而空集天然满足「⊆ 注册表」，测试会假绿。
  assert.ok(
    writtenComponents.size >= 15,
    `只扫到 ${writtenComponents.size} 个写入点字面量，正则多半已经失配`,
  );
});

test('所有写入点用到的组件名都在注册表内', () => {
  const registry = new Set(STORED_HEALTH_COMPONENTS);
  const unknown = [...writtenComponents].filter(name => !registry.has(name));
  assert.deepEqual(
    unknown,
    [],
    '这些名字写进了 settings 但 readHealthEvents 不会去读，健康页永远看不到它们',
  );
});

test('注册表里没有无人写入的孤儿组件', () => {
  const orphans = STORED_HEALTH_COMPONENTS.filter(name => !writtenComponents.has(name));
  assert.deepEqual(
    orphans,
    [],
    '注册表列了但没有任何写入点：要么名字拼错了，要么该写入点已被删除',
  );
});
