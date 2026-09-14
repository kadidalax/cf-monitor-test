import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeFixture, eventually } from '../test-support/runtime-fixture.mjs';

for (const withStaleResult of [false, true]) test(`independent W04: current recheck ${withStaleResult ? 'survives a stale Agent result' : 'runs without a stale result'}`, { timeout: 45000 }, async t => {
  let blocked = true, acceptedAlarmReads = 0, probes = 0;
  const f = await createRuntimeFixture({ persistDurableObjects: true,
    externalResponse: async () => { probes++; return new Response(null, { status: 200 }); },
    rpcHook: ({ name, phase }) => {
      if (name !== 'cfm_website_monitor') return;
      if (phase === 'before' && blocked) return Response.json({ message: 'Synthetic deferred recheck' }, { status: 503 });
      if (phase === 'after' && !blocked) acceptedAlarmReads++;
    },
  });
  t.after(() => f.close());
  const token = 'synthetic-stale-recheck-agent-0000000000000000000000';
  await f.database.query('insert into clients(uuid,name,token) values($1,$2,$3)', ['stale-recheck-node', 'Synthetic node', token]);
  await f.database.query(`insert into website_monitors(id,name,url,agent_probe_mode,agent_probe_clients,agent_probe_status_enabled,timeout_sec)
    values(1,'Synthetic website',$1,'selected',$2,true,5)`, ['https://before.audit.example.com/', JSON.stringify(['stale-recheck-node'])]);
  const oldRevision = (await f.database.query('select config_revision from website_monitors where id=1')).rows[0].config_revision;
  await f.database.query('update website_monitors set url=$1 where id=1', ['https://after.audit.example.com/']);
  const currentRevision = (await f.database.query('select config_revision from website_monitors where id=1')).rows[0].config_revision;
  assert.notEqual(oldRevision, currentRevision);
  const sampleTime = Date.now() - 1000;
  const send = (configRevision, timestamp) => f.fetch('/api/clients/report', { method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
  }, body: JSON.stringify({ cpu: 13, timestamp, website_probe_results: [{ monitor_id: 1, config_revision: configRevision,
    ok: false, effective_status: 'down', effective_reason: 'timeout', latency_ms: 1000, status_code: null, raw_status_code: null }] }) });
  assert.equal((await send(currentRevision, sampleTime)).status, 200);
  if (withStaleResult) assert.equal((await send(oldRevision, sampleTime - 1000)).status, 200);
  assert.equal((await f.database.query('select count(*)::int as count from website_checks where monitor_id=1')).rows[0].count, 1,
    'SQL correctly rejects the stale sample while retaining the current failed result');
  blocked = false;
  await eventually(() => acceptedAlarmReads > 0, 10000);
  try { await eventually(() => probes > 0, 6000); } catch {}
  assert.equal(probes, 1, 'the stale sample must leave the valid pending recheck available to the durable alarm');
  await eventually(async () => (await f.database.query("select count(*)::int as count from website_checks where monitor_id=1 and source_type='worker'")).rows[0].count === 1, 5000);
});
