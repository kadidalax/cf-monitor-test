import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const sourceConfig = join(root, 'wrangler.toml');
const deployConfig = join(root, 'worker', '.tmp', 'wrangler-deploy.toml');
const requiredSecrets = ['JWT_SECRET', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'SUPABASE_SERVICE_ROLE_KEY'];
const deployArgs = process.argv.slice(2);
const isDryRun = deployArgs.includes('--dry-run');
const keepsExistingVars = deployArgs.includes('--keep-vars');

function runWrangler(args, options = {}) {
  return spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function supabaseProjectRef() {
  const source = readFileSync(sourceConfig, 'utf8');
  const match = source.match(/SUPABASE_URL\s*=\s*"https:\/\/([a-z0-9]+)\.supabase\.co"/i);
  return match?.[1] || '';
}

function writeDeployConfig() {
  const source = readFileSync(sourceConfig, 'utf8');
  const generated = source
    .replace('main = "worker/src/index.ts"', 'main = "../src/index.ts"')
    .replace('directory = "frontend/dist"', 'directory = "../../frontend/dist"');
  mkdirSync(dirname(deployConfig), { recursive: true });
  writeFileSync(deployConfig, generated);
}

function checkSecrets() {
  const result = runWrangler(['secret', 'list', '--config', deployConfig]);
  if (result.status !== 0) {
    fail(`Could not list Worker secrets. Set them first with: npx wrangler secret put JWT_SECRET\n${result.stderr || result.stdout}`);
  }

  let secrets;
  try {
    secrets = JSON.parse(result.stdout);
  } catch {
    fail(`Could not parse Worker secret list.\n${result.stdout}`);
  }

  const names = new Set(secrets.map(secret => secret.name));
  const missing = requiredSecrets.filter(name => !names.has(name));
  if (missing.length) {
    fail(`Missing required Worker secrets: ${missing.join(', ')}\nSet them with: npx wrangler secret put <NAME>`);
  }
}

function runSupabase(args) {
  return spawnSync('supabase', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
    env: process.env,
  });
}

function migrateSupabase() {
  if (!process.env.SUPABASE_ACCESS_TOKEN?.trim()) {
    console.log('SUPABASE_ACCESS_TOKEN is not set; skipping Supabase migrations.');
    return;
  }
  const projectRef = supabaseProjectRef();
  if (!projectRef) fail('Could not infer Supabase project ref from SUPABASE_URL.');

  const link = runSupabase(['link', '--project-ref', projectRef, '--yes', '--workdir', '.']);
  if (link.status !== 0) fail('Supabase project link failed.');

  const push = runSupabase(['db', 'push', '--linked', '--workdir', '.', '--yes']);
  if (push.status !== 0) fail('Supabase migration push failed.');
}

writeDeployConfig();

if (isDryRun) {
  const deploy = runWrangler(['deploy', '--config', deployConfig, ...deployArgs], { stdio: 'inherit' });
  process.exit(deploy.status ?? 1);
}

if (!keepsExistingVars) {
  checkSecrets();
}

const deploy = runWrangler(['deploy', '--config', deployConfig, ...deployArgs], { stdio: 'inherit' });
if (deploy.status !== 0) process.exit(deploy.status ?? 1);

migrateSupabase();
