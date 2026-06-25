import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAuditLogEntry, normalizeAuditLogsPage } from '../src/utils/audit-log-response.ts';

test('audit log response normalization keeps valid rows and drops malformed rows', () => {
  const page = normalizeAuditLogsPage({
    data: [
      {
        id: '42',
        time: '2026-06-17T00:00:00.000Z',
        user: 'admin',
        action: 'agent_token_source_ip_change',
        detail: { previous_ip_fp: 'sha256:a', new_ip_fp: 'sha256:b' },
        level: 'warning',
      },
      { id: 'not-a-number', time: '2026-06-17T00:00:01.000Z' },
      { id: 43, time: '' },
      null,
    ],
    total: '4',
    has_more: true,
  });

  assert.equal(page.total, 4);
  assert.equal(page.hasMore, true);
  assert.equal(page.logs.length, 1);
  assert.deepEqual(page.logs[0], {
    id: 42,
    time: '2026-06-17T00:00:00.000Z',
    user: 'admin',
    action: 'agent_token_source_ip_change',
    detail: { previous_ip_fp: 'sha256:a', new_ip_fp: 'sha256:b' },
    level: 'warning',
  });
});

test('audit log response normalization falls back safely for invalid payloads', () => {
  assert.deepEqual(normalizeAuditLogsPage(null), { logs: [], total: 0, hasMore: false });
  assert.deepEqual(normalizeAuditLogsPage({ data: [], total: -1 }), { logs: [], total: 0, hasMore: false });
  assert.equal(normalizeAuditLogEntry({ id: 1, time: '2026-06-17T00:00:00.000Z', user: 123 })?.user, null);
});
