import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(join(import.meta.dirname, '..', 'src', 'utils', 'agentInstallCommand.ts'), 'utf8');
const dashboardSource = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'admin', 'Dashboard.tsx'), 'utf8');
const adminLayoutSource = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'admin', 'AdminLayout.tsx'), 'utf8');
const aboutSource = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'admin', 'About.tsx'), 'utf8');
const loginSource = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'Login.tsx'), 'utf8');
const notFoundSource = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'NotFound.tsx'), 'utf8');
const detailsGridSource = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'DetailsGrid.tsx'), 'utf8');
const deploySource = readFileSync(join(import.meta.dirname, '..', '..', 'scripts', 'deploy-cloudflare.mjs'), 'utf8');
const workerIndexSource = readFileSync(join(import.meta.dirname, '..', '..', 'worker', 'src', 'index.ts'), 'utf8');
const linuxInstallerSource = readFileSync(join(import.meta.dirname, '..', '..', 'agent', 'install-linux.sh'), 'utf8');
const windowsInstallerSource = readFileSync(join(import.meta.dirname, '..', '..', 'agent', 'install-windows.ps1'), 'utf8');

test('default agent install commands use GitHub main scripts and release binaries', () => {
  assert.match(source, /CF_MONITOR_AGENT_SCRIPT_BASE = `https:\/\/raw\.githubusercontent\.com\/\$\{CF_MONITOR_REPOSITORY\}\/\$\{CF_MONITOR_AGENT_SCRIPT_REF\}\/agent`/);
  assert.match(source, /CF_MONITOR_RELEASE_BASE = `https:\/\/github\.com\/\$\{CF_MONITOR_REPOSITORY\}\/releases\/latest\/download`/);
  assert.match(source, /cfMonitorAgentScriptUrl\('install-linux\.sh', ghproxy, releaseTag, scriptRef\)/);
  assert.match(source, /cfMonitorAgentScriptUrl\('install-windows\.ps1', ghproxy, releaseTag, scriptRef\)/);
  assert.doesNotMatch(source, /workerAgentScriptUrl|workerAgentAssetBase|useWorkerAgentAssets/);
  assert.doesNotMatch(linuxInstallerSource, /default_worker_asset_base/);
  assert.doesNotMatch(windowsInstallerSource, /Get-WorkerAssetBase/);
});

test('default install command uses short flags and omits default traffic day', () => {
  assert.match(source, /const args = \['-s', serverUrl, '-t', token \|\| '<TOKEN>'\]/);
  assert.match(source, /if \(trafficResetDay !== '1'\) args\.push\('-r', trafficResetDay\)/);
  assert.doesNotMatch(source, /'--traffic-reset-day', trafficResetDay/);
  assert.match(linuxInstallerSource, /PING_INTERVAL="120"/);
  assert.match(linuxInstallerSource, /--ping-interval SECONDS   Ping task poll interval, default: 120\./);
  assert.match(windowsInstallerSource, /\[int\]\$PingInterval = 120/);
  assert.match(linuxInstallerSource, /-s\|--server\) SERVER=/);
  assert.match(linuxInstallerSource, /-t\|--token\) TOKEN=/);
  assert.match(linuxInstallerSource, /-n\|--name\) NODE_NAME=/);
  assert.match(linuxInstallerSource, /-i\|--instance-id\) INSTANCE_ID=/);
});

test('windows installer keeps -i reserved for instance ids', () => {
  assert.doesNotMatch(source, /args\.map\(psQuote\)\.join\(' '\)/);
  assert.match(source, /args\.map\(\(arg, index\) => index % 2 === 0 \? arg : psQuote\(arg\)\)\.join\(' '\)/);
  assert.match(windowsInstallerSource, /\[Alias\("Interval"\)\]\s*\[int\]\$ReportInterval = 3/);
  assert.doesNotMatch(windowsInstallerSource, /\[int\]\$Interval =/);
  assert.match(windowsInstallerSource, /--interval \$ReportInterval --ping-interval \$PingInterval/);
});

test('windows installer runs the console agent through Task Scheduler instead of a fake service', () => {
  assert.doesNotMatch(windowsInstallerSource, /New-Service|Start-Service/);
  assert.match(windowsInstallerSource, /Register-ScheduledTask/);
  assert.match(windowsInstallerSource, /Start-ScheduledTask/);
  assert.match(windowsInstallerSource, /Unregister-ScheduledTask/);
});

test('macOS installer uses launchd instead of systemd', () => {
  assert.match(linuxInstallerSource, /PLATFORM_OS="\$\(uname -s \| tr '\[:upper:\]' '\[:lower:\]'\)"/);
  assert.match(linuxInstallerSource, /is_macos\(\)/);
  assert.match(linuxInstallerSource, /\/Library\/LaunchDaemons\/\$\{SERVICE_NAME\}\.plist/);
  assert.match(linuxInstallerSource, /launchctl bootstrap system "\$PLIST_FILE"/);
  assert.match(linuxInstallerSource, /if \[\[ "\$DRY_RUN" != "1" && "\$\(id -u\)" -ne 0 \]\]/);
});

test('agent installers can download architecture-specific binaries from an explicit asset base', () => {
  assert.match(linuxInstallerSource, /--binary-base-url URL/);
  assert.match(linuxInstallerSource, /BINARY_BASE_URL=/);
  assert.match(linuxInstallerSource, /--binary-base-url\) BINARY_BASE_URL=/);
  assert.match(linuxInstallerSource, /local base="\$\{BINARY_BASE_URL:-\$CF_MONITOR_RELEASE_BASE\}"/);
  assert.match(linuxInstallerSource, /if \[\[ -n "\$BINARY_BASE_URL" \]\]/);
  assert.match(windowsInstallerSource, /\[string\]\$BinaryBaseUrl = ""/);
  assert.match(windowsInstallerSource, /function Get-AgentAssetBase/);
  assert.match(windowsInstallerSource, /\$url = "\$base\/cf-vps-monitor-agent-windows-amd64\.exe"/);
  assert.match(windowsInstallerSource, /\$url = "\$\(Get-AgentAssetBase\)\/SHA256SUMS"/);
});

test('agent installers default to the latest GitHub release when worker assets are unavailable', () => {
  assert.match(source, /CF_MONITOR_RELEASE_BASE = `https:\/\/github\.com\/\$\{CF_MONITOR_REPOSITORY\}\/releases\/latest\/download`/);
  assert.match(linuxInstallerSource, /CF_MONITOR_RELEASE_BASE="https:\/\/github\.com\/\$\{CF_MONITOR_REPOSITORY\}\/releases\/latest\/download"/);
  assert.match(windowsInstallerSource, /releases\/latest\/download/);
  assert.doesNotMatch(`${source}\n${dashboardSource}\n${linuxInstallerSource}\n${windowsInstallerSource}`, /agent-latest/);
  assert.match(dashboardSource, /placeholder="为空则使用最新发布版"/);
});

test('Worker version endpoint uses the bundled deployment version and deploy does not bundle local agent assets', () => {
  assert.doesNotMatch(deploySource, /function buildAgentAssets\(\)/);
  assert.doesNotMatch(deploySource, /APP_VERSION|SOURCE_REVISION|tag_name/);
  assert.doesNotMatch(workerIndexSource, /https:\/\/api\.github\.com\/repos\/\$\{CF_MONITOR_REPOSITORY\}\/releases\/latest|tag_name|latestGithubVersion/);
  assert.match(workerIndexSource, /workerPackage/);
  assert.match(workerIndexSource, /BUNDLED_VERSION/);
  assert.doesNotMatch(deploySource, /\['describe', '--tags', '--match', 'v\[0-9\]\*', '--abbrev=0'\]/);
  assert.doesNotMatch(deploySource, /-X main\.Version=\$\{appVersion\(\)\}/);
  assert.doesNotMatch(deploySource, /cf-vps-monitor-agent-linux-amd64/);
  assert.doesNotMatch(deploySource, /buildAgentAssets\(\);/);
});

test('frontend version labels come from the Worker version endpoint', () => {
  const versionUiSources = `${adminLayoutSource}\n${aboutSource}\n${loginSource}\n${notFoundSource}`;
  assert.doesNotMatch(versionUiSources, /v2\.0\.0/);
  assert.match(versionUiSources, /formatAppVersion/);
  assert.match(adminLayoutSource, /fetch\("\/api\/version"\)/);
  assert.match(loginSource, /fetch\('\/api\/version'\)/);
  assert.doesNotMatch(detailsGridSource, /fetch\('\/api\/version'\)/);
  assert.match(detailsGridSource, /value:\s*client\.version \|\| '-'/);
});

test('custom agent binary install commands support checksum verification URL', () => {
  assert.match(source, /checksumUrl\?: string/);
  assert.match(source, /checksumUrl: ''/);
  assert.match(source, /function httpsDownloadUrl\(value\?: string \| null\)/);
  assert.match(source, /url\.protocol === 'https:' && !url\.username && !url\.password && url\.hostname/);
  assert.match(source, /function customAgentDownloadUrls\(binaryValue\?: string \| null, checksumValue\?: string \| null\)/);
  assert.match(source, /return binaryUrl && checksumUrl \? \{ binaryUrl, checksumUrl \} : \{ binaryUrl: '', checksumUrl: '' \}/);
  assert.match(source, /const \{ binaryUrl, checksumUrl \} = customAgentDownloadUrls\(options\.binaryUrl, options\.checksumUrl\)/);
  assert.doesNotMatch(source, /const binaryUrl = options\.binaryUrl\?\.trim\(\)/);
  assert.doesNotMatch(source, /const checksumUrl = options\.checksumUrl\?\.trim\(\)/);
  assert.match(source, /args\.push\('--checksum-url', checksumUrl\)/);
  assert.match(source, /args\.push\('-ChecksumUrl', checksumUrl\)/);
  assert.match(dashboardSource, /label="SHA256SUMS 地址"/);
  assert.match(dashboardSource, /setOption\('checksumUrl', v\)/);
  assert.match(dashboardSource, /apiFetch\('\/admin\/clients\/' \+ client\.uuid \+ '\/token\/install'/);
  assert.match(dashboardSource, /method: 'POST'/);
  assert.match(dashboardSource, /token: agentToken/);
});

test('agent install commands can pin immutable release tags', () => {
  assert.match(source, /releaseTag\?: string/);
  assert.match(source, /releaseTag: ''/);
  assert.match(source, /scriptRef\?: string/);
  assert.match(source, /scriptRef: ''/);
  assert.doesNotMatch(source, /CF_MONITOR_AGENT_RELEASE_TAG_PREFIX/);
  assert.match(source, /CF_MONITOR_AGENT_SCRIPT_REF = `refs\/heads\/\$\{CF_MONITOR_BRANCH\}`/);
  assert.doesNotMatch(source, /cfMonitorAgentReleaseTagFromRevision/);
  assert.match(source, /cfMonitorAgentScriptRefFromRevision/);
  assert.match(source, /function normalizeScriptRef\(scriptRef\?: string \| null\)/);
  assert.match(source, /function normalizeReleaseTag\(value\?: string \| null\)/);
  assert.match(source, /\^v\\d\+\\\.\\d\+\\\.\\d\+/);
  assert.doesNotMatch(source, /!raw\.startsWith\('-'\)/);
  assert.match(source, /const releaseTag = normalizeReleaseTag\(options\.releaseTag\)/);
  assert.doesNotMatch(source, /const releaseTag = options\.releaseTag\?\.trim\(\)/);
  assert.match(source, /const scriptRef = options\.scriptRef\?\.trim\(\)/);
  assert.match(source, /normalizeScriptRef\(scriptRef\)/);
  assert.match(source, /if \(releaseTag && !binaryUrl\) args\.push\('--release-tag', releaseTag\)/);
  assert.match(source, /if \(releaseTag && !binaryUrl\) args\.push\('-ReleaseTag', releaseTag\)/);
  assert.match(linuxInstallerSource, /--release-tag TAG[\s\S]*default: latest published release/);
  assert.match(windowsInstallerSource, /\[string\]\$ReleaseTag = ""/);
  assert.doesNotMatch(dashboardSource, /fetch\('\/api\/version'\)/);
  assert.doesNotMatch(dashboardSource, /cfMonitorAgentReleaseTagFromRevision\(releaseRevision\)/);
  assert.doesNotMatch(dashboardSource, /cfMonitorAgentScriptRefFromRevision\(version\.source_revision\)/);
  assert.doesNotMatch(dashboardSource, /scriptRef: prev\.scriptRef \|\| scriptRef/);
  assert.doesNotMatch(dashboardSource, /当前部署缺少 SOURCE_REVISION/);
  assert.doesNotMatch(dashboardSource, /const commandPinned = Boolean\(installOptions\.scriptRef\)/);
  assert.match(dashboardSource, /buildAgentInstallCommand\(\{/);
  assert.match(dashboardSource, /disabled=\{loadingToken \|\| !agentToken\}/);
  assert.match(dashboardSource, /label="Release Tag"/);
  assert.match(dashboardSource, /setOption\('releaseTag', v\)/);
});

test('agent install server URLs normalize to safe HTTP origins', () => {
  assert.match(source, /function serverUrlOrigin\(value: string\)/);
  assert.match(source, /function isLocalHttpHost\(hostname: string\)/);
  assert.match(source, /new URL\(withScheme\)/);
  assert.match(source, /url\.protocol === 'https:' \|\| \(url\.protocol === 'http:' && isLocalHttpHost\(url\.hostname\)\)/);
  assert.match(source, /!url\.username && !url\.password && url\.hostname/);
  assert.match(source, /return url\.origin/);
  assert.match(source, /serverUrlOrigin\(value\) \|\| serverUrlOrigin\(fallback\) \|\| 'https:\/\/localhost'/);
});

test('agent install proxy URLs reject credentials and URL suffixes', () => {
  assert.match(source, /export function normalizeProxyUrl\(value: string, allowPath = true\)/);
  assert.match(source, /new URL\(withScheme\)/);
  assert.match(source, /!url\.username && !url\.password && url\.hostname && !url\.search && !url\.hash/);
  assert.match(source, /const path = allowPath && url\.pathname !== '\/' \? url\.pathname\.replace/);
  assert.match(source, /const downloadProxy = normalizeProxyUrl\(options\.downloadProxy, false\)/);
});

test('agent install dialog uses create rotate and on-demand install tokens', () => {
  assert.match(dashboardSource, /type CommandClient = Partial<AdminClient> & Pick<AdminClient, 'uuid' \| 'name'> & \{ token\?: string \}/);
  assert.match(dashboardSource, /function GenerateCommandDialog\(\{ client, open, onOpenChange \}: \{ client: CommandClient/);
  assert.match(dashboardSource, /setAgentToken\(client\.token \|\| ''\)/);
  assert.match(dashboardSource, /if \(client\.token\) \{/);
  assert.match(dashboardSource, /\/token\/install'/);
  assert.doesNotMatch(dashboardSource, /重置 Token 后再复制安装命令/);
  assert.match(dashboardSource, /onSaved\(created\)/);
  assert.match(dashboardSource, /onRotated\(typeof result\.token === 'string' \? result\.token : undefined\)/);
  assert.match(dashboardSource, /setCmdClient\(\{ uuid: rotateTokenClient\.uuid, name: rotateTokenClient\.name, token \}\)/);
});

test('agent instance ids do not fall back to secret tokens', () => {
  assert.match(source, /function normalizeInstanceId\(value\?: string\)/);
  assert.match(source, /const effectiveInstanceId = normalizeInstanceId\(instanceId \|\| nodeName\)/);
  assert.doesNotMatch(source, /instanceId\?\.trim\(\) \|\| token/);
  assert.match(dashboardSource, /token\/install'/);
  assert.doesNotMatch(dashboardSource, /withCurrentPassword/);
  assert.match(dashboardSource, /\/token\/rotate'[\s\S]{0,220}body: JSON\.stringify\(\{\}\)/);
  assert.doesNotMatch(dashboardSource, /\/token\/install'[\s\S]{0,220}withCurrentPassword/);
});

test('admin node details show token hygiene timestamps without exposing stored token material', () => {
  assert.match(dashboardSource, /token_last_used_at\?: string \| null/);
  assert.match(dashboardSource, /token_last_used_ip\?: string/);
  assert.match(dashboardSource, /token_rotated_at\?: string \| null/);
  assert.match(dashboardSource, /\['Token 最近使用', formatDetailTime\(client\.token_last_used_at\)\]/);
  assert.match(dashboardSource, /\['Token 最近使用 IP', client\.token_last_used_ip \|\| '-'\]/);
  assert.match(dashboardSource, /\['Token 轮换时间', formatDetailTime\(client\.token_rotated_at\)\]/);
  assert.doesNotMatch(dashboardSource, /\['Token', client\.token/);
  assert.doesNotMatch(dashboardSource, /token_hash\?:/);
});
