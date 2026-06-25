import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

const rootDir = join(import.meta.dirname, '..', '..');
const excludedDirs = new Set([
  '.git',
  '.wrangler',
  'dist',
  'node_modules',
  '.tmp',
]);
const includedExtensions = new Set([
  '.env',
  '.example',
  '.json',
  '.mjs',
  '.md',
  '.ps1',
  '.sh',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const excludedFiles = new Set([
  'CODE_ANALYSIS_REPORT.md',
  'quota-optimization-analysis.md',
  'supabase-click-deploy-migration-plan.md',
  'full-300s-no-experience-degradation-plan.md',
  'low-write-mode-300s-linked-plan.md',
]);

function shouldScan(path: string): boolean {
  const rel = relative(rootDir, path).replace(/\\/g, '/');
  if (excludedFiles.has(rel)) return false;
  const name = rel.split('/').at(-1) || '';
  if (name.endsWith('.lock')) return false;
  return [...includedExtensions].some(ext => name.endsWith(ext));
}

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (excludedDirs.has(entry)) continue;
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      files.push(...listFiles(path));
    } else if (stats.isFile() && shouldScan(path)) {
      files.push(path);
    }
  }
  return files;
}

test('source and deployable config do not contain committed secrets', () => {
  const findings: string[] = [];
  const patterns = [
    [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i, 'private key block'],
    [/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'Supabase JWT-style API key'],
    [/\b(?:account_id|api_token|zone_id)\s*=\s*"[0-9a-f]{32}"/i, 'Cloudflare account/token/id'],
    [/postgres(?:ql)?:\/\/[^:\s"'<>]+:(?!PASSWORD\b|<PASSWORD>|<password>|\[REDACTED\b)[^@\s"'<>]+@/i, 'Postgres URL with embedded password'],
  ] as const;

  for (const file of listFiles(rootDir)) {
    const rel = relative(rootDir, file).replace(/\\/g, '/');
    const source = readFileSync(file, 'utf8');
    for (const [pattern, label] of patterns) {
      if (pattern.test(source)) findings.push(`${rel}: ${label}`);
    }
  }

  assert.deepEqual(findings, []);
});
