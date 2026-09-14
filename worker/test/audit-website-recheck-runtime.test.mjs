import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeFixture, eventually } from '../test-support/runtime-fixture.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('W04: native durable alarm resumes a deferred website recheck after restart without delaying the Agent receipt', { timeout: 60000 }, async t => {
  let blockMonitorRead = true, deferredReads = 0, probes = 0;
  const entered = deferred(), release = deferred();
  const f = await createRuntimeFixture({ persistDurableObjects: true,
    externalResponse: async () => { probes += 1; entered.resolve('probe'); await release.promise; return new Response(null, { status: 200 }); },
    rpcHook: ({ name, phase }) => {
      if (name === 'cfm_website_monitor' && phase === 'before' && blockMonitorRead) {
        deferredReads += 1;
        return Response.json({ message: 'Synthetic temporarily unavailable recheck settings' }, { status: 503 });
      }
    },
  });
  t.after(async () => { release.resolve(); await f.close(); });
  const token = 'synthetic-recheck-token-'.padEnd(64, '0');
  await f.database.query("insert into clients(uuid,name,token) values ('recheck-node','Synthetic recheck node',$1)", [token]);
  await f.database.exec("insert into website_monitors(id,name,url,agent_probe_mode,agent_probe_clients,agent_probe_status_enabled,timeout_sec) values(1,'Synthetic delayed website','https://slow.audit.example.com/','selected','[\"recheck-node\"]',true,30)");
  const revision = (await f.database.query('select config_revision from website_monitors where id=1')).rows[0].config_revision;
  const report = { timestamp: Date.now(), cpu: 12, website_probe_results: [{ monitor_id: 1, config_revision: revision,
    ok: false, effective_status: 'down', effective_reason: 'timeout', latency_ms: 30000, status_code: null, raw_status_code: null }] };
  const sending = f.fetch('/api/clients/report', { method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
  }, body: JSON.stringify(report) });
  const first = await Promise.race([sending.then(response => ({ kind: 'receipt', response })), entered.promise.then(() => ({ kind: 'probe' }))]);
  assert.equal(first.kind, 'receipt', 'a slow external recheck must never precede Agent acknowledgement');
  assert.equal(first.response.status, 200);
  const counts = async () => (await f.database.query("select count(*) filter(where source_type='agent')::int as agent,count(*) filter(where source_type='worker')::int as worker from website_checks where monitor_id=1")).rows[0];
  assert.deepEqual(await counts(), { agent: 1, worker: 0 }, 'Agent data is already confirmed when the response is sent');
  await eventually(() => deferredReads > 0, 8000);
  assert.equal(probes, 0);
  await f.restart();
  blockMonitorRead = false;
  await eventually(() => probes === 1, 15000);
  assert.deepEqual(await counts(), { agent: 1, worker: 0 }, 'the original result is not reinserted while the recovered probe waits');
  release.resolve();
  await eventually(async () => (await counts()).worker === 1, 5000);
  await f.restart();
  assert.deepEqual(await counts(), { agent: 1, worker: 1 });
  assert.equal(probes, 1);
});
