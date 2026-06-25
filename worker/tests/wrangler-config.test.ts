import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repoRoot = join(import.meta.dirname, '..', '..');
const configs = [
  ['root', join(repoRoot, 'wrangler.toml')],
  ['worker', join(import.meta.dirname, '..', 'wrangler.toml')],
  ['worker example', join(import.meta.dirname, '..', 'wrangler.example.toml')],
] as const;
const devVarsExample = join(import.meta.dirname, '..', '.dev.vars.example');
const rootPackageJsonPath = join(repoRoot, 'package.json');
const workerPackageJsonPath = join(import.meta.dirname, '..', 'package.json');
const workerTsconfigPath = join(import.meta.dirname, '..', 'tsconfig.json');
const workerTypesPath = join(import.meta.dirname, '..', 'worker-configuration.d.ts');
const deployScriptPath = join(repoRoot, 'scripts', 'deploy-cloudflare.mjs');
const workerIndexPath = join(import.meta.dirname, '..', 'src', 'index.ts');
const liveDataPath = join(import.meta.dirname, '..', 'src', 'do', 'live-data.ts');
const readmePath = join(repoRoot, 'README.md');
const ciWorkflowPath = join(repoRoot, '.github', 'workflows', 'ci.yml');
const gitignorePath = join(repoRoot, '.gitignore');
const removedSettingsKey = 'SETTINGS_' + 'ENCRYPTION_KEY';
const removedDatabaseProxy = String.fromCharCode(104, 121, 112, 101, 114, 100, 114, 105, 118, 101);

function uncommentedLines(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .join('\n');
}

test('Wrangler configs are Supabase HTTP API only', () => {
  const legacyDatabaseList = 'd' + '1' + '_databases';
  const proxyBindingPattern = new RegExp(`\\[\\[${removedDatabaseProxy}\\]\\]|\\b${removedDatabaseProxy}\\b`, 'i');
  for (const [name, path] of configs) {
    const source = readFileSync(path, 'utf8');
    const active = uncommentedLines(source);
    assert.match(active, /\bSUPABASE_URL\b/i, `${name} SUPABASE_URL`);
    assert.match(active, /\[secrets\]\s+required\s*=\s*\["JWT_SECRET", "ADMIN_USERNAME", "ADMIN_PASSWORD", "SUPABASE_SERVICE_ROLE_KEY"\]/, name);
    assert.doesNotMatch(active, /\bDATABASE_URL\b|\bPOSTGRES_/i, name);
    assert.doesNotMatch(active, new RegExp(`\\[\\[${legacyDatabaseList}\\]\\]`, 'i'), name);
    assert.doesNotMatch(active, /\bdatabase_id\s*=/i, name);
    assert.doesNotMatch(source, proxyBindingPattern, name);
    assert.doesNotMatch(active, /\bvpc_(services|networks)\b/i, name);
  }
});

test('Wrangler configs bind runtime, cron, assets, and Durable Objects', () => {
  for (const [name, path] of configs) {
    const active = uncommentedLines(readFileSync(path, 'utf8'));
    assert.match(active, /compatibility_date\s*=\s*"2026-06-21"/, `${name} compatibility date`);
    assert.match(active, /compatibility_flags\s*=\s*\["nodejs_compat"\]/, `${name} compatibility flags`);
    assert.match(active, /\[observability\]\s+enabled\s*=\s*true\s+head_sampling_rate\s*=\s*1/, `${name} observability`);
    assert.match(active, /\[triggers\][\s\S]*?crons\s*=\s*\["\*\/2 \* \* \* \*"\]/, `${name} cron trigger`);
    assert.match(active, /name\s*=\s*"LIVE_DATA"[\s\S]*?class_name\s*=\s*"LiveDataDO"/, `${name} LIVE_DATA`);
    assert.match(active, /name\s*=\s*"RATE_LIMIT"[\s\S]*?class_name\s*=\s*"RateLimitDO"/, `${name} RATE_LIMIT`);
    assert.match(active, /\[assets\]/, `${name} assets`);
    assert.match(active, /not_found_handling\s*=\s*"single-page-application"/, `${name} SPA`);
    assert.match(active, /run_worker_first\s*=\s*\["\/api\/\*", "\/ping", "\/agent\/\*"\]/, `${name} worker-first`);
  }
});

test('local dev vars example uses Supabase URL and service role key only', () => {
  const devVars = readFileSync(devVarsExample, 'utf8');
  assert.match(devVars, /^SUPABASE_URL=/m);
  assert.match(devVars, /^SUPABASE_SERVICE_ROLE_KEY=/m);
  assert.match(devVars, /^JWT_SECRET=/m);
  assert.match(devVars, /^ADMIN_USERNAME=/m);
  assert.match(devVars, /^ADMIN_PASSWORD=/m);
  assert.doesNotMatch(devVars, /^DATABASE_URL=/m);
  assert.doesNotMatch(devVars, /POSTGRES_/);
});

test('package scripts verify frontend, Worker, and Agent without postgres dependency', () => {
  const rootPkg = JSON.parse(readFileSync(rootPackageJsonPath, 'utf8')) as { scripts?: Record<string, string> };
  const workerPkg = JSON.parse(readFileSync(workerPackageJsonPath, 'utf8')) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  assert.equal(rootPkg.scripts?.lint, 'npm --prefix frontend run lint && npm --prefix worker run lint');
  assert.equal(rootPkg.scripts?.build, 'npm --prefix frontend run build && npm --prefix worker run build');
  assert.equal(rootPkg.scripts?.test, 'npm --prefix frontend test && npm --prefix worker test && cd agent && go test ./...');
  assert.equal(rootPkg.scripts?.verify, 'npm run lint && npm run build && npm test');
  assert.equal(workerPkg.scripts?.deploy, 'node ../scripts/deploy-cloudflare.mjs');
  assert.equal(workerPkg.dependencies?.postgres, undefined);
});

test('Worker checks generated Wrangler binding types before TypeScript', () => {
  const pkg = JSON.parse(readFileSync(workerPackageJsonPath, 'utf8')) as { scripts?: Record<string, string> };
  const tsconfig = JSON.parse(readFileSync(workerTsconfigPath, 'utf8')) as { include?: string[] };
  const workerTypes = readFileSync(workerTypesPath, 'utf8');
  const index = readFileSync(workerIndexPath, 'utf8');

  assert.match(pkg.scripts?.lint || '', /wrangler types --check/);
  assert.match(pkg.scripts?.build || '', /wrangler types --check/);
  assert.ok(tsconfig.include?.includes('worker-configuration.d.ts'));
  assert.match(workerTypes, /interface Env/);
  assert.match(workerTypes, /LIVE_DATA: DurableObjectNamespace/);
  assert.match(workerTypes, /RATE_LIMIT: DurableObjectNamespace/);
  assert.match(index, /export type Bindings = Env & RuntimeBindings/);
});

test('deploy script validates Supabase service role secret and generated config', () => {
  const script = readFileSync(deployScriptPath, 'utf8');
  assert.match(script, /wrangler-deploy\.toml/);
  assert.match(script, /requiredSecrets = \['JWT_SECRET', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'SUPABASE_SERVICE_ROLE_KEY'\]/);
  assert.match(script, /\['secret', 'list', '--config', deployConfig\]/);
  assert.match(script, /const keepsExistingVars = deployArgs\.includes\('--keep-vars'\)/);
  assert.doesNotMatch(script, /SOURCE_REVISION|APP_VERSION/);
  assert.doesNotMatch(script, /releases\/latest|tag_name/);
  assert.match(script, /SUPABASE_ACCESS_TOKEN is not set; skipping Supabase migrations/);
  assert.match(script, /\['db', 'push', '--linked', '--workdir', '\.', '--yes'\]/);
  assert.doesNotMatch(script, new RegExp(`\\b${removedDatabaseProxy}\\b`, 'i'));
  assert.doesNotMatch(script, /DATABASE_URL/);
});

test('Durable Object keeps background persistence alive', () => {
  const source = readFileSync(liveDataPath, 'utf8');
  assert.match(source, /const task = promise\.catch/);
  assert.match(source, /this\.state\.waitUntil\(task\)/);
});

test('Ping task refresh pushes a new agent policy', () => {
  const source = readFileSync(liveDataPath, 'utf8');
  assert.match(source, /url\.pathname === '\/ping-tasks-refresh'[\s\S]*?this\.invalidatePingTasksCache\(\)/);
  assert.match(source, /url\.pathname === '\/ping-tasks-refresh'[\s\S]*?await this\.broadcastAgentPolicy\(Date\.now\(\), false, true\)/);
});

test('Agent websocket reports receive policy refreshes after ack', () => {
  const source = readFileSync(liveDataPath, 'utf8');
  const matches = source.match(/sendCurrentPolicyToAgent\(ws, now, false, false, clientId\)/g) || [];
  assert.equal(matches.length, 2);
});

test('README and ignore files document the current deployment path', () => {
  const readme = readFileSync(readmePath, 'utf8');
  const gitignore = readFileSync(gitignorePath, 'utf8');
  assert.match(readme, /SUPABASE_URL/);
  assert.match(readme, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(readme, /Cloudflare Worker/);
  assert.doesNotMatch(readme, /DATABASE_URL|POSTGRES_AUTO_BOOTSTRAP|Hyperdrive/i);
  assert.equal(readme.includes(removedSettingsKey), false);
  assert.match(gitignore, /^\.dev\.vars\*$/m);
  assert.match(gitignore, /^!\.dev\.vars\.example$/m);
});

test('CI uses reproducible workspace install and verification', () => {
  const workflow = readFileSync(ciWorkflowPath, 'utf8');
  assert.match(workflow, /actions\/setup-node@v4/);
  assert.match(workflow, /node-version:\s*22/);
  assert.match(workflow, /run:\s*npm ci/);
  assert.match(workflow, /run:\s*npm run verify/);
  assert.match(workflow, /npm --prefix frontend audit --omit=dev --audit-level=high/);
  assert.match(workflow, /npm --prefix worker audit --omit=dev --audit-level=high/);
  assert.doesNotMatch(workflow, /npm install/);
});
