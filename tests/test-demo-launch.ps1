$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\','/')
$probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$probe.Start();$port=$probe.LocalEndpoint.Port;$probe.Stop()
$statePath=Join-Path $repositoryRoot "work\demo-launch\process-$port.json"
try {
    $first = & (Join-Path $repositoryRoot 'scripts\launch-demo.ps1') -StaticPort $port | Where-Object { $_.verified }
    if (-not $first.verified -or $first.featureCount -ne 36) { throw 'Launch did not verify the 36-feature checkout.' }
    $originalRecord=Get-Content -LiteralPath $statePath -Raw
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
    $foreign=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$port)
    try {
        $foreign.Start();$refused=$false
        try { & (Join-Path $repositoryRoot 'scripts\launch-demo.ps1') -StaticPort $port | Out-Null } catch { $refused=$true }
        if (-not $refused -or -not $foreign.Server.IsBound) { throw 'Foreign listener was not preserved.' }
    } finally { $foreign.Stop() }
    Write-Output 'Launch, reuse, guarded stop and foreign-listener checks passed.'
} finally {
    if (Test-Path -LiteralPath $statePath) { & (Join-Path $repositoryRoot 'scripts\stop-demo.ps1') -StaticPort $port }
}
