import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = fileURLToPath(new URL('../', import.meta.url));
const parent = join(repo, '.tmp', 'audit-download-trust');
const posix = value => value.replaceAll('\\', '/');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const isWindows = process.platform === 'win32';
const shellAvailable = spawnSync('sh', ['-c', ':'], { windowsHide: true }).status === 0;
const bash = isWindows ? join(dirname(dirname(spawnSync('where.exe', ['git'], { encoding: 'utf8', windowsHide: true }).stdout.trim().split(/\r?\n/)[0])), 'bin', 'bash.exe') : 'bash';
const officialBase = 'https://github.com/fixture-owner/fixture-repo/releases/download/v1.2.3';
const mirror = 'https://mirror.example.invalid';
const bytes = 'synthetic executable bytes\n';
const digest = createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(realpathSync(parent), 'case-'));
  writeFileSync(join(root, 'binary'), bytes);
  t.after(() => {
    const target = realpathSync(root);
    assert.equal(dirname(target), realpathSync(parent));
    assert.ok(target.startsWith(realpathSync(parent) + sep));
    rmSync(target, { recursive: true, force: true });
  });
  return root;
}

function execute(command, args, root) {
  // Live MSYS shells share /tmp. Keep Windows TEMP/TMP stable across Unix
  // fixture cleanup; TMPDIR still isolates the installer's own scratch files.
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 12000,
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CF_MONITOR_'))), TMPDIR: posix(root), ...(command === 'pwsh' ? { TEMP: root, TMP: root } : {}) } });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  const output = result.stdout + result.stderr;
  result.diagnostic = JSON.stringify({
    forkFailed: /\bfork\b|resource temporarily unavailable/i.test(output),
    processInitializationFailed: /child_copy|dofork|couldn.t reserve|cygwin_exception|DLL rebasing|unable to remap/i.test(output),
    temporaryFileFailed: /mktemp|temporary (?:file|directory)/i.test(output),
    missingFile: /no such file or directory|not found/i.test(output),
    checksumFailed: /checksum.*(?:failed|mismatch|missing|unable)|(?:failed|unable).*checksum/i.test(output),
  });
  return result;
}

function unix(t, file, body) {
  const root = fixture(t);
  const source = readFileSync(join(repo, 'agent', file), 'utf8').replaceAll('\r\n', '\n');
  const definitions = source.split(file === 'install.sh' ? /^while \[ "\$#" -gt 0 \]; do/m : /^while \[\[ \$# -gt 0 \]\]; do/m)[0];
  const script = `${definitions}
ROOT=${quote(posix(root))}; SCRIPT_DIR="$ROOT/no-local-source"
CF_MONITOR_REPOSITORY=fixture-owner/fixture-repo; CF_MONITOR_RELEASE_BASE=${quote(officialBase)}
INSTALL_GHPROXY=${quote(mirror)}; PROXY=http://127.0.0.1:10808; DRY_RUN=0; OS_NAME=linux
${body}
`;
  const path = join(root, 'fixture.sh');
  writeFileSync(path, script);
  const shell = file === 'install.sh' ? 'sh' : bash;
  assert.equal(execute(shell, ['-n', posix(path)], root).status, 0, 'fixture must parse');
  return { root, ...execute(shell, [posix(path)], root) };
}

const checksumDownloader = `download_file() { printf '%s' "$1" > "$ROOT/download-url"; printf '%s  binary\\n' '${digest}' > "$2"; }`;
for (const file of ['install.sh', 'install-linux.sh']) {
  test(`IN02 ${file} rejects cleartext content mirrors but keeps CONNECT`, { skip: !shellAvailable }, t => {
    const bad = unix(t, file, `normalize_proxy_url --install-ghproxy http://mirror.example.invalid`);
    assert.notEqual(bad.status, 0, 'content mirrors must require HTTPS');
    const good = unix(t, file, `normalize_proxy_url --proxy http://127.0.0.1:10808`);
    assert.equal(good.status, 0);
    assert.equal(good.stdout.trim(), 'http://127.0.0.1:10808');
  });
  test(`IN02 ${file} obtains release checksums independently of binary mirrors`, { skip: !shellAvailable }, t => {
    const result = unix(t, file, `BINARY_BASE_URL=${quote(mirror)}\ndefault_checksum_url`);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), `${officialBase}/SHA256SUMS`);
  });
  test(`IN02 ${file} rejects a matching checksum supplied by the binary mirror`, { skip: !shellAvailable }, t => {
    const result = unix(t, file, `${checksumDownloader}\nverify_binary_checksum "$ROOT/binary" binary ${quote(mirror + '/SHA256SUMS')}`);
    assert.notEqual(result.status, 0, 'a matching untrusted digest cannot establish the publisher');
    assert.equal(existsSync(join(result.root, 'download-url')), false, 'untrusted checksum locations must be rejected before download');
  });
  test(`IN02 ${file} accepts an official matching digest and stops on missing checksum`, { skip: !shellAvailable }, t => {
    const valid = unix(t, file, `${checksumDownloader}\nverify_binary_checksum "$ROOT/binary" binary ${quote(officialBase + '/SHA256SUMS')}`);
    assert.equal(valid.status, 0, valid.diagnostic);
    const missing = unix(t, file, `verify_binary_checksum "$ROOT/binary" binary ''`);
    assert.notEqual(missing.status, 0, 'checksum verification cannot be silently omitted');
  });
  test(`IN02 ${file} prevents curl from following insecure redirects`, { skip: !shellAvailable }, t => {
    const result = unix(t, file, `curl() {
  protocols=''; redirects=''
  while [ "$#" -gt 0 ]; do
    case "$1" in --proto) protocols="$2"; shift 2 ;; --proto-redir) redirects="$2"; shift 2 ;; *) shift ;; esac
  done
  [ "$protocols" != '=https' ] || [ "$redirects" != '=https' ] || return 1
  printf untrusted > "$ROOT/followed-http"
}
download_file https://download.example.invalid/redirect "$ROOT/download"`);
    assert.notEqual(result.status, 0, 'download must fail when curl blocks a protocol downgrade');
    assert.equal(existsSync(join(result.root, 'followed-http')), false);
  });
  test(`IN02 ${file} source build downloads remain on the official origin`, { skip: !shellAvailable }, t => {
    const result = unix(t, file, `DRY_RUN=1\ndownload_file() { printf '%s' "$1" > "$ROOT/source-url"; }\nresolve_build_dir`);
    assert.equal(result.status, 0, result.diagnostic);
    assert.equal(new URL(readFileSync(join(result.root, 'source-url'), 'utf8')).hostname, 'github.com');
  });
}

function windows(t, body) {
  const root = fixture(t);
  const sourcePath = join(repo, 'agent', 'install-windows.ps1').replaceAll("'", "''");
  const script = `$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile('${sourcePath}',[ref]$tokens,[ref]$errors)
if($errors.Count){exit 92}
foreach($statement in $ast.EndBlock.Statements){if($statement -is [Management.Automation.Language.FunctionDefinitionAst]){. ([scriptblock]::Create($statement.Extent.Text))}}
$Root=$PSScriptRoot; $scriptDir=Join-Path $Root 'no-local-source'; $repository='fixture-owner/fixture-repo'; $branch='main'
$releaseBase='${officialBase}'; $InstallGhproxy='${mirror}'; $BinaryBaseUrl=''; $Proxy='http://127.0.0.1:10808'; $DryRun=$false
${body}
`;
  const path = join(root, 'fixture.ps1');
  writeFileSync(path, script);
  return { root, ...execute('pwsh', ['-NoProfile', '-File', path], root) };
}

test('IN02 Windows rejects cleartext content mirrors but keeps CONNECT', { skip: !isWindows }, t => {
  assert.notEqual(windows(t, "Normalize-HttpUrl -Name '-InstallGhproxy' -Url 'http://mirror.example.invalid'").status, 0);
  const good = windows(t, "Normalize-HttpUrl -Name '-Proxy' -Url 'http://127.0.0.1:10808' -AllowPath $false");
  assert.equal(good.status, 0);
  assert.equal(good.stdout.trim(), 'http://127.0.0.1:10808');
});

test('IN02 Windows obtains checksums from the official release independently of mirrors', { skip: !isWindows }, t => {
  const result = windows(t, `$BinaryBaseUrl='${mirror}'; Get-DefaultChecksumUrl`);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), `${officialBase}/SHA256SUMS`);
});

test('IN02 Windows rejects untrusted matching checksums before downloading', { skip: !isWindows }, t => {
  const result = windows(t, `function Invoke-DownloadFile($Url,$OutFile){ 'requested' | Set-Content (Join-Path $Root 'downloaded'); '${digest}  binary' | Set-Content $OutFile }
Test-DownloadedChecksum -Path (Join-Path $Root 'binary') -FileName binary -Url '${mirror}/SHA256SUMS'`);
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(result.root, 'downloaded')), false);
});

test('IN02 Windows installer refuses an HTTPS to HTTP redirect', { skip: !isWindows }, t => {
  const result = windows(t, `function Invoke-WebRequest {
  [CmdletBinding()]param([string]$Uri,[string]$OutFile,[switch]$UseBasicParsing,[switch]$PassThru,[int]$MaximumRedirection=5,[string]$Proxy)
  if($MaximumRedirection -ne 0){'followed' | Set-Content (Join-Path $Root 'followed-http')}
  [pscustomobject]@{StatusCode=302;Headers=@{Location='http://download.example.invalid/unsafe'}}
}
Invoke-DownloadFile -Url 'https://download.example.invalid/redirect' -OutFile (Join-Path $Root 'download')`);
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(result.root, 'followed-http')), false);
});
