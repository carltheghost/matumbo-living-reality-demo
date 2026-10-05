[CmdletBinding()]
param([ValidateRange(1,65535)][int]$StaticPort = 8082)
$ErrorActionPreference = 'Stop'

function Get-StatusState {
    param($Value, [string[]]$Allowed)
    # Never print arbitrary response text, including provider diagnostics.
    if ($Value -isnot [string] -or $Allowed -cnotcontains $Value) {
        throw 'The bridge returned invalid provider status metadata.'
    }
    return $Value
}

function Get-VerifiedTimestamp {
    param($Value)
    if ($null -eq $Value) { return $null }
    # PowerShell 7 can decode JSON dates to DateTime; PowerShell 5 leaves strings.
    if ($Value -is [DateTime]) { return $Value.ToUniversalTime().ToString('o') }
    $parsed = [DateTimeOffset]::MinValue
    if ($Value -isnot [string] -or $Value -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?Z$' -or
        -not [DateTimeOffset]::TryParse($Value, [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$parsed)) {
        throw 'The bridge returned invalid reply verification metadata.'
    }
    return $parsed.UtcDateTime.ToString('o')
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\','/')
$url = "http://127.0.0.1:$StaticPort"
$rootBytes = [Text.Encoding]::UTF8.GetBytes($repositoryRoot.Replace('\','/').ToLowerInvariant())
$sha = [Security.Cryptography.SHA256]::Create()
try { $rootFingerprint = ([BitConverter]::ToString($sha.ComputeHash($rootBytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
$health = Invoke-RestMethod "$url/api/health" -TimeoutSec 5
if ($health.service -ne 'matumbo-provider-bridge' -or $health.rootFingerprint -ne $rootFingerprint -or -not $health.healthy) {
    throw 'The listener does not serve this Reality Lens checkout. Choose another port; it will not be replaced.'
}
foreach ($relative in @('index.html','src/main.js','src/render/reality-assembly.js','src/render/api-connections.js','src/render/web-ai.js','src/render/my-gpt.js','vendor/three-r179.1/build/three.module.js')) {
    $response = Invoke-WebRequest "$url/$relative" -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -ne 200) { throw "Required browser resource is unavailable: $relative" }
}
$providerStatus = Invoke-RestMethod "$url/api/providers" -TimeoutSec 5
$nvidia = @($providerStatus.providers | Where-Object id -eq 'nvidia')[0]
if ($providerStatus.service -cne 'matumbo-provider-bridge' -or $providerStatus.credentialsInBrowser -isnot [bool] -or $providerStatus.credentialsInBrowser) {
    throw 'The listener did not return safe local provider status metadata.'
}
$nvidiaState = Get-StatusState $nvidia.state @('key_needed','configured','verified','error')

# Only GET status: sign-in, model discovery, token refresh and inference remain user actions.
$gptStatus = Invoke-RestMethod "$url/api/gpt/status" -TimeoutSec 5
if ($gptStatus.service -cne 'matumbo-gpt-bridge' -or $gptStatus.credentialsInBrowser -isnot [bool] -or $gptStatus.credentialsInBrowser -or
    $gptStatus.chatgpt.authAvailable -isnot [bool] -or $gptStatus.chatgpt.planUsage -isnot [bool]) {
    throw 'The listener did not return safe local GPT status metadata.'
}
$chatgptState = Get-StatusState $gptStatus.chatgpt.state @('signed_out','signed_in','verified','reauth_required','plan_disabled')
$openaiState = Get-StatusState $gptStatus.openai.state @('key_needed','configured','verified')
$dependencyState = Get-StatusState $gptStatus.chatgpt.dependencyState @('ready','dependency_needed')
$credentialStorage = Get-StatusState $gptStatus.credentialStorage @('windows_dpapi','owner_only_file','session_only')
if ($gptStatus.chatgpt.authAvailable -ne ($dependencyState -ceq 'ready')) {
    throw 'The bridge returned inconsistent authentication dependency metadata.'
}
$chatgptVerifiedAt = Get-VerifiedTimestamp $gptStatus.chatgpt.verifiedAt
$openaiVerifiedAt = Get-VerifiedTimestamp $gptStatus.openai.verifiedAt
$gpt = [PSCustomObject]@{
    statusReadOnly=$true
    authenticationStarted=$false
    inferenceAttempted=$false
    credentialStorage=$credentialStorage
    storageWarningPresent=($null -ne $gptStatus.storageWarning)
    chatgpt=[PSCustomObject]@{
        state=$chatgptState
        authAvailable=$gptStatus.chatgpt.authAvailable
        dependencyState=$dependencyState
        ready=($chatgptState -cin @('signed_in','verified') -and $gptStatus.chatgpt.planUsage)
        cloudReplyVerified=($chatgptState -ceq 'verified' -and $null -ne $chatgptVerifiedAt)
        verifiedAt=$chatgptVerifiedAt
    }
    openai=[PSCustomObject]@{
        state=$openaiState
        ready=($openaiState -cin @('configured','verified'))
        cloudReplyVerified=($openaiState -ceq 'verified' -and $null -ne $openaiVerifiedAt)
        verifiedAt=$openaiVerifiedAt
    }
}
# Select safe metadata explicitly: account labels, IDs, errors and model catalogs stay out of launcher output.
[PSCustomObject]@{ url=$url; verified=$true; featureCount=$health.featureCount; instanceId=$health.instanceId; rootFingerprint=$rootFingerprint; storage=$health.storage; nvidia=$nvidiaState; gpt=$gpt; credentialsInBrowser=$false; externalDeployment=$false }
