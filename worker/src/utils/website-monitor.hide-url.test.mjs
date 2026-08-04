import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { validateWebsiteMonitorInput } = await import('./website-monitor.ts');

const base = {
  name: '测试监控',
  url: 'https://example.com',
  method: 'GET',
  expected_status_min: 200,
  expected_status_max: 399,
  interval_sec: 300,
  timeout_sec: 10,
  grace_period_sec: 180,
};

// --- hide_url 的解析与默认值 ---
{
  const r = validateWebsiteMonitorInput({ ...base });
  assert.equal(r.ok, true);
  assert.equal(r.value.hide_url, false, '未传时默认为 false，保持既有监控行为不变');
}
{
  const r = validateWebsiteMonitorInput({ ...base, hide_url: true });
  assert.equal(r.ok, true);
  assert.equal(r.value.hide_url, true);
}
{
  const r = validateWebsiteMonitorInput({ ...base, hide_url: 'true' });
  assert.equal(r.ok, true);
  assert.equal(r.value.hide_url, false, '非布尔值不得被当作开启——避免误开导致地址意外暴露以外的歧义');
}
// hide_url 与 hidden 相互独立
{
  const r = validateWebsiteMonitorInput({ ...base, hide_url: true, hidden: false });
  assert.equal(r.value.hide_url, true);
  assert.equal(r.value.hidden, false);
}

// --- 服务端出口裁剪：SQL 与广播两条路径 ---
const rpc = readFileSync(new URL('../../../supabase/migrations/4_rpc_api.sql', import.meta.url), 'utf8');
assert.match(
  rpc,
  /alter table website_monitors add column if not exists hide_url boolean not null default false;/,
  '已有库必须能幂等地补上 hide_url 列',
);
assert.match(
  rpc,
  /case when input_include_hidden or hide_url = false then url else null end as url/,
  'REST 公开出口必须按 hide_url 把 url 置空',
);
assert.equal(
  (rpc.match(/case when input_include_hidden or hide_url = false then url else null end as url/g) || []).length >= 3,
  true,
  'cfm_public_websites 与 cfm_public_website_monitor 的所有生效版本都要裁剪',
);

const schema = readFileSync(new URL('../../../supabase/migrations/1_core_schema.sql', import.meta.url), 'utf8');
assert.match(schema, /hide_url boolean not null default false/, '新装库的建表语句要含 hide_url');

// --- 回归锁：WebSocket 广播必须分公开/管理两份，否则「隐藏」只是前端不渲染 ---
const admin = readFileSync(new URL('../routes/admin.ts', import.meta.url), 'utf8');
assert.match(admin, /function publicWebsiteMetadataDetail/, '必须存在公开载荷裁剪函数');
assert.match(
  admin,
  /item\.hide_url === true \? \{ \.\.\.item, url: null \}/,
  '公开广播载荷里 hide_url 为真的条目必须把 url 置空',
);
assert.match(
  admin,
  /\.filter\(item => !\(isRecord\(item\) && item\.hidden === true\)\)/,
  '公开广播载荷必须剔除整条隐藏的监控',
);
assert.match(admin, /audience: 'admin'/, '管理员分支必须显式指定 audience');
assert.match(admin, /audience: 'public'/, '游客分支必须显式指定 audience');

const live = readFileSync(new URL('../do/live-data.ts', import.meta.url), 'utf8');
assert.match(
  live,
  /private broadcastMetadataChanged\(detail: JsonObject = \{\}, audience: 'all' \| 'public' \| 'admin' = 'all'\)/,
  'DO 的 metadata 广播必须支持按受众投递',
);
assert.match(live, /const \{ audience, \.\.\.detail \} = parsed\.body/, 'audience 不得混进广播载荷');

console.log('website-monitor.hide-url.test.mjs: all assertions passed');
