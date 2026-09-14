[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This creates real scheduled tasks. Local test suites only exercise this guard;
# the lifecycle runs on a disposable GitHub-hosted Windows machine.
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $IsWindows -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'The native installer check only runs on a GitHub-hosted Windows runner.'
}
if (-not $env:RUNNER_TEMP -or -not $env:GITHUB_WORKSPACE) { throw 'CI workspace paths are required.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'The native installer check requires the hosted runner administrator.'
}

$ciWorkspace = [IO.Path]::GetFullPath($env:GITHUB_WORKSPACE)
$ciTempParent = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
$ciLeaf = 'cf-monitor-native-' + [guid]::NewGuid().ToString('N')
$ciBuildRoot = [IO.Path]::GetFullPath((Join-Path $ciTempParent $ciLeaf))
$ciInstance = 'ci-' + [guid]::NewGuid().ToString('N')
$ciTask = 'CFVpsMonitorAgent-' + $ciInstance
$ciInstallRoot = Join-Path (Join-Path $env:ProgramFiles 'CF VPS Monitor') $ciInstance
$ciInstaller = Join-Path $ciWorkspace 'agent/install-windows.ps1'
$ciPwsh = (Get-Command pwsh -ErrorAction Stop).Source
if (-not $ciBuildRoot.StartsWith($ciTempParent + '\', [StringComparison]::OrdinalIgnoreCase) -or
  (Test-Path -LiteralPath $ciBuildRoot) -or (Test-Path -LiteralPath $ciInstallRoot) -or
  @(Get-ScheduledTask -TaskName $ciTask -ErrorAction SilentlyContinue).Count -ne 0) {
  throw 'Native installer fixture resources must be new and isolated.'
}

function Invoke-NativeInstaller {
  param([string]$Binary, [switch]$Remove)
  $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $ciInstaller,
    '-InstanceId', $ciInstance, '-ServiceName', $ciTask, '-Yes')
  if ($Remove) { $arguments += '-Uninstall' }
  else {
    # Deliberately synthetic credentials and loopback transport; no production
    # account, network endpoint or secret is needed by this platform check.
    $arguments += @('-BinaryPath', $Binary, '-Server', 'http://127.0.0.1:9',
      '-Token', 'synthetic-ci-only', '-Name', 'Synthetic CI node', '-DisableAutoUpdate', '-DisableWebSsh')
  }
  & $ciPwsh @arguments
  if ($LASTEXITCODE -ne 0) { throw "Native installer failed with exit code $LASTEXITCODE." }
}

function Wait-NativeAgent {
  param([string]$Version, [string]$Binary)
  $executable = Join-Path $ciInstallRoot 'cf-vps-monitor-agent.exe'
  $logPath = Join-Path $ciInstallRoot 'state/agent.log'
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  do {
    $task = Get-ScheduledTask -TaskName $ciTask -ErrorAction SilentlyContinue
    $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'cf-vps-monitor-agent.exe'" | Where-Object {
      [string]::Equals($_.ExecutablePath, $executable, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($task -and $task.State -eq 'Running' -and $processes.Count -eq 1 -and (Test-Path -LiteralPath $logPath)) {
      $content = Get-Content -LiteralPath $logPath -Raw -Encoding utf8
      if ($content -match [regex]::Escape("CF VPS Monitor Agent $Version")) {
        if ((Get-FileHash -LiteralPath $Binary).Hash -ne (Get-FileHash -LiteralPath $executable).Hash) {
          throw 'The running installation does not contain the built version.'
        }
        if ($task.Principal.UserId -notin @('S-1-5-19', 'LOCAL SERVICE', 'NT AUTHORITY\LOCAL SERVICE')) {
          throw 'The Agent task must run as LocalService.'
        }
        return
      }
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'The native Agent did not reach the expected version and running task state.'
}

New-Item -ItemType Directory -Path $ciBuildRoot | Out-Null
try {
  $binaries = @{}
  Push-Location (Join-Path $ciWorkspace 'agent')
  try {
    foreach ($version in @('v0.0.0-ci-old', 'v0.0.0-ci-new')) {
      $binary = Join-Path $ciBuildRoot "$version.exe"
      & go build -trimpath -ldflags "-s -w -X main.Version=$version" -o $binary .
      if ($LASTEXITCODE -ne 0) { throw 'Native Agent compilation failed.' }
      $binaries[$version] = $binary
    }
  } finally { Pop-Location }

  Invoke-NativeInstaller -Binary $binaries['v0.0.0-ci-old']
  Wait-NativeAgent -Version 'v0.0.0-ci-old' -Binary $binaries['v0.0.0-ci-old']
  $stateSentinel = Join-Path $ciInstallRoot 'state/ci-preserved.txt'
  Set-Content -LiteralPath $stateSentinel -Value 'preserve existing state' -Encoding utf8

  Invoke-NativeInstaller -Binary $binaries['v0.0.0-ci-new']
  Wait-NativeAgent -Version 'v0.0.0-ci-new' -Binary $binaries['v0.0.0-ci-new']
  if ((Get-Content -LiteralPath $stateSentinel -Raw -Encoding utf8).Trim() -ne 'preserve existing state') {
    throw 'Upgrade did not preserve existing state.'
  }
  Invoke-NativeInstaller -Remove
  if ((Test-Path -LiteralPath $ciInstallRoot) -or
    @(Get-ScheduledTask -TaskName $ciTask -ErrorAction SilentlyContinue).Count -ne 0 -or
    @(Get-CimInstance Win32_Process -Filter "Name = 'cf-vps-monitor-agent.exe'" | Where-Object {
      [string]::Equals($_.ExecutablePath, (Join-Path $ciInstallRoot 'cf-vps-monitor-agent.exe'), [StringComparison]::OrdinalIgnoreCase)
    }).Count -ne 0) {
    throw 'Uninstall left an owned directory, task or Agent process behind.'
  }
  Write-Host 'Native Windows install, upgrade, state preservation and uninstall passed.'
} finally {
  if (Test-Path -LiteralPath (Join-Path $ciInstallRoot '.cf-vps-monitor-instance.json')) {
    Invoke-NativeInstaller -Remove
  }
  if (Test-Path -LiteralPath $ciBuildRoot) {
    $resolvedRoot = Get-Item -LiteralPath $ciBuildRoot -Force
    if ($resolvedRoot.FullName -ne $ciBuildRoot -or $resolvedRoot.Name -ne $ciLeaf -or
      -not $resolvedRoot.FullName.StartsWith($ciTempParent + '\', [StringComparison]::OrdinalIgnoreCase) -or
      ($resolvedRoot.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw 'Native fixture cleanup path changed; refusing recursive removal.'
    }
    Remove-Item -LiteralPath $ciBuildRoot -Recurse -Force
  }
}
