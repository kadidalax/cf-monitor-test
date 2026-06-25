import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const pingTasks = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'admin', 'PingTasks.tsx'), 'utf8');

test('admin ping task writes update local state from returned task rows', () => {
  assert.match(pingTasks, /onSaved\(result\.task\)/);
  assert.match(pingTasks, /setTasks\(\(current\) => \{/);
  assert.match(pingTasks, /current\.map\(\(item\) => item\.id === task\.id \? task : item\)/);
  assert.match(pingTasks, /\[\.\.\.current, task\]\.sort/);
  assert.match(pingTasks, /setTasks\(\(current\) => current\.filter\(\(task\) => task\.id !== deletedId\)\)/);
});

test('admin ping page loads tasks without waiting for the client list', () => {
  assert.match(pingTasks, /const tasksData = await apiFetch\('\/admin\/ping'\)/);
  assert.match(pingTasks, /if \(Array\.isArray\(tasksData\)\) setTasks\(tasksData\)/);
  assert.match(pingTasks, /const ensureClients = useCallback\(async \(\) => \{/);
  assert.match(pingTasks, /if \(viewMode === 'server'\) void ensureClients\(\)/);
  assert.match(pingTasks, /setDialogOpen\(true\);\s*void ensureClients\(\)/);
  assert.doesNotMatch(pingTasks, /setLoading\(false\);\s*const clientsData = await apiFetch\('\/admin\/clients'\)/);
  assert.doesNotMatch(pingTasks, /Promise\.all\(\[\s*apiFetch\('\/admin\/ping'\),\s*apiFetch\('\/admin\/clients'\),\s*\]\)/);
});
