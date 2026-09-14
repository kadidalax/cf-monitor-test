import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { productionModule } from '../../test/helpers/production-module.mjs';

const subject = productionModule('src/utils/agentInstallCommand.ts');
const parent = fileURLToPath(new URL('../../../.tmp/audit-install-exit-review/', import.meta.url));
const posix = value => value.replaceAll('\\', '/');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const shellAvailable = spawnSync('sh', ['-c', ':'], { windowsHide: true }).status === 0;
const powershellAvailable = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { windowsHide: true }).status === 0;

function run(t, platform, action, failure) {
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(realpathSync(parent), 'case-'));
  for (const child of ['bin', 'temp']) mkdirSync(join(root, child));
  t.after(() => {
    const target = realpathSync(root);
    const expectedParent = realpathSync(parent);
    assert.equal(dirname(target), expectedParent);
    assert.ok(target.startsWith(expectedParent + sep));
    rmSync(target, { recursive: true, force: true });
  });
  const generated = action === 'install'
    ? subject.buildAgentInstallCommand({ platform, serverUrl: 'https://monitor.example.invalid', token: '', options: subject.defaultAgentInstallOptions })
    : subject.buildAgentUninstallAllCommand({ platform });
  // The only downloaded content is an inert marker followed by a failure.
  // Never execute a real installer or contact an external download server.
  let script, program, args;
  if (platform === 'unix') {
    writeFileSync(join(root, 'bin', 'curl'), `#!/bin/sh
out=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    --proto|--proto-redir|--retry|--proxy) shift 2 ;;
    *) shift ;;
  esac
done
[ -n "$out" ] || exit 92
printf 'printf executed > "$CF_AUDIT_MARKER"\\nexit 37\\n' > "$out"
`, { mode: 0o755 });
    script = join(root, 'entry.sh');
    writeFileSync(script, `set -u
FIXTURE_BIN="$(cd ${quote(posix(join(root, 'bin')))} && pwd)"
PATH="$FIXTURE_BIN:$PATH"; export PATH
[ "$(command -v curl)" = "$FIXTURE_BIN/curl" ] || exit 91
${generated}
`);
    program = 'sh';
    args = [posix(script)];
  } else {
    const encoded = generated.match(/-EncodedCommand ([A-Za-z0-9+/=]+)$/)?.[1];
    assert.ok(encoded, 'generated Windows entry must preserve its encoded argument boundary');
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    script = join(root, 'entry.ps1');
    writeFileSync(script, `
function Invoke-WebRequest {
  [CmdletBinding()]
  param([uri]$Uri,[string]$OutFile,[switch]$UseBasicParsing,[switch]$PassThru,[int]$MaximumRedirection,[string]$Proxy)
  $body = '''executed'' | Set-Content -LiteralPath $env:CF_AUDIT_MARKER'
  $body += [Environment]::NewLine + ${failure === 'throw' ? "\"throw 'synthetic execution failure'\"" : "'exit 37'"}
  [IO.File]::WriteAllText($OutFile,$body)
  return [pscustomobject]@{StatusCode=200;Headers=@{}}
}
${decoded}
`);
    program = 'pwsh';
    args = ['-NoProfile', '-File', script];
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CF_MONITOR_')));
  // Unix needs a stable MSYS /tmp mount; native PowerShell uses its own TEMP.
  const result = spawnSync(program, args, {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: { ...env, ...(platform === 'windows' ? { TEMP: join(root, 'temp'), TMP: join(root, 'temp') } : {}), TMPDIR: posix(join(root, 'temp')), CF_AUDIT_MARKER: posix(join(root, 'executed')) },
  });
  // Do not print generated commands, arguments, subprocess output, or environment.
  assert.equal(result.error === undefined, true, 'entry process must finish within the test budget');
  assert.equal(result.signal, null);
  assert.equal(existsSync(join(root, 'executed')), true, 'the downloaded harmless script must actually run');
  assert.equal(result.status, failure === 'throw' ? 1 : 37, 'the entry must propagate execution failure');
  assert.equal(readdirSync(join(root, 'temp')).length, 0, 'failed execution must still remove all temporary downloads');
}

for (const action of ['install', 'uninstall']) {
  test(`review IN01 Unix ${action} propagates script exit 37 and cleans downloads`, { skip: !shellAvailable }, t => run(t, 'unix', action, 'exit'));
  test(`review IN01 Windows ${action} propagates script exit 37 and cleans downloads`, { skip: !powershellAvailable }, t => run(t, 'windows', action, 'exit'));
  test(`review IN01 Windows ${action} reports a thrown script error and cleans downloads`, { skip: !powershellAvailable }, t => run(t, 'windows', action, 'throw'));
}
