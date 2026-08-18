// 迁移文件内的「新增列 DDL」必须排在任何引用该列的语句之前。
//
// 为什么本地测不出来：全新库由 1_core_schema.sql 的 create table 建好全部列，
// 4_rpc_api.sql 里的 alter table ... add column 只是幂等兜底，顺序怎么排都无所谓。
// 只有**存量库**才会走到「列还不存在，就先创建引用它的函数」这条路径。
//
// 为什么必须是硬错误而不是延迟报错：language sql 的函数体在 CREATE 时就做完整语义校验，
// 列不存在直接 42703 中止整个迁移文件。language plpgsql 只做语法检查，能躲过去——
// 所以同一个漏改可能一个函数炸、另一个不炸，靠人读代码判断不可靠。
//
// 真实事故：clients.traffic_reset_day 在第 1456 行才 ALTER，却被第 68 行的
// cfm_admin_clients（language sql）引用，存量库 /db-init 报
// `column "traffic_reset_day" does not exist`，整批迁移无法应用。

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations');
const files = readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort();

assert.ok(files.length > 0, '没有扫到任何迁移文件，检查路径是否正确');

const ADD_COLUMN = /^\s*alter\s+table\s+(\w+)\s+add\s+column\s+if\s+not\s+exists\s+(\w+)/i;
const NOT_A_COLUMN = new Set([
  'primary', 'unique', 'foreign', 'check', 'constraint', 'exclude', 'like', 'create', 'partition',
]);

/** 解析 create table 块：返回每张表在本文件中由建表语句定义的列，以及这些块覆盖的行。 */
function scanCreateTables(lines) {
  const defined = new Map();
  const blockLines = new Array(lines.length).fill(false);
  let table = null;
  let depth = 0;

  lines.forEach((line, i) => {
    if (!table) {
      const start = line.match(/^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/i);
      if (!start) return;
      table = start[1];
      depth = 0;
      if (!defined.has(table)) defined.set(table, new Set());
    }
    blockLines[i] = true;
    const column = line.match(/^\s+"?(\w+)"?\s+\S/);
    if (column && !NOT_A_COLUMN.has(column[1].toLowerCase())) defined.get(table).add(column[1].toLowerCase());
    depth += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
    if (depth <= 0 && line.includes(')')) table = null;
  });

  return { defined, blockLines };
}

const violations = [];

for (const file of files) {
  // 注释里提到列名不算引用，否则本锁自己的说明文字就会触发它。
  const lines = readFileSync(join(migrationsDir, file), 'utf8')
    .split(/\r?\n/)
    .map(line => line.replace(/--.*$/, ''));

  const { defined, blockLines } = scanCreateTables(lines);

  // 同一列可能被幂等地 ALTER 多次，基准取最早的那次。
  const firstAdd = new Map();
  lines.forEach((line, i) => {
    const m = line.match(ADD_COLUMN);
    if (!m) return;
    const key = `${m[1]}.${m[2]}`;
    if (!firstAdd.has(key)) firstAdd.set(key, { table: m[1], column: m[2], line: i + 1 });
  });

  for (const { table, column, line } of firstAdd.values()) {
    // 本文件的 create table 已经定义了它，后面那条 add column 只是幂等兜底，顺序无关。
    if (defined.get(table)?.has(column.toLowerCase())) continue;

    const reference = new RegExp(`\\b${column}\\b`);
    for (let i = 0; i < line - 1; i++) {
      if (blockLines[i]) continue;
      if (!reference.test(lines[i])) continue;
      // 重复的 add column 语句本身不算「引用」。
      const dup = lines[i].match(ADD_COLUMN);
      if (dup && dup[2].toLowerCase() === column.toLowerCase()) continue;
      violations.push(
        `${file}: ${table}.${column} 的建列 DDL 在第 ${line} 行，` +
        `但第 ${i + 1} 行已经引用了它 → ${lines[i].trim().slice(0, 80)}`,
      );
      break;
    }
  }
}

assert.deepEqual(
  violations,
  [],
  '存量库应用迁移时会报 42703：\n' + violations.join('\n'),
);

// 口径自检：这条锁只有在真能抓到「引用早于建列」时才有意义。
// 上面全绿可能是因为扫描逻辑把所有情况都跳过了，所以这里造一个已知的坏样本验证它会红。
const probe = [
  'create or replace function public.f() returns void language sql as $$',
  '  select probe_col from clients;',
  '$$;',
  'alter table clients add column if not exists probe_col text;',
];
const probeAdd = probe.findIndex(l => ADD_COLUMN.test(l)) + 1;
const probeRef = probe.findIndex(l => /\bprobe_col\b/.test(l)) + 1;
assert.ok(probeRef > 0 && probeRef < probeAdd, '自检样本本身不成立');
assert.ok(
  !scanCreateTables(probe).defined.get('clients')?.has('probe_col'),
  'create table 扫描不得把 probe_col 当成已定义列——否则真实违规也会被跳过',
);

console.log(`ok - ${files.length} 个迁移文件的新增列 DDL 均早于其引用`);
