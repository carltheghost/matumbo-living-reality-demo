$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\','/')
$probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$probe.Start();$port=$probe.LocalEndpoint.Port;$probe.Stop()
$statePath=Join-Path $repositoryRoot "work\demo-launch\process-$port.json"
$originalRecord=$null
$ownedProcess=$null
try {
    $first = & (Join-Path $repositoryRoot 'scripts\launch-demo.ps1') -StaticPort $port | Where-Object { $_.verified }
    if (-not $first.verified -or $first.featureCount -ne 36) { throw 'Launch did not verify the 36-feature checkout.' }
    $originalRecord=Get-Content -LiteralPath $statePath -Raw
    $launchState=$originalRecord | ConvertFrom-Json
    $ownedProcess=[Diagnostics.Process]::GetProcessById([int]$launchState.pid)
    $repeat = & (Join-Path $repositoryRoot 'scripts\launch-demo.ps1') -StaticPort $port | Where-Object { $_.verified }
    if ($repeat.instanceId -ne $first.instanceId -or (Get-Content -LiteralPath $statePath -Raw) -ne $originalRecord) { throw 'Reuse changed process ownership.' }
    $wrong= $originalRecord | ConvertFrom-Json
    $wrong.creationTime='2000-01-01T00:00:00.0000000Z'
    $wrong | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
    $refused=$false
    try { & (Join-Path $repositoryRoot 'scripts\stop-demo.ps1') -StaticPort $port } catch { $refused=$true }
    if (-not $refused) { throw 'Stop did not reject a changed process identity.' }
    & (Join-Path $repositoryRoot 'scripts\verify-demo-launch.ps1') -StaticPort $port | Out-Null
    $originalRecord | Set-Content -LiteralPath $statePath -Encoding UTF8
    & (Join-Path $repositoryRoot 'scripts\stop-demo.ps1') -StaticPort $port | Out-Null
    if (Test-Path -LiteralPath $statePath) { throw 'Owned stop did not remove its record.' }
    if (-not $ownedProcess.WaitForExit(5000)) { throw 'The recorded owned process did not exit after stop.' }
    if (@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue).Count -gt 0) { throw 'The stopped bridge port still has a listener.' }
    # A stopped HTTP server can leave Windows TCP connections in TIME_WAIT. Do not
    # require an exclusive .NET socket to reuse that port: reserve this independent
    # refusal fixture atomically on port zero and keep it bound throughout the check.
    $foreign=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
    $foreign.ExclusiveAddressUse=$true
    try {
        $foreign.Start()
        $foreignPort=$foreign.LocalEndpoint.Port
        $foreignStatePath=Join-Path $repositoryRoot "work\demo-launch\process-$foreignPort.json"
        $foreignStateBefore=if (Test-Path -LiteralPath $foreignStatePath) { Get-Content -LiteralPath $foreignStatePath -Raw } else { $null }
        $refused=$false
        try { & (Join-Path $repositoryRoot 'scripts\launch-demo.ps1') -StaticPort $foreignPort | Out-Null } catch { $refused=$true }
        $foreignStateAfter=if (Test-Path -LiteralPath $foreignStatePath) { Get-Content -LiteralPath $foreignStatePath -Raw } else { $null }
        $foreignOwners=@(Get-NetTCPConnection -State Listen -LocalPort $foreignPort -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq $PID)
        if (-not $refused -or -not $foreign.Server.IsBound -or $foreignOwners.Count -ne 1) { throw 'Foreign listener was not preserved.' }
        if ($foreignStateAfter -cne $foreignStateBefore) { throw 'Refusing a foreign listener changed process ownership.' }
    } finally { $foreign.Stop() }
    Write-Output "Owned bridge PID $($launchState.pid) exited and port $port has no listener; foreign fixture port $foreignPort was preserved without changing its ownership record."
    Write-Output 'Launch, reuse, guarded stop and foreign-listener checks passed.'
} finally {
    try {
        if ($originalRecord -and (Test-Path -LiteralPath $statePath)) {
            $currentState=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
            if ($currentState.pid -ne $launchState.pid -or $currentState.instanceId -ne $launchState.instanceId) { throw 'Test cleanup refused a replaced ownership record.' }
            # Restore only this launch's record if an earlier assertion interrupted
            # the deliberately corrupted creation-time check. Stop retains its own
            # actual process, command-line and HTTP identity guards.
            $originalRecord | Set-Content -LiteralPath $statePath -Encoding UTF8
            & (Join-Path $repositoryRoot 'scripts\stop-demo.ps1') -StaticPort $port
        }
    } finally { if ($ownedProcess) { $ownedProcess.Dispose() } }
}
