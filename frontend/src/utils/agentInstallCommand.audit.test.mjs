import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { productionModule } from '../../test/helpers/production-module.mjs';

const subject = productionModule('src/utils/agentInstallCommand.ts');
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const parent = join(repo, '.tmp', 'audit-install-entry');
const posix = value => value.replaceAll('\\', '/');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const isWindows = process.platform === 'win32';
const shellAvailable = spawnSync('sh', ['-c', ':'], { windowsHide: true }).status === 0;
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CF_MONITOR_')));

function fixture(t) {
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(realpathSync(parent), 'case-'));
  for (const dir of ['bin', 'temp']) mkdirSync(join(root, dir));
  t.after(() => {
    const target = realpathSync(root);
    assert.equal(dirname(target), realpathSync(parent));
    assert.ok(target.startsWith(realpathSync(parent) + sep));
    rmSync(target, { recursive: true, force: true });
  });
  return root;
}

function command(platform, action, options = {}) {
  if (action === 'uninstall') return subject.buildAgentUninstallAllCommand({ platform, ...options });
  return subject.buildAgentInstallCommand({ platform, serverUrl: 'https://monitor.example.invalid', token: '', options: { ...subject.defaultAgentInstallOptions, ...options } });
}

function unixRun(t, action, scenario, options = {}) {
  const root = fixture(t);
  // Only the downloader is replaced. Its output is a harmless local marker
  // script; no real installer, service manager or network is executed.
  const downloader = `#!/bin/sh
out=-
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|-O|--output) out="$2"; shift 2 ;;
    -qO-) out=-; shift ;;
    --proxy|--proto|--proto-redir|--retry|--connect-timeout|--max-time) shift 2 ;;
    https://*) printf '%s' "$1" > "$CF_AUDIT_ROOT/request-url"; shift ;;
    *) shift ;;
  esac
done
emit() { printf 'printf downloaded > "$CF_AUDIT_MARKER"\\nexit 0\\n'; }
case "$CF_AUDIT_SCENARIO" in
  failed|non200) exit 22 ;;
  empty) [ "$out" = - ] || : > "$out"; exit 0 ;;
esac
if [ "$out" = - ]; then emit; else emit > "$out"; fi
[ "$CF_AUDIT_SCENARIO" != interrupted ] || exit 23
`;
  for (const name of ['wget', 'curl']) writeFileSync(join(root, 'bin', name), downloader, { mode: 0o755 });
  writeFileSync(join(root, 'install.sh'), 'printf stale > "$CF_AUDIT_STALE"\n');
  const generated = command('unix', action, options);
  const body = `set -u\nFIXTURE_BIN="$(cd ${quote(posix(join(root, 'bin')))} && pwd)"\nPATH="$FIXTURE_BIN:$PATH"; export PATH\n[ "$(command -v curl)" = "$FIXTURE_BIN/curl" ] && [ "$(command -v wget)" = "$FIXTURE_BIN/wget" ] || exit 91\n${generated}\n`;
  const script = join(root, 'entry.sh');
  writeFileSync(script, body);
  const syntax = spawnSync('sh', ['-n', posix(script)], { windowsHide: true });
  assert.equal(syntax.status, 0, 'the generated command must parse before behavior is tested');
  const result = spawnSync('sh', [posix(script)], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: { ...cleanEnv(), TMPDIR: posix(join(root, 'temp')), CF_AUDIT_ROOT: posix(root), CF_AUDIT_SCENARIO: scenario, CF_AUDIT_MARKER: posix(join(root, 'downloaded')), CF_AUDIT_STALE: posix(join(root, 'stale')) } });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.notEqual(result.status, 91, 'the local downloader boundary must be installed');
  return { root, status: result.status };
}

function windowsRun(t, action, scenario, options = {}) {
  const root = fixture(t);
  const generated = command('windows', action, options);
  const encoded = generated.match(/-EncodedCommand ([A-Za-z0-9+/=]+)$/)?.[1];
  assert.ok(encoded, 'Windows launcher preserves its UTF-16LE encoded argument boundary');
  const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
  writeFileSync(join(root, 'install-windows.ps1'), "'stale' | Set-Content -LiteralPath $env:CF_AUDIT_STALE\n");
  const wrapper = `
$ErrorActionPreference='Continue'
function Invoke-WebRequest {
  [CmdletBinding()]
  param([string]$Uri,[string]$OutFile,[switch]$UseBasicParsing,[switch]$PassThru,[int]$MaximumRedirection=5,[string]$Proxy)
  [IO.File]::WriteAllText((Join-Path $env:CF_AUDIT_ROOT 'request-url'),$Uri)
  if ($env:CF_AUDIT_SCENARIO -in @('failed','non200')) { Write-Error 'synthetic download failure'; return }
  if ($env:CF_AUDIT_SCENARIO -eq 'empty') { [IO.File]::WriteAllText($OutFile,''); return [pscustomobject]@{StatusCode=200;Headers=@{}} }
  [IO.File]::WriteAllText($OutFile,'''downloaded'' | Set-Content -LiteralPath $env:CF_AUDIT_MARKER')
  if ($env:CF_AUDIT_SCENARIO -eq 'interrupted') { Write-Error 'synthetic transfer interrupted'; return }
  if ($env:CF_AUDIT_SCENARIO -eq 'downgrade') { return [pscustomobject]@{StatusCode=302;Headers=@{Location='http://download.example.invalid/unsafe'}} }
  return [pscustomobject]@{StatusCode=200;Headers=@{}}
}
Set-Alias iwr Invoke-WebRequest
${decoded}
`;
  const script = join(root, 'entry.ps1');
  writeFileSync(script, wrapper);
  const result = spawnSync('pwsh', ['-NoProfile', '-File', script], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: { ...cleanEnv(), TEMP: join(root, 'temp'), TMP: join(root, 'temp'), CF_AUDIT_ROOT: root, CF_AUDIT_SCENARIO: scenario, CF_AUDIT_MARKER: join(root, 'downloaded'), CF_AUDIT_STALE: join(root, 'stale') } });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.ok(existsSync(join(root, 'request-url')), 'the actual download boundary must execute');
  return { root, status: result.status };
}

for (const [platform, run, available] of [['unix', unixRun, shellAvailable], ['windows', windowsRun, isWindows]]) {
  for (const action of ['install', 'uninstall']) {
    for (const scenario of ['failed', 'non200', 'empty', 'interrupted']) {
      test(`IN01 ${platform} ${action} refuses ${scenario} downloads and never executes old/partial files`, { skip: !available }, t => {
        const result = run(t, action, scenario);
        assert.notEqual(result.status, 0, 'a failed or empty download must fail the entry command');
        assert.equal(existsSync(join(result.root, 'downloaded')), false, 'partial downloads must never execute');
        assert.equal(existsSync(join(result.root, 'stale')), false, 'an existing same-name script must never execute');
        assert.equal(readdirSync(join(result.root, 'temp')).length, 0, 'temporary downloads must be cleaned');
      });
    }
    test(`IN01 ${platform} ${action} executes only a completed download and cleans its temporary directory`, { skip: !available }, t => {
      const result = run(t, action, 'success');
      assert.equal(result.status, 0);
      assert.ok(existsSync(join(result.root, 'downloaded')));
      assert.equal(existsSync(join(result.root, 'stale')), false);
      assert.equal(readdirSync(join(result.root, 'temp')).length, 0);
    });
  }
}

test('IN02 content mirrors require HTTPS while HTTP CONNECT proxies remain available', () => {
  assert.equal(subject.normalizeProxyUrl('http://mirror.example.invalid/prefix'), '', 'a content mirror cannot use cleartext HTTP');
  assert.equal(subject.normalizeProxyUrl('127.0.0.1:10808', false), 'http://127.0.0.1:10808');
  assert.equal(subject.normalizeProxyUrl('https://mirror.example.invalid/prefix'), 'https://mirror.example.invalid/prefix');
});

test('IN02 bootstrap scripts use the official HTTPS origin even when binaries use a content mirror', () => {
  for (const file of ['install.sh', 'install-windows.ps1']) {
    const url = new URL(subject.cfMonitorAgentScriptUrl(file, 'https://mirror.example.invalid/prefix'));
    assert.equal(url.hostname, 'raw.githubusercontent.com', 'the mirror must not supply executable bootstrap code');
  }
});

test('IN02 Windows bootstrap refuses an HTTPS to HTTP redirect before execution', { skip: !isWindows }, t => {
  const result = windowsRun(t, 'install', 'downgrade');
  assert.notEqual(result.status, 0, 'an insecure redirect must stop the command');
  assert.equal(existsSync(join(result.root, 'downloaded')), false);
  assert.equal(existsSync(join(result.root, 'stale')), false);
});
