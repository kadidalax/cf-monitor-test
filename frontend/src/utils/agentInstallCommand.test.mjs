import assert from 'node:assert/strict';
import test from 'node:test';
import { productionModule } from '../../test/helpers/production-module.mjs';

const { buildAgentInstallCommand, buildAgentUninstallAllCommand, defaultAgentInstallOptions } = productionModule('src/utils/agentInstallCommand.ts');
const { CF_MONITOR_REPOSITORY } = productionModule('src/utils/projectLinks.ts');
const base = {
  serverUrl: 'https://panel.example',
  token: '',
  options: { ...defaultAgentInstallOptions },
  instanceId: '33bc95df-513d-41be-8d98-30979fb17029',
  nodeName: 'node-123',
};

// Parse this fixture's simple quoted arguments as data. Download execution and
// quoting-sensitive strings have separate behavior/PowerShell AST coverage.
function argumentsWithoutCredential(command) {
  const tail = command.split('sh "$d/install.sh" ')[1];
  assert.ok(tail, 'the completed temporary script must be the invoked artifact');
  const args = [...tail.matchAll(/'([^']*)'/g)].map(match => match[1]);
  const credentialIndex = args.indexOf('-t');
  if (credentialIndex >= 0) {
    assert.ok(args[credentialIndex + 1], 'an Agent credential placeholder must be forwarded');
    args.splice(credentialIndex, 2);
  }
  return args;
}

const expectedBase = ['-s', 'https://panel.example', '-n', 'node-123', '-i', '33bc95df-513d-41be-8d98-30979fb17029'];

test('Unix install preserves the repository script, node identity and credential argument', () => {
  const command = buildAgentInstallCommand({ platform: 'unix', ...base });
  assert.ok(command.includes("https://raw.githubusercontent.com/" + CF_MONITOR_REPOSITORY + "/refs/heads/dev/agent/install.sh"));
  assert.deepEqual(argumentsWithoutCredential(command), expectedBase);
});

test('Unix install forwards traffic reset and CONNECT settings', () => {
  const command = buildAgentInstallCommand({ platform: 'unix', ...base,
    options: { ...defaultAgentInstallOptions, trafficResetDay: '15', downloadProxy: '127.0.0.1:10808' } });
  assert.deepEqual(argumentsWithoutCredential(command),
    ['-s', 'https://panel.example', '-r', '15', '-n', 'node-123', '-i', base.instanceId, '--proxy', 'http://127.0.0.1:10808']);
});

test('Unix install keeps explicit user mode', () => {
  const command = buildAgentInstallCommand({ platform: 'unix', ...base,
    options: { ...defaultAgentInstallOptions, installMode: 'user' } });
  assert.deepEqual(argumentsWithoutCredential(command), [...expectedBase, '--install-mode', 'user']);
});

test('Unix full uninstall preserves both explicit confirmation switches', () => {
  assert.deepEqual(argumentsWithoutCredential(buildAgentUninstallAllCommand({ platform: 'unix' })), ['--uninstall-all', '--yes']);
});
