import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { normalizePublicClient, normalizePublicClients } from '../src/utils/publicClients.ts';
import {
  clearCachedPublicBootstrap,
  fetchPublicBootstrap,
  getCachedPublicBootstrap,
  patchCachedPublicBootstrapClients,
} from '../src/utils/publicBootstrap.ts';

function installLocalStorage() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  return storage;
}

test('normalizePublicClient keeps public fields and strips private fields', () => {
  const client = normalizePublicClient({
    uuid: ' node-1 ',
    name: 'Node 1',
    cpu_cores: 4,
    has_ipv4: true,
    ipv4: '203.0.113.10',
    token: 'secret-token',
    token_hash: 'sha256:secret',
    remark: 'private note',
    public_remark: 'public note',
    hidden: false,
  });

  assert.equal(client?.uuid, 'node-1');
  assert.equal(client?.name, 'Node 1');
  assert.equal(client?.cpu_cores, 4);
  assert.equal(client?.has_ipv4, true);
  assert.equal(client?.public_remark, 'public note');
  assert.equal(Object.hasOwn(client || {}, 'ipv4'), false);
  assert.equal(Object.hasOwn(client || {}, 'token'), false);
  assert.equal(Object.hasOwn(client || {}, 'token_hash'), false);
  assert.equal(Object.hasOwn(client || {}, 'remark'), false);
});

test('normalizePublicClients drops malformed and hidden entries', () => {
  assert.deepEqual(normalizePublicClients({
    data: [
      { uuid: 'node-1', name: 'Node 1' },
      { uuid: 'node-2', hidden: true },
      { name: 'missing uuid' },
      null,
    ],
  }).map((client) => client.uuid), ['node-1']);
});

test('public pages normalize client list responses before storing state', () => {
  const indexSource = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'Index.tsx'), 'utf8');
  const instanceSource = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'Instance.tsx'), 'utf8');
  const bootstrapSource = readFileSync(join(import.meta.dirname, '..', 'src', 'utils', 'publicBootstrap.ts'), 'utf8');

  assert.match(indexSource, /normalizePublicClients\(data\)/);
  assert.match(instanceSource, /const visible = normalizePublicClients\(data\)/);
  assert.match(bootstrapSource, /clients: record\.clients === undefined \? undefined : normalizePublicClients\(record\.clients\)/);
  assert.doesNotMatch(indexSource, /filter\(\(c: any\) => !c\.hidden\)/);
  assert.doesNotMatch(instanceSource, /find\(\(c: any\) => c\.uuid === uuid\)/);
});

test('public bootstrap uses browser and edge cache for fast node metadata', () => {
  const bootstrapSource = readFileSync(join(import.meta.dirname, '..', 'src', 'utils', 'publicBootstrap.ts'), 'utf8');
  const indexSource = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'Index.tsx'), 'utf8');

  assert.match(bootstrapSource, /fetchPublicBootstrap\(options: \{ cache\?: RequestCache; cacheBust\?: boolean \} = \{\}\)/);
  assert.match(bootstrapSource, /options\.cache \? \{ cache: options\.cache \} : undefined/);
  assert.doesNotMatch(bootstrapSource, /cache: 'no-store'/);
  assert.match(indexSource, /fetchPublicBootstrap\(\{ cache: 'reload', cacheBust: true \}\)/);
});

test('public page shows cached node metadata while refreshing in the background', () => {
  const bootstrapSource = readFileSync(join(import.meta.dirname, '..', 'src', 'utils', 'publicBootstrap.ts'), 'utf8');
  const indexSource = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'Index.tsx'), 'utf8');

  assert.match(bootstrapSource, /PUBLIC_BOOTSTRAP_STORAGE_KEY = 'cf_monitor_public_bootstrap'/);
  assert.match(bootstrapSource, /getLocalStorageItem\(PUBLIC_BOOTSTRAP_STORAGE_KEY\)/);
  assert.match(bootstrapSource, /setLocalStorageItem\(PUBLIC_BOOTSTRAP_STORAGE_KEY/);
  assert.match(bootstrapSource, /removeLocalStorageItem\(PUBLIC_BOOTSTRAP_STORAGE_KEY\)/);
  assert.match(indexSource, /const initialBootstrap = useMemo\(\(\) => getCachedPublicBootstrap\(\), \[\]\)/);
  assert.match(indexSource, /useState<ClientInfo\[\]>\(\(\) => initialBootstrap\?\.clients \|\| \[\]\)/);
  assert.match(indexSource, /useState\(initialBootstrap\?\.clients === undefined\)/);
});

test('public page can render live snapshot nodes before metadata finishes', () => {
  const indexSource = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'Index.tsx'), 'utf8');

  assert.match(indexSource, /function liveClientsAsPublicClients/);
  assert.match(indexSource, /function mergeLiveClientMetadata/);
  assert.match(indexSource, /region: client\.region \|\| ''/);
  assert.match(indexSource, /const displayClients = clients\.length > 0 \? mergeLiveClientMetadata\(clients, liveMap\.clients\) : liveClientsAsPublicClients\(liveMap\.clients\)/);
  assert.match(indexSource, /getNodeStatsSummary\(displayClients, liveMap\)/);
  assert.match(indexSource, /\[\.\.\.displayClients\]\.sort/);
});

test('public server cards use compact 320px boxes that fit two rows in a 730px viewport', () => {
  const srcDir = join(import.meta.dirname, '..', 'src');
  const indexSource = readFileSync(join(srcDir, 'pages', 'Index.tsx'), 'utf8');
  const css = readFileSync(join(srcDir, 'index.css'), 'utf8');

  assert.match(indexSource, /nodeCardGridTemplateColumns = 'repeat\(auto-fill, 320px\)'/);
  assert.match(css, /\.node-card-grid\s*\{[\s\S]{0,180}gap:\s*6px;[\s\S]{0,180}justify-content:\s*space-evenly;/);
  assert.match(css, /\.node-card-grid > \.node-card\s*\{[\s\S]{0,120}width:\s*320px;[\s\S]{0,80}min-height:\s*306px;/);
  assert.match(css, /\.node-card \.rt-CardInner\s*\{[\s\S]{0,80}padding:\s*7px !important;/);
  assert.match(css, /\.node-card-body\s*\{[\s\S]{0,80}gap:\s*6px !important;/);
  assert.match(css, /\.node-card-system-line\s*\{[\s\S]{0,180}min-height:\s*30px;[\s\S]{0,80}padding:\s*5px 7px;/);
  assert.match(css, /html\[data-monitor-theme='next'\] \.node-metric-tile\s*\{[\s\S]{0,120}min-height:\s*48px;[\s\S]{0,80}padding:\s*6px 7px;[\s\S]{0,80}gap:\s*3px;/);
  assert.match(css, /\.node-network-panel\s*\{[\s\S]{0,160}gap:\s*6px;[\s\S]{0,80}margin-top:\s*2px;[\s\S]{0,80}padding:\s*7px;/);
  assert.match(css, /\.node-network-value\s*\{[\s\S]{0,120}min-height:\s*26px;/);
});

test('mobile monitor server cards do not keep the desktop minimum height', () => {
  const css = readFileSync(join(import.meta.dirname, '..', 'src', 'index.css'), 'utf8');

  assert.match(
    css,
    /@media \(max-width: 640px\)[\s\S]*html\[data-monitor-theme='monitor'\] \.node-card-grid > \.node-card\s*\{[\s\S]{0,80}min-height:\s*0;/,
  );
  assert.match(
    css,
    /@media \(max-width: 640px\)[\s\S]*html\[data-monitor-theme='monitor'\] \.node-card-link\s*\{[\s\S]{0,80}height:\s*auto;/,
  );
  assert.match(
    css,
    /@media \(max-width: 640px\)[\s\S]*html\[data-monitor-theme='monitor'\] \.node-card-body\s*\{[\s\S]{0,80}min-height:\s*0;/,
  );
});

test('client and public setting changes notify open public pages across tabs', () => {
  const srcDir = join(import.meta.dirname, '..', 'src');
  const indexSource = readFileSync(join(srcDir, 'pages', 'Index.tsx'), 'utf8');
  const layoutSource = readFileSync(join(srcDir, 'pages', 'Layout.tsx'), 'utf8');
  const dashboardSource = readFileSync(join(srcDir, 'pages', 'admin', 'Dashboard.tsx'), 'utf8');
  const settingsSiteSource = readFileSync(join(srcDir, 'pages', 'admin', 'SettingsSite.tsx'), 'utf8');
  const eventsSource = readFileSync(join(srcDir, 'utils', 'publicDataEvents.ts'), 'utf8');

  assert.match(eventsSource, /PUBLIC_DATA_UPDATED_EVENT/);
  assert.match(eventsSource, /import \{ clearCachedPublicBootstrap \} from '\.\/publicBootstrap'/);
  assert.match(eventsSource, /clearCachedPublicBootstrap\(\)/);
  assert.match(eventsSource, /localStorage\.setItem\(PUBLIC_DATA_UPDATED_EVENT/);
  assert.match(eventsSource, /new BroadcastChannel\(CHANNEL_NAME\)/);
  assert.match(eventsSource, /window\.addEventListener\('storage', onStorage\)/);
  assert.match(eventsSource, /force\?: boolean/);
  assert.match(eventsSource, /detail\?\.force/);
  assert.match(indexSource, /subscribePublicDataUpdated\(refreshPublicClients\)/);
  assert.match(indexSource, /notifyPublicDataReady\(\)/);
  assert.match(layoutSource, /subscribePublicDataUpdated\(applyPublicSettings\)/);
  assert.match(dashboardSource, /notifyPublicDataUpdated\(\)/);
  assert.match(settingsSiteSource, /notifyPublicDataUpdated\(\)/);
});

test('public data update refreshes bypass stale bootstrap caches', () => {
  const srcDir = join(import.meta.dirname, '..', 'src');
  const bootstrapSource = readFileSync(join(srcDir, 'utils', 'publicBootstrap.ts'), 'utf8');
  const indexSource = readFileSync(join(srcDir, 'pages', 'Index.tsx'), 'utf8');
  const liveDataSource = readFileSync(join(srcDir, 'contexts', 'LiveDataContext.tsx'), 'utf8');

  assert.match(bootstrapSource, /cacheBust\?: boolean/);
  assert.match(bootstrapSource, /url\.searchParams\.set\('_fresh'/);
  assert.match(indexSource, /fetchPublicBootstrap\(\{ cache: 'reload', cacheBust: true \}\)/);
  assert.match(indexSource, /if \(detail\?\.clients\) \{[\s\S]*notifyPublicDataReady\(\);[\s\S]*return;/);
  assert.match(liveDataSource, /fetchPublicBootstrap\(fresh \? \{ cache: 'reload', cacheBust: true \} : undefined\)/);
});

test('admin add shows the created node before the slow list refresh returns', () => {
  const dashboardSource = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'admin', 'Dashboard.tsx'), 'utf8');

  assert.match(dashboardSource, /function optimisticAdminClient\(created: CommandClient\): AdminClient/);
  assert.match(dashboardSource, /const \{ uuid, name, token, \.\.\.rest \} = created/);
  assert.match(dashboardSource, /\.\.\.rest/);
  assert.match(dashboardSource, /const optimistic = optimisticAdminClient\(created\)/);
  assert.match(dashboardSource, /setClients\(prev => prev\.some\(client => client\.uuid === created\.uuid\)[\s\S]*\[\.\.\.prev, optimistic\]/);
  assert.match(dashboardSource, /void loadClients\(true\)/);
});

test('admin node add and edit use returned client rows for instant local updates', () => {
  const dashboardSource = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'admin', 'Dashboard.tsx'), 'utf8');

  assert.match(dashboardSource, /const apiClient = result\.client && typeof result\.client === 'object'/);
  assert.match(dashboardSource, /const saved = result\.client && typeof result\.client === 'object'/);
  assert.match(dashboardSource, /const updated = saved \|\|/);
  assert.match(dashboardSource, /upsert: \[updated\]/);
});

test('detailed public client updates patch stale bootstrap cache and responses', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    clearCachedPublicBootstrap();
  });

  installLocalStorage();
  clearCachedPublicBootstrap();
  localStorage.setItem('cf_monitor_public_bootstrap', JSON.stringify({
    saved_at: Date.now(),
    payload: {
      clients: [
        { uuid: 'deleted-node', name: 'Deleted' },
        { uuid: 'kept-node', name: 'Kept' },
      ],
      nodes: [
        { uuid: 'deleted-node', name: 'Deleted' },
        { uuid: 'kept-node', name: 'Kept' },
      ],
    },
  }));

  assert.deepEqual(getCachedPublicBootstrap()?.clients?.map(client => client.uuid), ['deleted-node', 'kept-node']);

  patchCachedPublicBootstrapClients({ clients: { remove: ['deleted-node'] } });
  assert.deepEqual(getCachedPublicBootstrap()?.clients?.map(client => client.uuid), ['kept-node']);

  globalThis.fetch = async () => new Response(JSON.stringify({
    clients: [
      { uuid: 'deleted-node', name: 'Stale deleted' },
      { uuid: 'kept-node', name: 'Kept' },
    ],
    nodes: [
      { uuid: 'deleted-node', name: 'Stale deleted' },
      { uuid: 'kept-node', name: 'Kept' },
    ],
  }));

  const refreshed = await fetchPublicBootstrap({ cacheBust: true });
  assert.deepEqual(refreshed.clients?.map(client => client.uuid), ['kept-node']);
  assert.deepEqual(refreshed.nodes?.map(client => client.uuid), ['kept-node']);
});

test('optimistic client patches do not erase fresh server region metadata', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    clearCachedPublicBootstrap();
  });

  installLocalStorage();
  clearCachedPublicBootstrap();
  patchCachedPublicBootstrapClients({
    clients: {
      upsert: [{ uuid: 'node-region', name: 'Node Region', region: '' }],
    },
  });

  globalThis.fetch = async () => new Response(JSON.stringify({
    clients: [
      { uuid: 'node-region', name: 'Node Region', region: 'Buffalo, New York, US' },
    ],
    nodes: [
      { uuid: 'node-region', name: 'Node Region', region: 'Buffalo, New York, US' },
    ],
  }));

  const refreshed = await fetchPublicBootstrap({ cacheBust: true });
  assert.equal(refreshed.clients?.[0]?.region, 'Buffalo, New York, US');
  assert.equal(refreshed.nodes?.[0]?.region, 'Buffalo, New York, US');
});

test('optimistic client patches do not erase fresh server billing metadata', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    clearCachedPublicBootstrap();
  });

  installLocalStorage();
  clearCachedPublicBootstrap();
  patchCachedPublicBootstrapClients({
    clients: {
      upsert: [{
        uuid: 'node-billing',
        name: 'Node Billing',
        price: 0,
        billing_cycle: 0,
        currency: '',
        expired_at: '',
      }],
    },
  });

  globalThis.fetch = async () => new Response(JSON.stringify({
    clients: [
      {
        uuid: 'node-billing',
        name: 'Node Billing',
        price: 9999,
        billing_cycle: -1,
        currency: '$',
        expired_at: '2077-07-07T00:00:00+00:00',
      },
    ],
    nodes: [
      {
        uuid: 'node-billing',
        name: 'Node Billing',
        price: 9999,
        billing_cycle: -1,
        currency: '$',
        expired_at: '2077-07-07T00:00:00+00:00',
      },
    ],
  }));

  const refreshed = await fetchPublicBootstrap({ cacheBust: true });
  assert.equal(refreshed.clients?.[0]?.price, 9999);
  assert.equal(refreshed.clients?.[0]?.billing_cycle, -1);
  assert.equal(refreshed.clients?.[0]?.currency, '$');
  assert.equal(refreshed.clients?.[0]?.expired_at, '2077-07-07T00:00:00+00:00');
});
