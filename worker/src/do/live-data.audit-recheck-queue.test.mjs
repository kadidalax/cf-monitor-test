import assert from 'node:assert/strict';
import test from 'node:test';
import { createDurableState, createSocket, createWorkerLoader } from '../../test-support/worker-module.mjs';

const revision = '00000000-0000-4000-8000-000000000004';
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; }

async function fixture() {
  let now = 1_800_000_000_000;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const entered = deferred(), release = deferred();
  const storage = createDurableState();
  const site = { id: 1, config_revision: revision, name: 'Synthetic website', url: 'https://slow.audit.example.com/',
    enabled: true, method: 'GET', timeout_sec: 30, expected_status_min: 200, expected_status_max: 299,
    agent_probe_mode: 'selected', agent_probe_clients: ['queue-node'], agent_probe_status_enabled: true, status: 'down', last_checked_at: null };
  const rows = [];
  const faults = { agentWrites: 0, workerWrites: 0, deleted: false, probes: 0 };
  const loader = createWorkerLoader({ globals: { Date: Clock, fetch: async () => {
    faults.probes += 1;
    entered.resolve('probe'); await release.promise; return new Response('Synthetic response', { status: 200 });
  } }, db: {
    getSettingsByKeys: async () => ({ record_enabled: 'true' }),
    getHistoryStorageRowCounts: async () => ({ records: 0 }), getHistoryStorageBytes: async () => ({ total: 0 }),
    getHistoryStorageUsage: async () => ({ live_rows: 0, estimated_live_storage_bytes: 0, allocated_bytes: 0 }),
    listPingTasks: async () => [], listAgentWebsiteProbeTasks: async () => [structuredClone(site)],
    getWebsiteMonitor: async () => faults.deleted ? null : structuredClone(site),
    recordWebsiteCheck: async (_db, check) => {
      const faultKey = check.source_type === 'agent' ? 'agentWrites' : 'workerWrites';
      if (faults[faultKey] > 0) { faults[faultKey] -= 1; throw new Error('Synthetic SQL outage'); }
      if (rows.some(row => row.source_type === check.source_type && row.checked_at === check.checked_at)) return null;
      rows.push(structuredClone(check)); site.last_checked_at = check.checked_at; site.status = check.effective_status;
      return structuredClone(site);
    },
    listPublicClientRows: async () => [{ uuid: 'queue-node' }], insertRecord: async () => {}, updateClient: async () => {},
    getSetting: async () => null, setSetting: async () => {}, tryClaimAuditThrottle: async () => true, insertAuditLog: async () => {},
  } });
  const { LiveDataDO } = loader.load('worker/src/do/live-data.ts');
  return { storage, site, rows, faults, entered, release, object: new LiveDataDO(storage.state, {}),
    advance: milliseconds => { now += milliseconds; }, cold: () => new LiveDataDO(storage.state, {}),
    report: { timestamp: now, cpu: 4, website_probe_results: [{ monitor_id: 1, config_revision: revision,
      ok: false, effective_status: 'down', effective_reason: 'timeout', latency_ms: 30000, status_code: null, raw_status_code: null }] },
  };
}

function jobs(f) { return [...f.storage.values.entries()].filter(([key]) => key.startsWith('website-recheck:')); }
function report(f) { return f.object.fetch(new Request('https://do/client-report', { method: 'POST',
  body: JSON.stringify({ uuid: 'queue-node', name: 'Synthetic node', hidden: false, report: f.report }) })); }

test('W04: a failed original SQL write remains recoverable and is never acknowledged', async () => {
  const f = await fixture(); f.faults.agentWrites = 1;
  assert.equal((await report(f)).status, 503);
  assert.equal(f.rows.length, 0);
  assert.equal(jobs(f).length, 1);
  f.advance(2000); f.release.resolve();
  await f.cold().alarm();
  assert.equal(f.rows.filter(row => row.source_type === 'agent').length, 1);
  assert.equal(f.rows.filter(row => row.source_type !== 'agent').length, 1);
  assert.equal(jobs(f).length, 0);
  await f.storage.drain();
});

test('W04: recheck SQL failure retries after restart without duplicating the original result', async () => {
  const f = await fixture();
  assert.equal((await report(f)).status, 200);
  f.faults.workerWrites = 1; f.advance(2000); f.release.resolve();
  await f.object.alarm();
  assert.equal(jobs(f).length, 1);
  assert.equal(jobs(f)[0][1].attempts, 1);
  f.advance(3000); await f.cold().alarm();
  assert.equal(f.rows.filter(row => row.source_type === 'agent').length, 1);
  assert.equal(f.rows.filter(row => row.source_type !== 'agent').length, 1);
  assert.equal(jobs(f).length, 0);
  await f.storage.drain();
});

for (const obsolete of ['revision', 'disabled', 'deleted', 'newer-result']) {
  test(`W04: a queued check becomes obsolete after ${obsolete}`, async () => {
    const f = await fixture();
    assert.equal((await report(f)).status, 200);
    if (obsolete === 'revision') f.site.config_revision = '00000000-0000-4000-8000-000000000005';
    if (obsolete === 'disabled') f.site.enabled = false;
    if (obsolete === 'deleted') f.faults.deleted = true;
    if (obsolete === 'newer-result') f.site.last_checked_at = new Date(f.report.timestamp + 1000).toISOString();
    f.advance(2000); f.release.resolve(); await f.cold().alarm();
    assert.equal(f.faults.probes, 0);
    assert.equal(jobs(f).length, 0);
    await f.storage.drain();
  });
}

test('W04: duplicate reports keep one pending job and one original result', async () => {
  const f = await fixture();
  assert.equal((await report(f)).status, 200);
  const id = jobs(f)[0][1].id;
  assert.equal((await report(f)).status, 200);
  assert.equal(jobs(f).length, 1); assert.equal(jobs(f)[0][1].id, id);
  assert.equal(f.rows.length, 1);
  f.advance(2000); f.release.resolve(); await f.object.alarm();
  assert.equal(f.rows.length, 2); await f.storage.drain();
});

test('W04: completing a slow old task cannot erase a newer queued report', async () => {
  const f = await fixture();
  assert.equal((await report(f)).status, 200);
  const oldId = jobs(f)[0][1].id;
  f.advance(2000); const alarm = f.object.alarm();
  await f.entered.promise;
  f.report.timestamp += 2000;
  assert.equal((await report(f)).status, 200);
  assert.notEqual(jobs(f)[0][1].id, oldId);
  f.release.resolve(); await alarm;
  assert.equal(jobs(f).length, 1, 'a task arriving during external I/O must survive old completion');
  f.advance(2000); await f.cold().alarm();
  assert.equal(jobs(f).length, 0); await f.storage.drain();
});

test('W04: alarm scheduling failure rejects acceptance but preserves durable retry data', async () => {
  const f = await fixture();
  const schedule = f.storage.state.storage.setAlarm;
  f.storage.state.storage.setAlarm = async () => { throw new Error('Synthetic alarm unavailable'); };
  assert.equal((await report(f)).status, 503);
  assert.equal(jobs(f).length, 1); assert.equal(f.faults.probes, 0);
  f.storage.state.storage.setAlarm = schedule;
  assert.equal((await report(f)).status, 200);
  f.advance(2000); f.release.resolve(); await f.cold().alarm();
  assert.equal(jobs(f).length, 0); await f.storage.drain();
});

test('W04: a full bounded queue rejects new work without discarding earlier reports', async () => {
  const f = await fixture();
  assert.equal((await report(f)).status, 200);
  const [key, template] = jobs(f)[0];
  f.storage.values.delete(key);
  for (let id = 2; id <= 257; id++) f.storage.values.set(`website-recheck:${id}`,
    { ...template, id: `synthetic-${id}`, check: { ...template.check, monitor_id: id } });
  f.report.timestamp += 1000; f.advance(1000);
  assert.equal((await report(f)).status, 503);
  assert.equal(jobs(f).length, 256);
  assert.equal(jobs(f).some(([, task]) => task.check.monitor_id === 1), false);
  assert.equal(f.faults.probes, 0); await f.storage.drain();
});

test('W04: an upgrade consumes a pending job stored under the legacy monitor-only key', async () => {
  const f = await fixture();
  assert.equal((await report(f)).status, 200);
  const [key, task] = jobs(f)[0];
  f.storage.values.delete(key);
  f.storage.values.set('website-recheck:1', task);
  f.advance(2000); f.release.resolve();
  await f.cold().alarm();
  assert.equal(f.faults.probes, 1);
  assert.equal(f.rows.filter(row => row.source_type !== 'agent').length, 1);
  assert.equal(jobs(f).length, 0);
  await f.storage.drain();
});

for (const transport of ['http', 'websocket']) {
  test(`W04: ${transport} acknowledges durable work before slow rechecks, and a cold alarm resumes it`, async () => {
    const f = await fixture();
    let sending;
    if (transport === 'http') {
      sending = f.object.fetch(new Request('https://do/client-report', { method: 'POST', body: JSON.stringify({
        uuid: 'queue-node', name: 'Synthetic node', hidden: false, report: f.report,
      }) })).then(response => { assert.equal(response.status, 200); return 'ack'; });
    } else {
      const socket = createSocket({ role: 'agent', clientId: 'queue-node', clientName: 'Synthetic node', hidden: false });
      f.object.registerSession(socket.ws, socket.ws.deserializeAttachment());
      sending = f.object.webSocketMessage(socket.ws, JSON.stringify({ type: 'report', data: f.report })).then(() => {
        assert.ok(socket.messages.some(message => message.type === 'ack')); return 'ack';
      });
    }
    try {
      assert.equal(await Promise.race([sending, f.entered.promise]), 'ack', 'network recheck must not precede acknowledgement');
      assert.equal(f.rows.filter(row => row.source_type === 'agent').length, 1, 'required agent result must already be stored');
      assert.equal([...f.storage.values.keys()].filter(key => key.startsWith('website-recheck:')).length, 1);
      f.advance(2000);
      const cold = f.cold();
      const alarm = cold.alarm();
      await f.entered.promise;
      f.release.resolve();
      await alarm;
      assert.equal(f.rows.filter(row => row.source_type === 'worker' || row.source_type === undefined).length, 1);
      assert.equal([...f.storage.values.keys()].filter(key => key.startsWith('website-recheck:')).length, 0);
    } finally {
      f.release.resolve(); await sending; await f.storage.drain();
    }
  });
}
