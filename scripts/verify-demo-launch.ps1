[CmdletBinding()]
param([ValidateRange(1,65535)][int]$StaticPort = 8082)
$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\','/')
$url = "http://127.0.0.1:$StaticPort"
$rootBytes = [Text.Encoding]::UTF8.GetBytes($repositoryRoot.Replace('\','/').ToLowerInvariant())
$sha = [Security.Cryptography.SHA256]::Create()
try { $rootFingerprint = ([BitConverter]::ToString($sha.ComputeHash($rootBytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
$health = Invoke-RestMethod "$url/api/health" -TimeoutSec 5
if ($health.service -ne 'matumbo-provider-bridge' -or $health.rootFingerprint -ne $rootFingerprint -or -not $health.healthy) {
    throw 'The listener does not serve this Reality Lens checkout. Choose another port; it will not be replaced.'
}
foreach ($relative in @('index.html','src/main.js','src/render/reality-assembly.js','src/render/api-connections.js','vendor/three-r179.1/build/three.module.js')) {
    $response = Invoke-WebRequest "$url/$relative" -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -ne 200) { throw "Required browser resource is unavailable: $relative" }
}
$providerStatus = Invoke-RestMethod "$url/api/providers" -TimeoutSec 5
$nvidia = @($providerStatus.providers | Where-Object id -eq 'nvidia')[0]
[PSCustomObject]@{ url=$url; verified=$true; featureCount=$health.featureCount; instanceId=$health.instanceId; rootFingerprint=$rootFingerprint; storage=$health.storage; nvidia=$nvidia.state; credentialsInBrowser=$false; externalDeployment=$false }
