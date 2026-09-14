import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';

const MiB = 1024 * 1024;
const settingsDefaults = { database_storage_budget_bytes: String(500 * MiB), theme_storage_quota_bytes: String(32 * MiB) };
const context = { waitUntil: () => {} };

function fixture({ diagnosticFailure = false } = {}) {
  const stored = { ...settingsDefaults };
  const measurements = [];
  const historyUsage = { live_rows: 1, estimated_live_storage_bytes: 420, allocated_bytes: 600 * MiB };
  const loader = createWorkerLoader({ db: {
    getSettingsByKeys: async (_db, keys) => Object.fromEntries(keys.filter(key => key in stored).map(key => [key, stored[key]])),
    setSettings: async (_db, values) => Object.assign(stored, values),
    insertAuditLog: async () => {}, countClientCapacityTargets: async () => ({ clients: 1, gpu_clients: 0 }),
    listPingTaskEstimateRows: async () => [], getHistoryStorageBytes: async () => ({ total: 600 * MiB }),
    getHistoryStorageUsage: async () => historyUsage,
    getBoundedStorageRowCounts: async () => null, getExpiredRowCounts: async () => null,
    getDatabaseStorageDiagnostics: async (_db, forceRefresh = false) => {
      measurements.push(forceRefresh);
      if (diagnosticFailure) throw new Error('Synthetic diagnostic failure');
      const budget = Number(stored.database_storage_budget_bytes);
      return { measurement: 'database-allocation', measured_at: '2026-09-14T00:00:00Z', cache_seconds: 600,
        database_allocated_bytes: 480 * MiB, application_allocated_bytes: 420 * MiB, other_allocated_bytes: 60 * MiB,
        tables: { website_checks: { allocated_bytes: 300 * MiB }, theme_assets: { allocated_bytes: 8 * MiB } },
        theme_payload_bytes: 10 * MiB, theme_count: 2, theme_asset_count: 4,
        budget_bytes: budget, theme_quota_bytes: Number(stored.theme_storage_quota_bytes),
        status: 480 * MiB >= budget * 0.95 ? 'critical' : 480 * MiB >= budget * 0.85 ? 'warning' : 'ok' };
    },
  } });
  const { adminRoutes } = loader.load('worker/src/routes/admin.ts');
  return { stored, loader, measurements, historyUsage,
    request: (path, body) => adminRoutes.fetch(new Request(`https://panel.example.test${path}`, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), {}, context) };
}

test('D06 general settings expose the database and accumulated theme budgets', async () => {
  const app = fixture();
  const response = await app.request('/settings?scope=general&refresh=1');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.database_storage_budget_bytes, settingsDefaults.database_storage_budget_bytes);
  assert.equal(body.theme_storage_quota_bytes, settingsDefaults.theme_storage_quota_bytes);
});

test('D06 configured budgets accept free and larger projects while rejecting invalid bounds', () => {
  const { loader } = fixture();
  const { normalizeSettingValue, buildPublicSettings } = loader.load('worker/src/settings/schema.ts');
  for (const [key, low, high, values] of [
    ['database_storage_budget_bytes', 64 * MiB, 512 * 1024 * MiB, [500 * MiB, 8 * 1024 * MiB]],
    ['theme_storage_quota_bytes', MiB, 1024 * MiB, [32 * MiB, 256 * MiB]],
  ]) {
    for (const value of [low, high, ...values]) assert.equal(normalizeSettingValue(key, String(value)).ok, true, `${key} accepts ${value}`);
    for (const value of [low - 1, high + 1, 1.5, 'not-a-number']) assert.equal(normalizeSettingValue(key, value).ok, false);
    assert.equal(key in buildPublicSettings(settingsDefaults), false, 'capacity limits remain administrator settings');
  }
});

test('D06 capacity HTTP response exposes complete allocation diagnostics and a critical warning', async () => {
  const app = fixture();
  const response = await app.request('/capacity?refresh_counts=1');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.database_storage_diagnostics?.status, 'critical');
  assert.equal(body.database_storage_diagnostics.database_allocated_bytes, 480 * MiB);
  assert.equal(body.database_storage_diagnostics.tables.website_checks.allocated_bytes, 300 * MiB);
  assert.equal(body.database_storage_diagnostics.theme_payload_bytes, 10 * MiB);
  assert.deepEqual(app.measurements, [true], 'explicit refresh must reach the measurement cache');
  assert.deepEqual(body.history_storage_usage, app.historyUsage, 'physical diagnostics do not overwrite recoverable history usage');
});

test('D06 saving a larger project budget invalidates the capacity response immediately', async () => {
  const app = fixture();
  await app.request('/capacity');
  const changed = await app.request('/settings', {
    database_storage_budget_bytes: String(8 * 1024 * MiB), theme_storage_quota_bytes: String(256 * MiB),
  });
  assert.equal(changed.status, 200, 'valid capacity settings must be saved');
  assert.equal((await changed.json()).changed, 2);
  const body = await (await app.request('/capacity')).json();
  assert.equal(body.database_storage_diagnostics?.status, 'ok');
  assert.equal(body.database_storage_diagnostics.budget_bytes, 8 * 1024 * MiB);
  assert.equal(body.database_storage_diagnostics.theme_quota_bytes, 256 * MiB);
  assert.equal(app.measurements.length, 2, 'saved budgets invalidate the previous response cache');
});

test('D06 unavailable diagnostics remain unknown while existing history diagnostics are available', async () => {
  const app = fixture({ diagnosticFailure: true });
  const response = await app.request('/capacity');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.database_storage_diagnostics, null, 'measurement failure must not imply zero database usage');
  assert.deepEqual(body.history_storage_usage, app.historyUsage);
});
