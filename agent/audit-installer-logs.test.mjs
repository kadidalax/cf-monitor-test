import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = fileURLToPath(new URL('../', import.meta.url));
const parent = join(repo, '.tmp', 'audit-installer-logs');
const posix = value => value.replaceAll('\\', '/');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const isWindows = process.platform === 'win32';
const shellAvailable = spawnSync('sh', ['-c', ':'], { windowsHide: true }).status === 0;
const bash = isWindows
  ? join(dirname(dirname(spawnSync('where.exe', ['git'], { encoding: 'utf8', windowsHide: true }).stdout.trim().split(/\r?\n/)[0])), 'bin', 'bash.exe')
  : 'bash';
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CF_MONITOR_')));

function fixture(t) {
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(realpathSync(parent), 'case-'));
  t.after(() => {
    const target = realpathSync(root);
    assert.equal(dirname(target), realpathSync(parent));
    assert.ok(target.startsWith(realpathSync(parent) + sep));
    rmSync(target, { recursive: true, force: true });
  });
  return root;
}

function run(command, args, root, env = {}) {
  const result = spawnSync(command, args, { cwd: root, env: { ...cleanEnv(), ...env }, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, 'isolated script/process fixture must complete successfully');
  return result;
}

for (const [file, mode] of [['install.sh', 'user'], ['install.sh', 'openrc'], ['install.sh', 'launchctl'], ['install-linux.sh', 'launchctl']]) {
  test(`AG03 ${file} ${mode} routes Agent diagnostics to a rotatable instance file`, { skip: !shellAvailable }, t => {
    const root = fixture(t);
    const source = readFileSync(join(repo, 'agent', file), 'utf8').replaceAll('\r\n', '\n');
    const definitions = source.split(file === 'install.sh' ? /^while \[ "\$#" -gt 0 \]; do/m : /^while \[\[ \$# -gt 0 \]\]; do/m)[0];
    const install = join(root, "owned 'quoted' instance");
    mkdirSync(join(install, 'state'), { recursive: true });
    const generate = file === 'install.sh'
      ? { user: 'install_user_mode', openrc: 'install_openrc', launchctl: 'install_launchctl' }[mode]
      : source.slice(source.indexOf('reject_env_value() {'));
    const script = `${definitions}
ROOT=${quote(posix(root))}
INSTALL_DIR=${quote(posix(install))}; STATE_DIR="$INSTALL_DIR/state"; RUNNER_FILE="$INSTALL_DIR/run-agent.sh"
BASE_ID=fixture; INSTANCE_ID=fixture; SERVICE_NAME=cf-vps-monitor-fixture; SERVICE_MODE=${quote(mode)}; PLATFORM_OS=darwin
ENV_FILE="$ROOT/fixture.env"; CONFIG_DIR="$ROOT/config"; PID_FILE="$STATE_DIR/agent.pid"; LOG_FILE="$STATE_DIR/agent.log"
UNIT_FILE="$ROOT/generated.service"; INIT_FILE="$ROOT/generated.init"; PLIST_FILE="$ROOT/generated.plist"
DRY_RUN=1; KEEP_FILES=0; AGENT_USER=fixture; WORK_BIN="$ROOT/never-executed"
SERVER=''; TOKEN=''; NODE_NAME=''; MODE=websocket; INTERVAL=3; PING_INTERVAL=120; TRAFFIC_RESET_DAY=1
run() { :; }
ensure_agent_user() { :; }
copy_binary_to() { :; }
agent_assert_instance() { :; }
agent_write_marker() { :; }
agent_load_disk_options() { :; }
agent_stop_disk_collector() { :; }
agent_prepare_disk_collector() { :; }
agent_start_disk_collector() { :; }
write_file() { case "$1" in "$ROOT"/*) mkdir -p "$(dirname "$1")"; printf '%s\\n' "$3" > "$1" ;; *) exit 92 ;; esac; }
${generate}
`;
    writeFileSync(join(root, 'generate.sh'), script);
    const shell = file === 'install.sh' ? 'sh' : bash;
    run(shell, ['-n', posix(join(root, 'generate.sh'))], root);
    run(shell, [posix(join(root, 'generate.sh'))], root);
    if (mode === 'openrc') {
      const invoke = `. ${quote(posix(join(root, 'generated.init')))}
checkpath() { :; }
eerror() { return 1; }
start_pre
printf '%s\\n%s\\n%s\\n' "\${CF_MONITOR_LOG_FILE:-}" "$output_log" "$error_log" > ${quote(posix(join(root, 'observed')))}
`;
      writeFileSync(join(root, 'invoke.sh'), invoke);
      run('sh', ['-n', posix(join(root, 'generated.init'))], root);
      run('sh', [posix(join(root, 'invoke.sh'))], root, { RC_SVCNAME: 'fixture' });
      const [logPath, stdout, stderr] = readFileSync(join(root, 'observed'), 'utf8').trimEnd().split('\n');
      assert.equal(logPath, posix(join(install, 'state', 'agent.log')), 'OpenRC must give the Agent a log directory it owns');
      assert.equal(stdout, '/dev/null', 'OpenRC must not hold an unbounded append stream');
      assert.equal(stderr, '/dev/null', 'Agent error diagnostics must use the bounded writer');
    } else {
      writeFileSync(join(install, 'cf-vps-monitor-agent'), `#!/bin/sh\nprintf '%s' "\${CF_MONITOR_LOG_FILE:-}" > ${quote(posix(join(root, 'received-log-path')))}\n`, { mode: 0o755 });
      run('sh', ['-n', posix(join(install, 'run-agent.sh'))], root);
      run('sh', [posix(join(install, 'run-agent.sh'))], root);
      assert.equal(readFileSync(join(root, 'received-log-path'), 'utf8'), posix(join(install, 'state', 'agent.log')), 'generated runner must configure the bounded Agent writer');
      if (mode === 'launchctl') {
        const plist = readFileSync(join(root, 'generated.plist'), 'utf8');
        for (const key of ['StandardOutPath', 'StandardErrorPath']) {
          const value = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`))?.[1];
          assert.equal(value, '/dev/null', 'launchd must not retain an unbounded duplicate stream');
        }
      }
    }
  });
}

test('AG03 Windows generated runner gives the native Agent a rotatable log file', { skip: !isWindows }, t => {
  const root = fixture(t);
  mkdirSync(join(root, 'state'));
  const source = readFileSync(join(repo, 'agent', 'install-windows.ps1'), 'utf8');
  const assignment = source.match(/^\$runnerContent = @"[\s\S]*?^"@/m)?.[0];
  assert.ok(assignment, 'extract the actual production runner generation expression');
  const setup = `$ErrorActionPreference='Stop'\nfunction ConvertTo-PowerShellLiteral([string]$Value) { "'" + $Value.Replace("'", "''") + "'" }\n$Server=$Token=$Name=$Mode=$MountInclude=$MountExclude=$NicInclude=$NicExclude=''\n$ReportInterval=3; $PingInterval=120; $TrafficResetDay=1\n${assignment}\n[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'run-agent.ps1'),$runnerContent,[Text.UTF8Encoding]::new($true))\n`;
  writeFileSync(join(root, 'generate.ps1'), setup);
  run('pwsh', ['-NoProfile', '-File', join(root, 'generate.ps1')], root);
  run('go', ['build', '-o', join(root, 'cf-vps-monitor-agent.exe'), join(repo, 'agent', 'testdata', 'logging-process.go')], root);
  run('pwsh', ['-NoProfile', '-File', join(root, 'run-agent.ps1')], root, { CF_AUDIT_LOG_ROOT: root });
  assert.ok(existsSync(join(root, 'received-log-path')), 'the actual harmless native process must be reached');
  assert.equal(readFileSync(join(root, 'received-log-path'), 'utf8'), join(root, 'state', 'agent.log'), 'Windows runner must configure the bounded Agent writer');
});

for (const file of ['install.sh', 'install-linux.sh']) {
  test(`AG03 ${file} root collector uses explicit bounded logging without Agent environment`, { skip: !shellAvailable }, t => {
    const root = fixture(t);
    const source = readFileSync(join(repo, 'agent', file), 'utf8').replaceAll('\r\n', '\n');
    const definitions = source.split(file === 'install.sh' ? /^while \[ "\$#" -gt 0 \]; do/m : /^while \[\[ \$# -gt 0 \]\]; do/m)[0];
    const script = `${definitions}
INSTALL_DIR=${quote(posix(root))}; SERVICE_NAME=fixture; DISK_SERVICE_NAME=fixture-disk-usage
MOUNT_INCLUDE=''; MOUNT_EXCLUDE=''; CONTAINER_DISK_TOTAL_BYTES=0
agent_disk_openrc_content > ${quote(posix(join(root, 'collector.init')))}
RC_SVCNAME=fixture-disk-usage
. ${quote(posix(join(root, 'collector.init')))}
eval "set -- $command_args"
log_path=''
while [ "$#" -gt 0 ]; do
  case "$1" in --log-file) log_path="$2"; shift 2 ;; *) shift ;; esac
done
printf '%s\\n%s\\n%s\\n' "$log_path" "$output_log" "$error_log" > ${quote(posix(join(root, 'observed')))}
`;
    writeFileSync(join(root, 'generate.sh'), script);
    const shell = file === 'install.sh' ? 'sh' : bash;
    run(shell, ['-n', posix(join(root, 'generate.sh'))], root);
    run(shell, [posix(join(root, 'generate.sh'))], root);
    const [logPath, stdout, stderr] = readFileSync(join(root, 'observed'), 'utf8').trimEnd().split('\n');
    assert.equal(logPath, '/var/log/fixture-disk-usage.log', 'root collector must receive an explicit root-controlled log file');
    assert.equal(stdout, '/dev/null');
    assert.equal(stderr, '/dev/null');
  });
}
