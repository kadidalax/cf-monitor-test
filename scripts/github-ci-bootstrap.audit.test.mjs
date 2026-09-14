import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runGithubCiGate } from './github-ci-gate.mjs';

const sha = 'a'.repeat(40);
const repository = 'synthetic/fresh-fork';
function workflow(event, patch = {}) {
  return { id: 100, run_attempt: 1, head_sha: sha, head_repository: { full_name: repository },
    path: '.github/workflows/ci.yml', event, status: 'completed', conclusion: 'success', ...patch };
}
function fixture(responses, { status = 200 } = {}) {
  const calls = [], logs = [];
  let clock = 0;
  const observed = new Map();
  return { calls, logs, elapsed: () => clock, execute: () => runGithubCiGate({
    root: '/synthetic-checkout', env: {}, now: () => clock, timeoutMs: 90_000, pollMs: 30_000,
    sleep: async ms => { clock += ms; }, log: value => logs.push(value),
    run: (_command, args) => ({ status: 0, stdout: args[0] === 'rev-parse' ? sha
      : args[0] === 'remote' ? `https://github.com/${repository}.git` : '' }),
    fetchImpl: async (input, options) => {
      const url = new URL(input);
      assert.equal(options.method, 'GET', 'the gate must not dispatch a workflow or publish automatically');
      assert.equal(url.searchParams.get('head_sha'), sha);
      assert.equal(url.pathname, `/repos/${repository}/actions/workflows/ci.yml/runs`);
      const event = url.searchParams.get('event');
      assert.ok(['push', 'workflow_dispatch'].includes(event));
      const index = observed.get(event) || 0;
      observed.set(event, index + 1);
      calls.push({ event, index });
      const sequence = responses[event] || [[]];
      const runs = sequence[Math.min(index, sequence.length - 1)];
      return { status, json: async () => ({ total_count: runs.length, workflow_runs: runs }) };
    },
  }) };
}

test('CI01 a fresh fork can verify the same commit using a completed manual CI run', async () => {
  const f = fixture({ workflow_dispatch: [[workflow('workflow_dispatch')]] });
  const result = await f.execute();
  assert.equal(result.runId, 100);
  assert.equal(result.sha, sha);
  assert.equal(f.elapsed(), 0);
});

test('CI01 a newer failed manual run cannot be hidden by an old successful push', async () => {
  const f = fixture({ push: [[workflow('push')]], workflow_dispatch: [[workflow('workflow_dispatch', { id: 101, conclusion: 'failure' })]] });
  await assert.rejects(f.execute(), { code: 'CI_NOT_SUCCESSFUL' });
});

test('CI01 queued manual work waits for its current attempt before permitting the checkout', async () => {
  const f = fixture({ workflow_dispatch: [
    [workflow('workflow_dispatch', { run_attempt: 2, status: 'queued', conclusion: null })],
    [workflow('workflow_dispatch', { run_attempt: 2 })],
  ] });
  const result = await f.execute();
  assert.equal(result.runAttempt, 2);
  assert.equal(f.elapsed(), 30_000);
});

test('CI01 an earlier manual success cannot bypass a newer pending push', async () => {
  const f = fixture({ push: [[workflow('push', { id: 101, status: 'in_progress', conclusion: null })]],
    workflow_dispatch: [[workflow('workflow_dispatch')]] });
  await assert.rejects(f.execute(), { code: 'WAIT_TIMEOUT' });
});

for (const patch of [
  { head_sha: 'b'.repeat(40) }, { head_repository: { full_name: 'synthetic/other' } },
  { path: '.github/workflows/release-agent.yml' }, { event: 'pull_request' },
]) {
  test(`CI01 manual CI still rejects a mismatched ${Object.keys(patch)[0]}`, async () => {
    const f = fixture({ workflow_dispatch: [[workflow('workflow_dispatch', patch)]] });
    await assert.rejects(f.execute(), { code: 'RUN_MISMATCH' });
  });
}

test('CI01 unavailable workflows fail immediately with first-run recovery instructions', async () => {
  const f = fixture({}, { status: 404 });
  await assert.rejects(f.execute(), error => error.code === 'WORKFLOW_UNAVAILABLE'
    && /Actions/.test(error.message) && /Run workflow/.test(error.message) && error.message.includes(sha.slice(0, 7)));
  assert.equal(f.elapsed(), 0);
  assert.equal(f.calls.length, 1);
});

test('CI01 missing runs explain how to trigger matching CI without bypassing the bounded gate', async () => {
  const f = fixture({});
  await assert.rejects(f.execute(), error => error.code === 'WAIT_TIMEOUT' && /Run workflow/.test(error.message));
  assert.ok(f.logs.some(value => /Run workflow/.test(value) && value.includes(sha.slice(0, 7))));
});

test('CI01 the actual CI workflow offers the manual entry point used by the bootstrap instructions', async () => {
  const source = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const onBlock = /^on:\r?\n((?:[ \t].*(?:\r?\n|$)|\r?\n)*)/m.exec(source)?.[1];
  assert.ok(onBlock, 'load the actual top-level workflow trigger map');
  assert.match(onBlock, /^  workflow_dispatch:\s*$/m);
});
