[CmdletBinding()]
param([ValidateRange(1,65535)][int]$StaticPort = 8082)
$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\','/')
$statePath = Join-Path $repositoryRoot "work\demo-launch\process-$StaticPort.json"
if (-not (Test-Path -LiteralPath $statePath)) { Write-Output 'No recorded owned bridge for this port.'; return }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if ($state.root -ne $repositoryRoot -or $state.port -ne $StaticPort) { throw 'Launch record belongs to another checkout or port.' }
$ProcessId = [int]$state.pid
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
if (-not $process) { Remove-Item -LiteralPath $statePath; Write-Output 'Recorded bridge is already stopped.'; return }
if ($process.CreationDate.ToUniversalTime().ToString('o') -ne $state.creationTime -or $process.CommandLine -ne $state.commandLine) { throw 'Process identity changed; refusing to stop it.' }
$health = Invoke-RestMethod "http://127.0.0.1:$StaticPort/api/health" -TimeoutSec 5
if ($health.instanceId -ne $state.instanceId -or $health.rootFingerprint -ne $state.rootFingerprint) { throw 'Listener identity changed; refusing to stop it.' }
Stop-Process -Id $ProcessId
Remove-Item -LiteralPath $statePath
Write-Output "Stopped owned Reality Lens bridge on port $StaticPort."
