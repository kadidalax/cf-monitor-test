import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeFixture, eventually } from '../test-support/runtime-fixture.mjs';

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('independent W04: an old assignment query returning late cannot erase another Agent current recheck', { timeout: 60000 }, async t => {
  const read = deferred(), release = deferred();
  let holdOldAssignment = true, blockAlarms = true, acceptedAlarmReads = 0, probes = 0;
  const f = await createRuntimeFixture({ persistDurableObjects: true,
    externalResponse: async () => { probes++; return new Response(null, { status: 200 }); },
    rpcHook: async ({ name, phase, args, result }) => {
      if (holdOldAssignment && name === 'cfm_agent_website_probe_tasks' && phase === 'after' && args.input_client === 'old-assignment-node') {
        holdOldAssignment = false;
        assert.equal(result.length, 1, 'the earlier assignment must actually have been read');
        read.resolve(); await release.promise;
      }
      if (name === 'cfm_website_monitor') {
        if (phase === 'before' && blockAlarms) return Response.json({ message: 'Synthetic deferred alarm' }, { status: 503 });
        if (phase === 'after' && !blockAlarms) acceptedAlarmReads++;
      }
    },
  });
  t.after(async () => { release.resolve(); await f.close(); });
  const tokenFor = uuid => `synthetic-assignment-review-${uuid}-000000000000000000`;
  for (const uuid of ['old-assignment-node', 'new-assignment-node']) await f.database.query(
    'insert into clients(uuid,name,token) values($1,$2,$3)', [uuid, 'Synthetic Agent', tokenFor(uuid)]);
  await f.database.query(`insert into website_monitors(id,name,url,agent_probe_mode,agent_probe_clients,agent_probe_status_enabled,timeout_sec)
    values(1,'Synthetic website',$1,'selected',$2,true,5)`, ['https://old.audit.example.com/', JSON.stringify(['old-assignment-node', 'new-assignment-node'])]);
  const revision = async () => (await f.database.query('select config_revision from website_monitors where id=1')).rows[0].config_revision;
  const firstRevision = await revision();
  const sampleTime = Date.now();
  const send = (uuid, configRevision, timestamp) => f.fetch('/api/clients/report', { method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(uuid)}`,
  }, body: JSON.stringify({ cpu: 17, timestamp, website_probe_results: [{ monitor_id: 1, config_revision: configRevision,
    ok: false, effective_status: 'down', effective_reason: 'timeout', latency_ms: 1000, status_code: null, raw_status_code: null }] }) });
  const oldReport = send('old-assignment-node', firstRevision, sampleTime - 1000);
  try {
    await read.promise;
    await f.database.query('update website_monitors set url=$1 where id=1', ['https://current.audit.example.com/']);
    const currentRevision = await revision();
    assert.notEqual(firstRevision, currentRevision);
    assert.equal((await send('new-assignment-node', currentRevision, sampleTime)).status, 200);
  } finally { release.resolve(); }
  assert.equal((await oldReport).status, 200);
  assert.equal((await f.database.query('select count(*)::int as count from website_checks where monitor_id=1')).rows[0].count, 1);
  blockAlarms = false;
  await eventually(() => acceptedAlarmReads > 0, 10000);
  try { await eventually(() => probes > 0, 6000); } catch {}
  assert.equal(probes, 1, 'the current task survives even if the stale request saw a formerly matching assignment');
  await eventually(async () => (await f.database.query("select count(*)::int as count from website_checks where monitor_id=1 and source_type='worker'")).rows[0].count === 1, 5000);
});
