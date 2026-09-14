import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

test('Cloudflare compilation waits for commit CI while ordinary builds remain independent', async t => {
  const parent = resolve(tmpdir());
  const root = mkdtempSync(join(parent, 'cf-monitor-build-order-'));
  t.after(() => {
    assert.equal(dirname(root), parent, 'cleanup stays within the fixture temp directory');
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, 'scripts'));
  copyFileSync(fileURLToPath(new URL('./github-ci-gate.mjs', import.meta.url)), join(root, 'scripts', 'github-ci-gate.mjs'));
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module', scripts: {
    ...(scripts.prebuild ? { prebuild: scripts.prebuild } : {}),
    build: 'node -e "require(\'node:fs\').appendFileSync(\'events.log\', \'build\\n\')"',
  } }));
  // Only the external GitHub API is replaced; npm hooks and the Git checkout are real.
  const preload = join(root, 'github-fixture.mjs');
  writeFileSync(preload, `import { appendFileSync } from 'node:fs';
globalThis.fetch = async input => {
  const url = new URL(input);
  if (url.origin !== 'https://api.github.com') throw new Error('Unexpected fixture request');
  const event = url.searchParams.get('event');
  appendFileSync('events.log', 'ci-' + event + '\\n');
  if (process.env.FIXTURE_CI_STATE === 'unavailable') return { status: 403 };
  const runs = event === 'push' ? [{ id: 100, run_attempt: 1,
    head_sha: url.searchParams.get('head_sha'), head_repository: { full_name: 'synthetic/monitor' },
    path: '.github/workflows/ci.yml', event, status: 'completed', conclusion: process.env.FIXTURE_CI_STATE }] : [];
  return { status: 200, json: async () => ({ total_count: runs.length, workflow_runs: runs }) };
};
`);
  const env = { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '', WORKERS_CI: '',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const git = args => {
    const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(['init', '-q']);
  git(['remote', 'add', 'origin', 'https://github.com/synthetic/monitor.git']);
  git(['add', '.']);
  git(['-c', 'user.name=BuildFixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  env.WORKERS_CI_COMMIT_SHA = git(['rev-parse', 'HEAD']);
  env.NODE_OPTIONS = `--import=${pathToFileURL(preload).href}`;
  const cases = [
    ['local build', {}, 'failure', ['build'], true],
    ['GitHub CI build', { CI: 'true', GITHUB_ACTIONS: 'true' }, 'failure', ['build'], true],
    ['successful Workers CI', { WORKERS_CI: '1' }, 'success', ['ci-push', 'ci-workflow_dispatch', 'build'], true],
    ['failed Workers CI', { WORKERS_CI: '1' }, 'failure', ['ci-push', 'ci-workflow_dispatch'], false],
    ['unavailable Workers CI', { WORKERS_CI: '1' }, 'unavailable', ['ci-push'], false],
  ];
  for (const [label, buildEnv, state, expectedEvents, succeeds] of cases) {
    await t.test(label, () => {
      rmSync(join(root, 'events.log'), { force: true });
      const result = spawnSync(process.platform === 'win32' ? 'cmd.exe' : 'npm',
        process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run build'] : ['run', 'build'], {
        cwd: root, env: { ...env, ...buildEnv, FIXTURE_CI_STATE: state }, encoding: 'utf8',
        windowsHide: true, timeout: 30_000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status === 0, succeeds, result.stdout + result.stderr);
      assert.deepEqual(readFileSync(join(root, 'events.log'), 'utf8').trim().split('\n'), expectedEvents);
    });
  }
  await t.test('explicit deployment gate still runs outside Workers Builds', () => {
    rmSync(join(root, 'events.log'), { force: true });
    const result = spawnSync(process.execPath, [join(root, 'scripts', 'github-ci-gate.mjs')], {
      cwd: root, env: { ...env, FIXTURE_CI_STATE: 'failure' }, encoding: 'utf8', windowsHide: true, timeout: 30_000,
    });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.deepEqual(readFileSync(join(root, 'events.log'), 'utf8').trim().split('\n'), ['ci-push', 'ci-workflow_dispatch']);
  });
});
