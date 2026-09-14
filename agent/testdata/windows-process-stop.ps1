param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)]
  [ValidateSet('running', 'exited-after-enumeration', 'stop-denied', 'stop-failed')]
  [string]$Scenario
)

$ErrorActionPreference = 'Stop'
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($Installer, [ref]$null, [ref]$parseErrors)
if ($parseErrors) { throw 'Installer syntax is invalid.' }
$definition = $ast.Find({ param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Stop-AgentInstanceProcesses'
}, $false)
if (-not $definition) { throw 'Installer process-stop function is missing.' }
. ([scriptblock]::Create($definition.Extent.Text))

$script:stopFixtureChild = Start-Process -FilePath (Get-Command pwsh -ErrorAction Stop).Source `
  -ArgumentList @('-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 60') `
  -WindowStyle Hidden -PassThru
try {
  function Get-AgentInstanceProcesses {
    param([string]$Executable)
    $selected = Get-Process -Id $script:stopFixtureChild.Id -ErrorAction Stop
    if ($Scenario -eq 'exited-after-enumeration') {
      # The scheduler can finish stopping the selected process before the
      # installer reaches Stop-Process. Keep the real, now exited object.
      $script:stopFixtureChild.Kill()
      if (-not $script:stopFixtureChild.WaitForExit(5000)) { throw 'Fixture did not exit.' }
    }
    return $selected
  }

  if ($Scenario -in @('stop-denied', 'stop-failed')) {
    function Stop-Process {
      [CmdletBinding()]
      param([int]$Id, [Diagnostics.Process]$InputObject, [switch]$Force)
      $category = if ($Scenario -eq 'stop-denied') { 'PermissionDenied' } else { 'InvalidOperation' }
      Write-Error -Message 'Injected process stop failure.' -Category $category -ErrorId 'FixtureStopFailed'
    }
  }

  $failureCategory = $null
  try { Stop-AgentInstanceProcesses 'isolated-test-process' }
  catch { $failureCategory = [string]$_.CategoryInfo.Category }
  $script:stopFixtureChild.Refresh()
  [pscustomobject]@{
    stopped = $null -eq $failureCategory
    exited = $script:stopFixtureChild.HasExited
    failureCategory = $failureCategory
  } | ConvertTo-Json -Compress
} finally {
  if (-not $script:stopFixtureChild.HasExited) {
    $script:stopFixtureChild.Kill()
    $null = $script:stopFixtureChild.WaitForExit(5000)
  }
  $script:stopFixtureChild.Dispose()
}
