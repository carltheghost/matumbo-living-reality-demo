[CmdletBinding()]
param([ValidateRange(1,65535)][int]$StaticPort = 8082, [switch]$OpenBrowser)
$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\','/')
$stateDirectory = Join-Path $repositoryRoot 'work\demo-launch'
$statePath = Join-Path $stateDirectory "process-$StaticPort.json"
$bridgePath = Join-Path $PSScriptRoot 'provider_bridge.py'
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $StaticPort -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
    $verified = & (Join-Path $PSScriptRoot 'verify-demo-launch.ps1') -StaticPort $StaticPort
    Write-Output "Verified existing Reality Lens at $($verified.url); no process ownership was taken."
    if ($OpenBrowser) { Start-Process $verified.url }
    return $verified
}
$python = Get-Command py -ErrorAction SilentlyContinue
$arguments = @()
if ($python) { $arguments += '-3' } else { $python = Get-Command python -ErrorAction SilentlyContinue }
if (-not $python) { throw 'Python 3.10 or newer is required. Install Python, then run this launcher again.' }
$version = & $python.Source @arguments -c "import sys; print('.'.join(map(str,sys.version_info[:2])))"
if ([version]$version -lt [version]'3.10') { throw 'Python 3.10 or newer is required.' }
New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
$arguments += @('-u', ('"{0}"' -f $bridgePath), '--port', [string]$StaticPort)
$process = Start-Process -FilePath $python.Source -ArgumentList $arguments -WorkingDirectory $repositoryRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDirectory "bridge-$StaticPort.stdout.log") -RedirectStandardError (Join-Path $stateDirectory "bridge-$StaticPort.stderr.log")
try {
    $verified = $null
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        if ($process.HasExited) { throw 'The bridge stopped before verification. Check the local launch error log.' }
        try { $verified = & (Join-Path $PSScriptRoot 'verify-demo-launch.ps1') -StaticPort $StaticPort; break } catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $verified) { throw 'Reality Lens did not verify within the startup window.' }
    # py.exe may spawn python.exe: record the actual listener, never an arbitrary name match.
    $listener = @(Get-NetTCPConnection -State Listen -LocalPort $StaticPort)[0]
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    if (-not $owner.CommandLine.Contains($bridgePath)) { throw 'The listener owner is not the launched bridge.' }
    if (($owner.ProcessId -ne $process.Id -and $owner.ParentProcessId -ne $process.Id) -or
        $owner.CreationDate.ToUniversalTime() -lt $process.StartTime.ToUniversalTime()) {
        throw 'The matching listener belongs to another launch. Process ownership was not taken.'
    }
    [PSCustomObject]@{ pid=$owner.ProcessId; creationTime=$owner.CreationDate.ToUniversalTime().ToString('o'); commandLine=$owner.CommandLine; root=$repositoryRoot; port=$StaticPort; instanceId=$verified.instanceId; rootFingerprint=$verified.rootFingerprint } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
    Write-Output "Reality Lens verified at $($verified.url); $($verified.featureCount) features; NVIDIA $($verified.nvidia)."
    if ($OpenBrowser) { Start-Process $verified.url }
    return $verified
} catch {
    # py.exe may own a child python.exe. Stop only verified descendants of this launch.
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($process.Id)")
    foreach ($child in $children) {
        if ($child.CommandLine -and $child.CommandLine.Contains($bridgePath) -and
            $child.CreationDate.ToUniversalTime() -ge $process.StartTime.ToUniversalTime()) {
            Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
        }
    }
    $owned = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)"
    if ($owned -and $owned.CommandLine -and $owned.CommandLine.Contains($bridgePath) -and
        $owned.CreationDate.ToUniversalTime() -eq $process.StartTime.ToUniversalTime()) {
        Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
    }
    throw
}
