import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  SupabaseApiConfigurationError,
  SupabaseApiError,
  callSupabaseRpc,
  ensureSupabaseInitialAdmin,
  isSupabaseApiConfigured,
} from '../src/db/supabase-api/client.ts';

const providerSource = readFileSync(join(import.meta.dirname, '..', 'src', 'db', 'provider.ts'), 'utf8');
const queriesSource = readFileSync(join(import.meta.dirname, '..', 'src', 'db', 'queries.ts'), 'utf8');
const adminRoutesSource = readFileSync(join(import.meta.dirname, '..', 'src', 'routes', 'admin.ts'), 'utf8');

const env = {
  SUPABASE_URL: 'https://project-ref.supabase.co/',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
};

test('Supabase API config requires both URL and service role key', () => {
  assert.equal(isSupabaseApiConfigured(env), true);
  assert.equal(isSupabaseApiConfigured({ SUPABASE_URL: env.SUPABASE_URL }), false);
  assert.equal(isSupabaseApiConfigured({ SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY }), false);
});

test('Supabase API env is the only database provider', () => {
  assert.match(providerSource, /export type DatabaseProvider = 'supabase-api'/);
  assert.match(providerSource, /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required/);
  assert.match(providerSource, /provider: 'supabase-api'/);
  assert.doesNotMatch(providerSource, /DATABASE_URL|POSTGRES_|postgresReady|schema-bootstrap/);
});

test('callSupabaseRpc posts to the PostgREST rpc endpoint with service role headers', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const result = await callSupabaseRpc<{ ok: boolean }>(
    env,
    'cfm_public_settings',
    { hello: 'world' },
    async (url, init) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].url, 'https://project-ref.supabase.co/rest/v1/rpc/cfm_public_settings');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal((calls[0].init.headers as Record<string, string>).apikey, 'service-role-secret');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer service-role-secret');
  assert.equal(calls[0].init.body, JSON.stringify({ hello: 'world' }));
});

test('callSupabaseRpc redacts service role key from thrown errors', async () => {
  await assert.rejects(
    () => callSupabaseRpc(
      env,
      'cfm_public_settings',
      {},
      async () => new Response(`bad ${env.SUPABASE_SERVICE_ROLE_KEY}`, { status: 500 }),
    ),
    (error) => {
      assert.ok(error instanceof SupabaseApiError);
      assert.equal(String(error).includes(env.SUPABASE_SERVICE_ROLE_KEY), false);
      assert.match(String(error), /Supabase RPC cfm_public_settings failed: 500/);
      return true;
    },
  );
});

test('callSupabaseRpc throws stable configuration errors', async () => {
  await assert.rejects(
    () => callSupabaseRpc({}, 'cfm_public_settings'),
    SupabaseApiConfigurationError,
  );
});

test('ensureSupabaseInitialAdmin sends the required user uuid to the RPC', async () => {
  const originalFetch = globalThis.fetch;
  let body: unknown;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body || '{}'));
    return new Response(null, { status: 204 });
  };

  try {
    await ensureSupabaseInitialAdmin(env, 'user-uuid', 'admin', 'hash');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(body, {
    input_uuid: 'user-uuid',
    input_username: 'admin',
    input_passwd: 'hash',
  });
});

test('public query facade uses Supabase RPC in Data API mode', () => {
  assert.match(queriesSource, /import \* as sba from '\.\/supabase-api\/client'/);
  assert.match(queriesSource, /sba\.getSupabasePublicSettings/);
  assert.match(queriesSource, /sba\.getSupabasePublicClients/);
  assert.match(queriesSource, /sba\.getSupabasePublicPingTasks/);
  assert.match(queriesSource, /sba\.getSupabasePublicWebsites/);
  assert.doesNotMatch(queriesSource, /database\.sql|pg\./);
});

test('admin client listing uses Supabase RPC in Data API mode', () => {
  assert.match(queriesSource, /sba\.getSupabaseAdminClients/);
});

test('admin settings reads and writes use Supabase RPC in Data API mode', () => {
  assert.match(queriesSource, /sba\.getSupabasePublicSettings/);
  assert.match(queriesSource, /sba\.setSupabaseSettings/);
});

test('agent hot path uses Supabase RPC in Data API mode', () => {
  for (const helper of [
    'getSupabaseClientByToken',
    'getSupabaseClientIdentityByToken',
    'markSupabaseClientTokenUsed',
    'rotateSupabaseClientToken',
    'updateSupabaseClient',
    'insertSupabaseMonitorRecord',
    'insertSupabaseGpuRecords',
    'insertSupabasePingSnapshot',
    'getSupabaseHistoryStorageRowCounts',
  ]) {
    assert.match(queriesSource, new RegExp(`sba\\.${helper}`));
  }
});

test('admin client writes use Supabase RPC in Data API mode', () => {
  for (const helper of [
    'getSupabaseClient',
    'getSupabaseClientTokenMeta',
    'getSupabaseClientsByIds',
    'getSupabaseClientIds',
    'supabaseClientTokenExists',
    'getSupabaseClientCreateConflict',
    'createSupabaseClient',
    'updateSupabaseClientAndReturn',
    'setSupabaseClientInstallToken',
    'deleteSupabaseClients',
    'updateSupabaseClientsHidden',
    'reorderSupabaseClients',
  ]) {
    assert.match(queriesSource, new RegExp(`sba\\.${helper}`));
  }
});

test('admin capacity estimate uses Supabase RPC in Data API mode', () => {
  for (const helper of [
    'getSupabaseClientCapacityCounts',
    'getSupabasePingTaskEstimateRows',
    'getSupabaseStorageRowCounts',
    'getSupabaseBoundedStorageRowCounts',
    'getSupabaseExpiredRowCounts',
  ]) {
    assert.match(queriesSource, new RegExp(`sba\\.${helper}`));
  }
});

test('admin audit log listing uses Supabase RPC in Data API mode', () => {
  assert.match(queriesSource, /sba\.listSupabaseAuditLogsPaged/);
});

test('account management uses Supabase RPC in Data API mode', () => {
  for (const helper of [
    'countSupabaseUsers',
    'getSupabaseUserByUuid',
    'updateSupabaseUserUsername',
    'updateSupabaseUserPassword',
    'updateSupabaseUserPasswordAndRotateSession',
  ]) {
    assert.match(queriesSource, new RegExp(`sba\\.${helper}`));
  }
});

test('theme management uses Supabase RPC in Data API mode', () => {
  for (const helper of [
    'listSupabaseThemes',
    'getSupabaseTheme',
    'upsertSupabaseTheme',
    'updateSupabaseThemeSettings',
    'deleteSupabaseTheme',
    'getSupabaseThemeAsset',
  ]) {
    assert.match(queriesSource, new RegExp(`sba\\.${helper}`));
  }
});

test('admin ping task CRUD uses Supabase RPC in Data API mode', () => {
  for (const helper of [
    'getSupabasePingTask',
    'createSupabasePingTask',
    'updateSupabasePingTaskAndReturn',
    'reorderSupabasePingTasks',
    'deleteSupabasePingTask',
  ]) {
    assert.match(queriesSource, new RegExp(`sba\\.${helper}`));
  }
});

test('admin website monitor CRUD uses Supabase RPC in Data API mode', () => {
  for (const helper of [
    'getSupabaseWebsiteMonitor',
    'getSupabasePublicWebsiteMonitorById',
    'createSupabaseWebsiteMonitor',
    'updateSupabaseWebsiteMonitorAndReturn',
    'deleteSupabaseWebsiteMonitor',
    'reorderSupabaseWebsiteMonitors',
    'setSupabaseWebsiteMonitorVisibility',
    'setSupabaseWebsiteMonitorEnabled',
    'listSupabaseWebsiteChecks',
  ]) {
    assert.match(queriesSource, new RegExp(`sba\\.${helper}`));
  }
});

test('public history reads use Supabase RPC in Data API mode', () => {
  for (const helper of [
    'getSupabaseRecentRecords',
    'getSupabaseLatestRecords',
    'getSupabaseLatestRecordTimes',
    'getSupabaseLatestRecordTimesForClients',
    'getSupabaseRecordsByTimeRange',
    'getSupabaseRecordsByTimeRangeLimited',
    'getSupabaseRecordsByTimeRangePaged',
    'getSupabaseRecordsByTimeRangeCursor',
    'getSupabaseGpuRecords',
    'getSupabaseGpuRecordsPaged',
    'getSupabaseGpuRecordsCursor',
    'getSupabasePingRecords',
    'getSupabasePingRecordsPaged',
    'getSupabasePingRecordsCursor',
    'getSupabasePingRecordsForTasks',
  ]) {
    assert.match(queriesSource, new RegExp(`sba\\.${helper}`));
  }
});

test('scheduled client reads use Supabase RPC in Data API mode', () => {
  for (const helper of [
    'supabaseClientExists',
    'getSupabaseClientVisibility',
    'listSupabaseScheduledClientRows',
    'getSupabaseScheduledClientRowsByIds',
  ]) {
    assert.match(queriesSource, new RegExp(`sba\\.${helper}`));
  }
});

test('admin health skips Postgres-only probes in Supabase API mode', () => {
  assert.match(adminRoutesSource, /Supabase HTTP API\/RPC configured/);
  assert.match(adminRoutesSource, /database_connection_probe/);
  assert.match(adminRoutesSource, /database_role_probe/);
  assert.match(adminRoutesSource, /Direct database role probe is not used in Supabase HTTP API mode/);
  assert.doesNotMatch(adminRoutesSource, /postgres_connection_probe|postgres_role_probe/);
});

test('scheduled cleanup uses Supabase RPC in Data API mode', () => {
  for (const helper of [
    'deleteSupabaseOldRecords',
    'deleteSupabaseOldWebsiteChecks',
    'deleteSupabaseOldPingRecords',
    'deleteSupabaseOldAuditLogs',
  ]) {
    assert.match(queriesSource, new RegExp(`sba\\.${helper}`));
  }
});

test('maintenance cleanup and client reference pruning use Supabase RPC in Data API mode', () => {
  for (const helper of [
    'pruneSupabaseClientReferences',
    'pruneSupabaseClientReferencesForClients',
    'cleanupSupabaseOrphanClientData',
  ]) {
    assert.match(queriesSource, new RegExp(`sba\\.${helper}`));
  }
});

test('offline and expiry notification paths use Supabase RPC in Data API mode', () => {
  for (const helper of [
    'getSupabaseOfflineNotification',
    'listSupabaseOfflineNotifications',
    'setSupabaseOfflineNotifications',
    'markSupabaseOfflineNotificationSent',
    'getSupabaseExpiryNotification',
    'listSupabaseExpiryNotifications',
    'setSupabaseExpiryNotifications',
    'markSupabaseExpiryNotificationSent',
  ]) {
    assert.match(queriesSource, new RegExp(`sba\\.${helper}`));
  }
});

test('load notification cron paths use Supabase RPC in Data API mode', () => {
  for (const helper of [
    'listSupabaseLoadNotifications',
    'getSupabaseLoadMetricWindowStatsForClients',
    'getSupabaseLoadNotification',
    'createSupabaseLoadNotification',
    'updateSupabaseLoadNotification',
    'deleteSupabaseLoadNotification',
  ]) {
    assert.match(queriesSource, new RegExp(`sba\\.${helper}`));
  }
});

test('website monitor cron paths use Supabase RPC in Data API mode', () => {
  for (const helper of [
    'listSupabaseWebsiteMonitors',
    'listSupabaseDueWebsiteMonitors',
    'recordSupabaseWebsiteCheck',
    'markSupabaseWebsiteMonitorNotified',
  ]) {
    assert.match(queriesSource, new RegExp(`sba\\.${helper}`));
  }
});
