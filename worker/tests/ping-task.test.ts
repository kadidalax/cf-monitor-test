import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { validatePingTaskInput } from '../src/utils/ping-task.ts';

const adminRoutesSource = readFileSync(join(import.meta.dirname, '..', 'src', 'routes', 'admin.ts'), 'utf8');

const baseTask = {
  name: 'public check',
  type: 'http',
  target: 'https://example.com/health',
  interval_sec: 300,
  all_clients: true,
};

test('accepts a public HTTP ping task', () => {
  const result = validatePingTaskInput(baseTask);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.task.target, baseTask.target);
    assert.equal(result.task.interval_sec, 300);
  }
});

test('rejects localhost, private IP, and metadata targets', () => {
  for (const target of [
    'http://localhost/status',
    'https://10.0.0.5/health',
    '192.168.1.20',
    'metadata.google.internal',
    '[::1]',
  ]) {
    const result = validatePingTaskInput({ ...baseTask, type: target.startsWith('http') ? 'http' : 'icmp', target });
    assert.equal(result.ok, false, target);
  }
});

test('rejects TCP targets outside the public host:port boundary', () => {
  for (const target of ['127.0.0.1:80', '172.16.0.10:443', 'example.com:70000', 'https://example.com:443']) {
    const result = validatePingTaskInput({ ...baseTask, type: 'tcp', target });
    assert.equal(result.ok, false, target);
  }
});

test('rejects HTTP credentials in target URLs', () => {
  const result = validatePingTaskInput({ ...baseTask, target: 'https://user:pass@example.com/health' });
  assert.equal(result.ok, false);
});

test('validates targeted client IDs against the allowed set', () => {
  const result = validatePingTaskInput(
    { ...baseTask, all_clients: false, clients: ['client-a', 'client-b'] },
    new Set(['client-a']),
  );
  assert.equal(result.ok, false);
});

test('admin ping task audit includes target, type, interval, and scope details', () => {
  assert.match(adminRoutesSource, /function pingTaskAuditDetail/);
  assert.match(adminRoutesSource, /JSON\.stringify\(\{/);
  assert.match(adminRoutesSource, /summary:/);
  assert.match(adminRoutesSource, /task: current/);
  assert.match(adminRoutesSource, /previous: pingTaskAuditSnapshot\(previous\)/);
  assert.match(adminRoutesSource, /name: task\.name/);
  assert.match(adminRoutesSource, /type: task\.type/);
  assert.match(adminRoutesSource, /target: task\.target/);
  assert.match(adminRoutesSource, /interval_sec: task\.interval_sec/);
  assert.match(adminRoutesSource, /scope/);

  for (const action of ['ping_add', 'ping_edit', 'ping_delete']) {
    const actionIndex = adminRoutesSource.indexOf(`'${action}'`);
    assert.notEqual(actionIndex, -1, action);
    const window = adminRoutesSource.slice(Math.max(0, actionIndex - 300), actionIndex + 500);
    assert.match(window, /pingTaskAuditDetail\(/, action);
  }

  const deleteRoute = adminRoutesSource.match(new RegExp("adminRoutes\\.post\\('/ping/delete'[\\s\\S]*?^\\}\\);", 'm'))?.[0] ?? '';
  assert.match(deleteRoute, /const id = Number\(body\.id\)/);
  assert.match(deleteRoute, /const deleted = await timed\(metrics, 'db_delete_ping'/);
  assert.match(deleteRoute, /Ping 任务不存在/);
  assert.match(deleteRoute, /db\.deletePingTask\(database, id\)/);
  assert.match(deleteRoute, /pingTaskAuditDetail\(`删除 Ping 任务 \$\{id\}`, deleted\)/);
});
