[CmdletBinding()]
param(
  [Alias("s")]
  [string]$Server,

  [Alias("t")]
  [string]$Token,

  [Alias("n")]
  [string]$Name = $env:COMPUTERNAME,
  [int]$Interval = 3,
  [int]$PingInterval = 60,
  [Alias("r")]
  [ValidateRange(1, 31)]
  [int]$TrafficResetDay = 1,
  [ValidateSet("websocket", "http")]
  [string]$Mode = "websocket",
  [Alias("i")]
  [string]$InstanceId = "",
  [string]$InstallDir = "",
  [string]$ServiceName = "",
  [string]$SourceUrl = "",
  [switch]$BuildFromSource,
  [string]$BinaryPath = "",
  [string]$BinaryUrl = "",
  [string]$BinaryBaseUrl = "",
  [string]$ChecksumUrl = "",
  [string]$ReleaseTag = "",
  [string]$Proxy = "",
  [string]$MountInclude = "",
  [string]$MountExclude = "",
  [string]$NicInclude = "",
  [string]$NicExclude = "",
  [switch]$DisableWebSsh,
  [switch]$DisableAutoUpdate,
  [switch]$IgnoreUnsafeCert,
  [string]$InstallGhproxy = "",
  [switch]$DryRun,
  [switch]$Uninstall,
  [switch]$UninstallAll,
  [switch]$Yes,
  [switch]$KeepFiles
)

$ErrorActionPreference = "Stop"

function Test-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Description,
    [scriptblock]$Action
  )

  if ($DryRun) {
    Write-Host "[dry-run] $Description"
    return
  }

  & $Action
}

if (-not $DryRun -and -not (Test-Admin)) {
  throw "Please run this script from an elevated PowerShell session."
}

function ConvertTo-InstanceId {
  param([string]$Value)
  $candidate = if ([string]::IsNullOrWhiteSpace($Value)) { "default" } else { $Value }
  $cleaned = ($candidate.ToLowerInvariant() -replace '[^a-z0-9_.-]+', '-') -replace '^-+', '' -replace '-+$', ''
  if ([string]::IsNullOrWhiteSpace($cleaned)) {
    $cleaned = "default"
  }
  if ($cleaned.Length -gt 48) {
    return $cleaned.Substring(0, 48)
  }
  return $cleaned
}

function Set-InstanceDefaults {
  $base = ConvertTo-InstanceId $InstanceId
  if ([string]::IsNullOrWhiteSpace($script:ServiceName)) {
    $script:ServiceName = "CFVpsMonitorAgent-$base"
  }
  if ([string]::IsNullOrWhiteSpace($script:InstallDir)) {
    $script:InstallDir = Join-Path "$env:ProgramFiles\CF VPS Monitor" $base
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repository = "kadidalax/cf-monitor-test"
$branch = "main"
$autoBinaryUrl = $false

function Resolve-ReleaseBase {
  if ([string]::IsNullOrWhiteSpace($ReleaseTag)) {
    return "https://github.com/$repository/releases/latest/download"
  }
  if ($ReleaseTag.StartsWith("-") -or $ReleaseTag -notmatch "^[A-Za-z0-9._-]{1,128}$") {
    throw "-ReleaseTag must contain only A-Z, a-z, 0-9, dot, underscore, or dash, and cannot start with dash."
  }
  return "https://github.com/$repository/releases/download/$ReleaseTag"
}

$releaseBase = Resolve-ReleaseBase

function ConvertTo-PowerShellLiteral {
  param([string]$Value)
  return "'" + ($Value -replace "'", "''") + "'"
}

function Join-GitHubProxy {
  param([string]$Url)
  if ([string]::IsNullOrWhiteSpace($InstallGhproxy)) {
    return $Url
  }
  return $InstallGhproxy.TrimEnd("/") + "/" + $Url
}

function Assert-HttpsUrl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [string]$Url
  )
  if (-not [string]::IsNullOrWhiteSpace($Url) -and -not $Url.StartsWith("https://", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "$Name must use an https:// URL."
  }
}

function Normalize-HttpUrl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [string]$Url,
    [bool]$AllowPath = $true
  )
  if ([string]::IsNullOrWhiteSpace($Url)) {
    return ""
  }
  try {
    $uri = [Uri]$Url
  } catch {
    throw "$Name must be a valid http:// or https:// URL."
  }
  if (-not $uri.IsAbsoluteUri -or ($uri.Scheme -ne "http" -and $uri.Scheme -ne "https") -or
      -not [string]::IsNullOrWhiteSpace($uri.UserInfo) -or
      -not [string]::IsNullOrWhiteSpace($uri.Query) -or
      -not [string]::IsNullOrWhiteSpace($uri.Fragment) -or
      [string]::IsNullOrWhiteSpace($uri.Host)) {
    throw "$Name must use an http:// or https:// URL without credentials, query, or fragment."
  }
  $path = if ($AllowPath -and $uri.AbsolutePath -ne "/") { $uri.AbsolutePath.TrimEnd("/") } else { "" }
  return "$($uri.Scheme)://$($uri.Authority)$path"
}

function Invoke-DownloadFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url,
    [Parameter(Mandatory = $true)]
    [string]$OutFile
  )

  if ($DryRun) {
    $proxyText = if ([string]::IsNullOrWhiteSpace($Proxy)) { "" } else { " -Proxy `"$Proxy`"" }
    Write-Host "[dry-run] Invoke-WebRequest $Url$proxyText -OutFile `"$OutFile`""
    return
  }

  $downloadParams = @{
    Uri = $Url
    UseBasicParsing = $true
    OutFile = $OutFile
  }
  if (-not [string]::IsNullOrWhiteSpace($Proxy)) {
    $downloadParams.Proxy = $Proxy
  }
  Invoke-WebRequest @downloadParams
}

function Resolve-BuildDirectory {
  $localMain = Join-Path $scriptDir "main.go"
  if (Test-Path -LiteralPath $localMain) {
    return $scriptDir
  }

  $archiveUrl = if ([string]::IsNullOrWhiteSpace($SourceUrl)) {
    "https://github.com/$repository/archive/refs/heads/$branch.zip"
  } else {
    $SourceUrl
  }
  $archiveUrl = Join-GitHubProxy $archiveUrl
  $archivePath = Join-Path $env:TEMP "cf-vps-monitor-source.zip"
  $extractDir = Join-Path $env:TEMP ("cf-vps-monitor-source-" + [Guid]::NewGuid().ToString("N"))

  Invoke-DownloadFile -Url $archiveUrl -OutFile $archivePath

  if ($DryRun) {
    Write-Host "[dry-run] Expand-Archive -LiteralPath `"$archivePath`" -DestinationPath `"$extractDir`""
    return (Join-Path $extractDir "cf-vps-monitor-main\agent")
  }

  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDir -Force
  $mainGo = Get-ChildItem -LiteralPath $extractDir -Recurse -Filter main.go |
    Where-Object { $_.FullName -match "\\agent\\main\.go$" } |
    Select-Object -First 1
  if (-not $mainGo) {
    throw "Cannot find agent/main.go in source archive: $archiveUrl"
  }
  return $mainGo.Directory.FullName
}

function Get-DefaultBinaryUrl {
  $arch = switch ($env:PROCESSOR_ARCHITECTURE.ToLowerInvariant()) {
    "amd64" { "amd64" }
    "x86" { "386" }
    "arm64" { "amd64" }
    default { "amd64" }
  }
  if ($arch -ne "amd64") {
    throw "Unsupported Windows CPU architecture for prebuilt agent: $env:PROCESSOR_ARCHITECTURE"
  }
  $base = Get-AgentAssetBase
  $url = "$base/cf-vps-monitor-agent-windows-amd64.exe"
  if (-not [string]::IsNullOrWhiteSpace($BinaryBaseUrl)) {
    return $url
  }
  return Join-GitHubProxy $url
}

function Get-DefaultChecksumUrl {
  $url = "$(Get-AgentAssetBase)/SHA256SUMS"
  if (-not [string]::IsNullOrWhiteSpace($BinaryBaseUrl)) {
    return $url
  }
  return Join-GitHubProxy $url
}

function Get-AgentAssetBase {
  if ([string]::IsNullOrWhiteSpace($BinaryBaseUrl)) {
    return $releaseBase.TrimEnd("/")
  }
  return $BinaryBaseUrl.TrimEnd("/")
}

function Test-DownloadedChecksum {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$FileName,
    [Parameter(Mandatory = $true)]
    [string]$Url
  )

  if ($DryRun) {
    Write-Host "[dry-run] verify SHA256SUMS for $FileName from $Url"
    return
  }

  $sumsPath = Join-Path $env:TEMP ("cf-vps-monitor-agent-sha256-" + [Guid]::NewGuid().ToString("N") + ".txt")
  Invoke-DownloadFile -Url $Url -OutFile $sumsPath
  try {
    $line = Get-Content -LiteralPath $sumsPath |
      Where-Object {
        $parts = ($_ -split '\s+') | Where-Object { $_ -ne "" }
        ($parts.Count -ge 2) -and ((Split-Path -Leaf $parts[-1].TrimStart("*")) -eq $FileName)
      } |
      Select-Object -First 1
    if (-not $line) {
      throw "Cannot find $FileName in SHA256SUMS from $Url."
    }
    $expected = (($line -split '\s+') | Where-Object { $_ -ne "" } | Select-Object -First 1).ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
      throw "Checksum verification failed for $FileName. Expected $expected, got $actual."
    }
  } finally {
    Remove-Item -LiteralPath $sumsPath -Force -ErrorAction SilentlyContinue
  }
}

function Uninstall-AllAgents {
  if (-not $Yes) {
    throw "-UninstallAll requires -Yes because it removes every CFVpsMonitorAgent* service and C:\Program Files\CF VPS Monitor."
  }
  $services = Get-Service -Name "CFVpsMonitorAgent*" -ErrorAction SilentlyContinue
  foreach ($service in $services) {
    if ($service.Status -ne "Stopped") {
      Invoke-Step "Stop-Service -Name `"$($service.Name)`" -Force" {
        Stop-Service -Name $service.Name -Force
      }
    }
    Invoke-Step "sc.exe delete `"$($service.Name)`"" {
      sc.exe delete $service.Name | Out-Null
    }
  }
  if (-not $KeepFiles) {
    $rootDir = "$env:ProgramFiles\CF VPS Monitor"
    Invoke-Step "Remove-Item -LiteralPath `"$rootDir`" -Recurse -Force" {
      if (Test-Path -LiteralPath $rootDir) {
        Remove-Item -LiteralPath $rootDir -Recurse -Force
      }
    }
  }
  Write-Host "Uninstalled all CF VPS Monitor agent services and files."
}

if ($UninstallAll) {
  Uninstall-AllAgents
  exit 0
}

Set-InstanceDefaults

if ([string]::IsNullOrWhiteSpace($ServiceName)) {
  throw "-ServiceName cannot be empty."
}

if ([string]::IsNullOrWhiteSpace($InstallDir) -or [System.IO.Path]::GetPathRoot($InstallDir) -eq $InstallDir) {
  throw "-InstallDir cannot be empty or a drive root."
}

$targetExe = Join-Path $InstallDir "cf-vps-monitor-agent.exe"
$runnerPath = Join-Path $InstallDir "run-agent.ps1"
$StateDir = Join-Path $InstallDir "state"

if ($Uninstall) {
  $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($existing) {
    if ($existing.Status -ne "Stopped") {
      Invoke-Step "Stop-Service -Name `"$ServiceName`" -Force" {
        Stop-Service -Name $ServiceName -Force
      }
    }
    Invoke-Step "sc.exe delete `"$ServiceName`"" {
      sc.exe delete $ServiceName | Out-Null
    }
  } else {
    Write-Host "Service not found: $ServiceName"
  }

  if (-not $KeepFiles) {
    Invoke-Step "Remove-Item -LiteralPath `"$InstallDir`" -Recurse -Force" {
      if (Test-Path -LiteralPath $InstallDir) {
        Remove-Item -LiteralPath $InstallDir -Recurse -Force
      }
    }
  }

  Write-Host "Uninstalled $ServiceName."
  exit 0
}

if ([string]::IsNullOrWhiteSpace($Server) -or [string]::IsNullOrWhiteSpace($Token)) {
  throw "-Server and -Token are required for install or upgrade."
}

if ($BinaryPath -ne "" -and ($BinaryUrl -ne "" -or $BuildFromSource)) {
  throw "Use only one of -BinaryPath, -BinaryUrl, or -BuildFromSource."
}

if ($BinaryUrl -ne "" -and $BuildFromSource) {
  throw "Use only one of -BinaryUrl or -BuildFromSource."
}

Assert-HttpsUrl -Name "-BinaryUrl" -Url $BinaryUrl
Assert-HttpsUrl -Name "-BinaryBaseUrl" -Url $BinaryBaseUrl
Assert-HttpsUrl -Name "-ChecksumUrl" -Url $ChecksumUrl
Assert-HttpsUrl -Name "-SourceUrl" -Url $SourceUrl
$Proxy = Normalize-HttpUrl -Name "-Proxy" -Url $Proxy -AllowPath $false
$InstallGhproxy = Normalize-HttpUrl -Name "-InstallGhproxy" -Url $InstallGhproxy

if ($BinaryPath -eq "" -and $BinaryUrl -eq "" -and -not $BuildFromSource) {
  $BinaryUrl = Get-DefaultBinaryUrl
  $ChecksumUrl = Get-DefaultChecksumUrl
  $autoBinaryUrl = $true
}

if ($BinaryPath -eq "" -and $BinaryUrl -ne "") {
  if ([string]::IsNullOrWhiteSpace($ChecksumUrl) -and -not $autoBinaryUrl) {
    throw "Custom -BinaryUrl requires -ChecksumUrl for SHA256 verification."
  }
  $downloadOut = Join-Path $env:TEMP "cf-vps-monitor-agent.exe"
  Invoke-DownloadFile -Url $BinaryUrl -OutFile $downloadOut
  Test-DownloadedChecksum -Path $downloadOut -FileName (Split-Path $BinaryUrl -Leaf) -Url $ChecksumUrl
  $BinaryPath = $downloadOut
}

if ($BinaryPath -eq "" -and $BuildFromSource) {
  $go = Get-Command go -ErrorAction SilentlyContinue
  if (-not $go -and -not $DryRun) {
    throw "Go is required for -BuildFromSource. Use the default prebuilt install or pass -BinaryUrl."
  }
  $buildOut = Join-Path $env:TEMP "cf-vps-monitor-agent.exe"
  $buildDir = Resolve-BuildDirectory
  $buildCommand = "go build -trimpath -ldflags=`"-s -w`" -o `"$buildOut`" ."
  if ($DryRun) {
    Write-Host "[dry-run] cd `"$buildDir`"; $buildCommand"
  } else {
    Push-Location $buildDir
    try {
      go build -trimpath -ldflags="-s -w" -o $buildOut .
    } finally {
      Pop-Location
    }
  }
  $BinaryPath = $buildOut
}

if (-not (Test-Path $BinaryPath) -and -not $DryRun) {
  throw "Binary not found: $BinaryPath"
}

$powerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$binaryPathName = '"' + $powerShellPath + '" -NoProfile -ExecutionPolicy Bypass -File "' + $runnerPath + '"'

if ($DryRun) {
  Write-Host "[dry-run] New-Item -ItemType Directory -Force `"$InstallDir`""
  Write-Host "[dry-run] New-Item -ItemType Directory -Force `"$StateDir`""
  Write-Host "[dry-run] Copy-Item `"$BinaryPath`" `"$targetExe`""
  Write-Host "[dry-run] Write service runner `"$runnerPath`" (token hidden)"
  Write-Host "[dry-run] Lock ACL on `"$InstallDir`" to SYSTEM, Administrators, and LocalService read/execute; grant LocalService modify on `"$StateDir`""
  Write-Host "[dry-run] Stop/delete existing service if present: `"$ServiceName`""
  Write-Host "[dry-run] New-Service -Name `"$ServiceName`" -BinaryPathName $binaryPathName -StartupType Automatic"
  Write-Host "[dry-run] sc.exe config `"$ServiceName`" obj= `"NT AUTHORITY\LocalService`""
  Write-Host "[dry-run] Start-Service -Name `"$ServiceName`""
  exit 0
}

New-Item -ItemType Directory -Force $InstallDir | Out-Null
New-Item -ItemType Directory -Force $StateDir | Out-Null
Copy-Item $BinaryPath $targetExe -Force

$runnerContent = @"
`$ErrorActionPreference = "Stop"
`$env:CF_MONITOR_SERVER = $(ConvertTo-PowerShellLiteral $Server)
`$env:CF_MONITOR_TOKEN = $(ConvertTo-PowerShellLiteral $Token)
`$env:CF_MONITOR_NAME = $(ConvertTo-PowerShellLiteral $Name)
`$env:CF_MONITOR_MODE = $(ConvertTo-PowerShellLiteral $Mode)
`$env:CF_MONITOR_MOUNT_INCLUDE = $(ConvertTo-PowerShellLiteral $MountInclude)
`$env:CF_MONITOR_MOUNT_EXCLUDE = $(ConvertTo-PowerShellLiteral $MountExclude)
`$env:CF_MONITOR_NIC_INCLUDE = $(ConvertTo-PowerShellLiteral $NicInclude)
`$env:CF_MONITOR_NIC_EXCLUDE = $(ConvertTo-PowerShellLiteral $NicExclude)
`$env:CF_MONITOR_TRAFFIC_RESET_DAY = $(ConvertTo-PowerShellLiteral ([string]$TrafficResetDay))
`$env:CF_MONITOR_TRAFFIC_STATE_FILE = Join-Path `$PSScriptRoot "state\traffic-state.json"

& "`$PSScriptRoot\cf-vps-monitor-agent.exe" --interval $Interval --ping-interval $PingInterval --traffic-reset-day $TrafficResetDay
exit `$LASTEXITCODE
"@
Set-Content -LiteralPath $runnerPath -Value $runnerContent -Encoding UTF8
icacls $InstallDir /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" "*S-1-5-19:RX" /T | Out-Null
icacls $StateDir /grant:r "*S-1-5-19:(OI)(CI)M" /T | Out-Null
icacls $runnerPath /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" "*S-1-5-19:RX" | Out-Null

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  if ($existing.Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -Force
  }
  sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Seconds 2
}

New-Service `
  -Name $ServiceName `
  -DisplayName "CF VPS Monitor Agent" `
  -StartupType Automatic `
  -BinaryPathName $binaryPathName | Out-Null
sc.exe config $ServiceName obj= "NT AUTHORITY\LocalService" | Out-Null

Start-Service -Name $ServiceName
Get-Service -Name $ServiceName
