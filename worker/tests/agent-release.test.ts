import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const rootDir = join(import.meta.dirname, '..', '..');
const workflow = readFileSync(join(rootDir, '.github', 'workflows', 'release-agent.yml'), 'utf8');
const linuxInstaller = readFileSync(join(rootDir, 'agent', 'install-linux.sh'), 'utf8');
const windowsInstaller = readFileSync(join(rootDir, 'agent', 'install-windows.ps1'), 'utf8');
const projectLinks = readFileSync(join(rootDir, 'frontend', 'src', 'utils', 'projectLinks.ts'), 'utf8');
const aboutPage = readFileSync(join(rootDir, 'frontend', 'src', 'pages', 'admin', 'About.tsx'), 'utf8');
const agentInstallCommand = readFileSync(join(rootDir, 'frontend', 'src', 'utils', 'agentInstallCommand.ts'), 'utf8');
const displayTheme = readFileSync(join(rootDir, 'frontend', 'src', 'utils', 'displayTheme.ts'), 'utf8');

test('agent release workflow publishes manually versioned GitHub releases with checksums', () => {
  assert.doesNotMatch(workflow, /^\s*push:/m);
  assert.match(workflow, /workflow_dispatch:[\s\S]*inputs:[\s\S]*version:/);
  assert.match(workflow, /AGENT_VERSION: \$\{\{ inputs\.version \}\}/);
  assert.match(workflow, /agent_version="\$\{AGENT_VERSION\}"/);
  assert.doesNotMatch(workflow, /AGENT_VERSION_TAG_PREFIX|agent-\$\{agent_version\}/);
  assert.match(workflow, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+/);
  assert.match(workflow, /AGENT_VERSION_TAG=\$\{agent_version\}/);
  assert.match(workflow, /\(cd dist && sha256sum \* > SHA256SUMS\)/);
  assert.match(workflow, /attestations: write/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /uses: actions\/attest-build-provenance@v2/);
  assert.match(workflow, /subject-path: agent\/dist\/\*/);
  assert.match(workflow, /git ls-remote --exit-code --tags origin "refs\/tags\/\$\{AGENT_VERSION_TAG\}"/);
  assert.match(workflow, /git push origin "refs\/tags\/\$\{AGENT_VERSION_TAG\}"/);
  assert.match(workflow, /gh release create "\$AGENT_VERSION_TAG"[\s\S]*--repo "\$GITHUB_REPOSITORY"/);
  assert.match(workflow, /gh release upload "\$AGENT_VERSION_TAG" dist\/\* --clobber --repo "\$GITHUB_REPOSITORY"/);
  assert.match(workflow, /gh release view "\$AGENT_VERSION_TAG" --repo "\$GITHUB_REPOSITORY"/);
  assert.match(workflow, /CF VPS Monitor Agent \$\{AGENT_VERSION\}/);
  assert.match(workflow, /Immutable release for \$\{GITHUB_REPOSITORY\}@\$\{GITHUB_SHA\}/);
  assert.match(workflow, /Artifacts include GitHub artifact attestations/);
  assert.doesNotMatch(workflow, /agent-latest|AGENT_RELEASE_TAG|Publish installable agent release|CF VPS Monitor Agent Latest/);
});

test('agent installers can pin release tags and verify release checksums', () => {
  assert.doesNotMatch(linuxInstaller, /\r\n/);
  assert.match(linuxInstaller, /--release-tag TAG/);
  assert.match(linuxInstaller, /CF_MONITOR_RELEASE_BASE="https:\/\/github\.com\/\$\{CF_MONITOR_REPOSITORY\}\/releases\/latest\/download"/);
  assert.doesNotMatch(linuxInstaller, /agent-latest/);
  assert.doesNotMatch(linuxInstaller, /default_worker_asset_base/);
  assert.match(linuxInstaller, /\^\[A-Za-z0-9\._-\]\{1,128\}\$/);
  assert.match(linuxInstaller, /cannot start with dash/);
  assert.match(linuxInstaller, /default_checksum_url\(\)/);
  assert.match(linuxInstaller, /verify_binary_checksum/);
  assert.match(linuxInstaller, /sub\(\s*\/\^\.\*\\\//);
  assert.match(linuxInstaller, /normalize_proxy_url\(\)/);
  assert.match(linuxInstaller, /without credentials, query, or fragment/);
  assert.match(linuxInstaller, /PROXY="\$\(normalize_proxy_url "--proxy" "\$PROXY"\)"/);
  assert.match(linuxInstaller, /INSTALL_GHPROXY="\$\(normalize_proxy_url "--install-ghproxy" "\$INSTALL_GHPROXY"\)"/);

  assert.match(windowsInstaller, /\[string\]\$ReleaseTag = ""/);
  assert.match(windowsInstaller, /releases\/latest\/download/);
  assert.doesNotMatch(windowsInstaller, /agent-latest/);
  assert.doesNotMatch(windowsInstaller, /Get-WorkerAssetBase/);
  assert.match(windowsInstaller, /\^\[A-Za-z0-9\._-\]\{1,128\}\$/);
  assert.match(windowsInstaller, /cannot start with dash/);
  assert.match(windowsInstaller, /Get-DefaultChecksumUrl/);
  assert.match(windowsInstaller, /Test-DownloadedChecksum/);
  assert.match(windowsInstaller, /Split-Path -Leaf \$parts\[-1\]\.TrimStart\("\*"\)/);
  assert.match(windowsInstaller, /function Normalize-HttpUrl/);
  assert.match(windowsInstaller, /without credentials, query, or fragment/);
  assert.match(windowsInstaller, /\$Proxy = Normalize-HttpUrl -Name "-Proxy" -Url \$Proxy -AllowPath \$false/);
  assert.match(windowsInstaller, /\$InstallGhproxy = Normalize-HttpUrl -Name "-InstallGhproxy" -Url \$InstallGhproxy/);
});

test('linux installer rejects EnvironmentFile newline injection', () => {
  assert.match(linuxInstaller, /reject_env_value\(\)/);
  assert.match(linuxInstaller, /\*\$'\\n'\*\|\*\$'\\r'\*/);
  assert.match(linuxInstaller, /reject_env_value "server" "\$SERVER"/);
  assert.match(linuxInstaller, /reject_env_value "token" "\$TOKEN"/);
  assert.match(linuxInstaller, /reject_env_value "name" "\$NODE_NAME"/);
  assert.match(linuxInstaller, /reject_env_value "mount-include" "\$MOUNT_INCLUDE"/);
});

test('agent installers persist monthly traffic state in service-writable paths', () => {
  assert.match(linuxInstaller, /STATE_DIR="\$\{INSTALL_DIR\}\/state"/);
  assert.match(linuxInstaller, /CF_MONITOR_TRAFFIC_STATE_FILE=\$\{STATE_DIR\}\/traffic-state\.json/);
  assert.match(linuxInstaller, /WorkingDirectory=\$\{INSTALL_DIR\}/);
  assert.match(linuxInstaller, /ReadWritePaths=\$\{STATE_DIR\}/);

  assert.match(windowsInstaller, /\$StateDir = Join-Path \$InstallDir "state"/);
  assert.match(windowsInstaller, /`?\$env:CF_MONITOR_TRAFFIC_STATE_FILE = Join-Path `?\$PSScriptRoot "state\\traffic-state\.json"/);
  assert.match(windowsInstaller, /icacls \$StateDir[\s\S]*\*S-1-5-19:\(OI\)\(CI\)M/);
});

test('project links use the temporary GitHub repository and no Komari-facing names remain', () => {
  assert.match(projectLinks, /kadidalax\/cf-monitor-test/);
  assert.match(linuxInstaller, /kadidalax\/cf-monitor-test/);
  assert.match(windowsInstaller, /kadidalax\/cf-monitor-test/);
  assert.doesNotMatch(`${projectLinks}\n${aboutPage}\n${agentInstallCommand}\n${displayTheme}\n${linuxInstaller}\n${windowsInstaller}`, /komari/i);
});
