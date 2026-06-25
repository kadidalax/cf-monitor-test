import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { getFallbackViewerExpiry, getLivePollDelay, shouldReconnectLiveWebSocket } from '../src/contexts/livePolling.ts';

const liveDataSource = readFileSync(join(import.meta.dirname, '..', 'src', 'contexts', 'LiveDataContext.tsx'), 'utf8');
const publicBootstrapSource = readFileSync(join(import.meta.dirname, '..', 'src', 'utils', 'publicBootstrap.ts'), 'utf8');
const appSource = readFileSync(join(import.meta.dirname, '..', 'src', 'App.tsx'), 'utf8');

test('viewer WebSocket falls back to HTTP when the initial snapshot does not arrive', () => {
  assert.match(liveDataSource, /const LIVE_WS_INITIAL_SNAPSHOT_TIMEOUT_MS = 4_000/);
  assert.match(liveDataSource, /const initialSnapshotTimeoutRef = useRef/);
  assert.match(liveDataSource, /initialSnapshotTimeoutRef\.current = setTimeout\(\(\) => \{[\s\S]*void fetchLiveData\(\);[\s\S]*LIVE_WS_INITIAL_SNAPSHOT_TIMEOUT_MS/);
  assert.match(liveDataSource, /clearInitialSnapshotTimeout\(\);[\s\S]*const normalized = normalizeLiveDataResponse\(snapshot\);[\s\S]*setLiveData\(normalized\);[\s\S]*setLoading\(false\)/);
  assert.match(liveDataSource, /ws\.addEventListener\('error'[\s\S]*void fetchLiveData\(\);/);
});

test('viewer refresh loop can slow down when the tab is hidden', () => {
  assert.match(liveDataSource, /lastScheduledDelay = getLivePollDelay\(\{/);
  assert.match(liveDataSource, /hidden: document\.hidden/);
});

test('viewer WebSocket keeps reconnecting while the tab is hidden', () => {
  assert.equal(shouldReconnectLiveWebSocket({ expired: false, hidden: true }), true);
  assert.equal(shouldReconnectLiveWebSocket({ expired: true, hidden: true }), false);
});

test('hidden or long-active viewer tabs use idle HTTP fallback polling', () => {
  const config = { activeIntervalMs: 3000, idleIntervalMs: 120000, activeMaxDurationMs: 600000 };

  assert.equal(getLivePollDelay({ hidden: false, activeSince: 0, now: 300000, config }), 3000);
  assert.equal(getLivePollDelay({ hidden: true, activeSince: null, now: 0, config }), 120000);
  assert.equal(getLivePollDelay({ hidden: true, activeSince: 0, now: 700000, config }), 120000);
  assert.equal(getLivePollDelay({ hidden: false, activeSince: 0, now: 700000, config }), 120000);
  assert.equal(getFallbackViewerExpiry({ currentExpiresAt: null, now: 0, config }), null);
});

test('viewer skips active HTTP repair polling while WebSocket is open', () => {
  assert.match(liveDataSource, /if \(wsOpenRef\.current\) \{[\s\S]*lastScheduledDelay = config\.idleIntervalMs;[\s\S]*return;[\s\S]*\}/);
  assert.match(liveDataSource, /if \(wsOpenRef\.current\) \{[\s\S]*scheduleNextPoll\(\);[\s\S]*return;[\s\S]*\}/);
  assert.match(liveDataSource, /if \(cancelled \|\| wsExpiredRef\.current \|\| wsOpenRef\.current\) return;/);
});

test('empty reconnect snapshots do not clear existing live nodes before HTTP repair', () => {
  assert.match(liveDataSource, /function isEmptyLiveSnapshot/);
  assert.match(liveDataSource, /if \(isEmptyLiveSnapshot\(normalized\)\) \{[\s\S]*void fetchLiveData\(\);[\s\S]*return;/);
  assert.match(liveDataSource, /setLiveData\(current => current && !isEmptyLiveSnapshot\(current\) && isEmptyLiveSnapshot\(data\) \? current : data\)/);
});

test('viewer token expiry reconnects instead of freezing live updates', () => {
  assert.match(liveDataSource, /const reconnectLiveWebSocket = \(\) => \{[\s\S]*void connect\(\);[\s\S]*\};/);
  assert.match(liveDataSource, /if \(isViewerExpiredMessage\(message\)\) \{[\s\S]*reconnectLiveWebSocket\(\);[\s\S]*return;/);
});

test('viewer WebSocket metadata changes refresh public/admin lists', () => {
  assert.match(liveDataSource, /notifyPublicDataUpdated/);
  assert.match(liveDataSource, /notifyWebsiteMonitorsUpdated/);
  assert.match(liveDataSource, /interface LiveDataMetadataChangedMessage/);
  assert.match(liveDataSource, /websites\?: true \| WebsiteMonitorsUpdateDetail/);
  assert.match(liveDataSource, /function isMetadataChangedMessage/);
  assert.match(liveDataSource, /if \(isMetadataChangedMessage\(message\)\) \{[\s\S]*if \(message\.websites\) notifyWebsiteMonitorsUpdated\(message\.websites\);[\s\S]*notifyPublicDataUpdated\(message\.clients \? \{ clients: message\.clients \} : undefined\);[\s\S]*return;/);
  assert.match(liveDataSource, /if \(detail\?\.clients\) return;/);
});

test('HTTP live repair detects missed metadata changes by version', () => {
  assert.match(liveDataSource, /const metadataVersionRef = useRef<string \| null>\(null\)/);
  assert.match(liveDataSource, /function rememberInitialLiveMetadataVersion/);
  assert.match(liveDataSource, /rememberInitialLiveMetadataVersion\(bootstrap\?\.metadata_version \|\| live\?\.metadata_version\)/);
  assert.match(liveDataSource, /rememberInitialLiveMetadataVersion\(payload\?\.metadata_version \|\| live\?\.metadata_version\)/);
  assert.match(liveDataSource, /function applyLiveMetadataVersion/);
  assert.match(liveDataSource, /if \(metadataVersionRef\.current !== version\) \{[\s\S]*notifyPublicDataUpdated\(\{ force: true \}\);[\s\S]*\}/);
  assert.match(liveDataSource, /applyLiveMetadataVersion\(data\.metadata_version\)/);
});

test('viewer WebSocket token is sent through subprotocol instead of URL query', () => {
  assert.match(liveDataSource, /const LIVE_VIEWER_WS_PROTOCOL = 'cf-monitor-viewer'/);
  assert.match(liveDataSource, /export function buildLiveWebSocketProtocols\(viewerToken: string\): string\[\]/);
  assert.doesNotMatch(liveDataSource, /searchParams\.set\('viewer_token'/);
  assert.match(liveDataSource, /new WebSocket\([\s\S]*buildLiveWebSocketProtocols\(viewerToken\)/);
});

test('viewer WebSocket token is fetched from the no-store token endpoint only', () => {
  assert.match(liveDataSource, /fetch\('\/api\/ws\/live-token'\)/);
  assert.match(liveDataSource, /normalizeViewerTokenResponse\(await tokenResponse\.json\(\)\)/);
  assert.doesNotMatch(liveDataSource, /bootstrap\?\.viewer_token/);
});

test('viewer WebSocket connection does not wait for slow public bootstrap', () => {
  const connectMatch = liveDataSource.match(/const connect = async \(\) => \{[\s\S]*?const ws = new WebSocket/);
  assert.ok(connectMatch, 'connect function should exist');
  const connectSource = connectMatch[0];
  assert.doesNotMatch(connectSource, /await fetchPublicBootstrap/);
  assert.doesNotMatch(connectSource, /void fetchLiveData\(\);[\s\S]*fetch\('\/api\/ws\/live-token'\)/);
  assert.match(connectSource, /fetch\('\/api\/ws\/live-token'\)/);
});

test('only realtime pages open live viewer connections', () => {
  assert.doesNotMatch(appSource, /<Route path="\/admin" element=\{<LiveDataRoute/);
  assert.match(appSource, /<Route index element=\{<LiveDataRoute><PublicIndexRoute \/><\/LiveDataRoute>\}/);
  assert.match(appSource, /<Route path="instance\/:uuid" element=\{<LiveDataRoute><Instance \/><\/LiveDataRoute>\}/);
  assert.match(appSource, /<Route index element=\{<LiveDataRoute><AdminDashboard \/><\/LiveDataRoute>\}/);
  assert.doesNotMatch(appSource, /<LiveDataRoute><AdminClients \/><\/LiveDataRoute>/);
  assert.doesNotMatch(appSource, /<LiveDataRoute><SettingsGeneral \/><\/LiveDataRoute>/);
});

test('live snapshots from HTTP, WebSocket, and bootstrap are normalized before use', () => {
  assert.match(liveDataSource, /normalizeLiveDataResponse\(await res\.json\(\)\)/);
  assert.match(liveDataSource, /if \(!data\) throw new Error\('Invalid live data response'\)/);
  assert.match(liveDataSource, /const live = normalizeLiveDataResponse\(payload\?\.live\)/);
  assert.doesNotMatch(liveDataSource, /setLiveData\(snapshot\)/);
  assert.doesNotMatch(liveDataSource, /setLiveData\(payload\.live\)/);
  assert.match(publicBootstrapSource, /live: record\.live === undefined \? undefined : normalizeLiveDataResponse\(record\.live\)/);
});
