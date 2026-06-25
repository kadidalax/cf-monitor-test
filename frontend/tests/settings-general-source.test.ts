import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'admin', 'SettingsGeneral.tsx'), 'utf8');
const css = readFileSync(join(import.meta.dirname, '..', 'src', 'index.css'), 'utf8');

test('general settings page uses 120 second collection defaults', () => {
  assert.match(source, /const DEFAULT_RECORD_PERSIST_SEC = 120;/);
  assert.match(source, /const DEFAULT_PING_RECORD_PERSIST_SEC = 120;/);
  assert.match(source, /const DEFAULT_IDLE_UPLOAD_SEC = 120;/);
  assert.match(source, /record_persist_interval_sec: settings\.record_persist_interval_sec === '60' \? '120'/);
  assert.match(source, /ping_record_persist_interval_sec: settings\.ping_record_persist_interval_sec === '300' \? '120'/);
  assert.match(source, /live_poll_idle_interval_sec: settings\.live_poll_idle_interval_sec === '600' \? '120'/);
});

test('general settings estimate focuses on Worker usage and storage, not database read/write quotas', () => {
  assert.doesNotMatch(source, /POSTGRES_QUERY_ROWS_REFERENCE_MULTIPLIER/);
  assert.doesNotMatch(source, /POSTGRES_WRITE_RELATED_QUERY_ROWS_PER_WRITE_ESTIMATE/);
  assert.doesNotMatch(source, /mixedReadPercent|activeWritePercent|idleWritePercent/);
  assert.doesNotMatch(source, /写入关联查询|预计读行|预计写行|Postgres 读|Postgres 写/);
  assert.match(source, /Worker Free/);
  assert.match(source, /历史存储/);
});

test('general settings inputs show units in labels', () => {
  for (const label of [
    '数据保留时间（小时）',
    '每日观看时间（分钟/天）',
    '采集间隔（秒）',
    '历史写入间隔（秒）',
    'Ping 采集与写入间隔（秒）',
    '历史高水位行数（行）',
    '无人看时打包上传间隔（秒）',
    '连接保活时长（秒）',
  ]) {
    assert.match(source, new RegExp(label.replace(/[()]/g, '\\$&')));
  }
});

test('general settings estimate uses backend capacity fields before local fallback', () => {
  assert.match(source, /Number\(capacity\?\.total_estimated_business_rows_per_day/);
  assert.match(source, /Number\(capacity\?\.estimated_worker_requests_per_day/);
  assert.match(source, /Number\(capacity\?\.estimated_storage_bytes/);
});

test('mobile general settings metrics use fixed compact columns from short to long labels', () => {
  assert.match(source, /quota-estimate-metric-column quota-estimate-metric-column-short[\s\S]*label="节点数"[\s\S]*label="Ping 间隔"/);
  assert.match(source, /quota-estimate-metric-column quota-estimate-metric-column-medium[\s\S]*label="每日观看时间"[\s\S]*label="过期待清理"/);
  assert.match(source, /quota-estimate-metric-column quota-estimate-metric-column-long[\s\S]*label="Worker 请求\/天"[\s\S]*label="无人打包间隔"/);
  assert.match(css, /\.quota-estimate-metric-grid\s*\{\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.quota-estimate-metric-column\s*\{[\s\S]*gap:\s*4px/);
});

test('general settings explains maintenance actions without password prompts', () => {
  assert.doesNotMatch(source, /withCurrentPassword/);
  assert.match(source, /维护清理说明/);
  assert.match(source, /刷新实际行数说明/);
  assert.match(source, /维护清理会按当前保留时间删除过期历史记录和过期审计日志/);
  assert.match(source, /刷新实际行数会临时查询各历史表当前行数/);
});
