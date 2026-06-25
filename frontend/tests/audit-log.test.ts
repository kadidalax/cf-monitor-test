import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatAuditLogDetailPreview,
  getAuditLogDetailSearchText,
  getAuditLogDetailText,
  getAuditLogRawDetailText,
} from '../src/utils/audit-log.ts';

test('audit log detail helpers prefer structured summaries', () => {
  const detail = JSON.stringify({
    event: '编辑 Ping 任务 3',
    summary: '编辑 Ping 任务 3: public check; type=http; target=https://example.com; interval=60s; scope=all_clients',
    task: {
      name: 'public check',
      type: 'http',
      target: 'https://example.com',
      interval_sec: 60,
      scope: 'all_clients',
    },
  });

  assert.equal(
    getAuditLogDetailText(detail),
    '编辑 Ping 任务 3: public check; type=http; target=https://example.com; interval=60s; scope=all_clients',
  );
  assert.equal(getAuditLogRawDetailText(detail), detail);
  assert.match(getAuditLogDetailSearchText(detail), /"event":"编辑 Ping 任务 3"/);
});

test('audit log detail helpers preserve legacy strings and empty fallbacks', () => {
  assert.equal(getAuditLogDetailText('用户登录'), '用户登录');
  assert.equal(getAuditLogRawDetailText('用户登录'), '用户登录');
  assert.equal(getAuditLogDetailText(''), '-');
  assert.equal(getAuditLogRawDetailText(''), '-');
  assert.equal(getAuditLogDetailText(null), '-');
  assert.equal(getAuditLogRawDetailText(null), '-');
  assert.equal(formatAuditLogDetailPreview('abcdef', 3), 'abc...');
});
