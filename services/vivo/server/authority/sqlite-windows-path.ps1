# Read-only native evidence. No Set-Acl, icacls, execution-policy changes or directories.
param([Parameter(Mandatory=$true)][string]$TargetPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class VivoReadOnlyVolume {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern uint QueryDosDevice(string name, StringBuilder target, int length);
}
'@
$full = [System.IO.Path]::GetFullPath($TargetPath)
$root = [System.IO.Path]::GetPathRoot($full)
$drive = [System.IO.DriveInfo]::new($root)
$device = [System.Text.StringBuilder]::new(4096)
if ([VivoReadOnlyVolume]::QueryDosDevice($root.TrimEnd('\'), $device, $device.Capacity) -eq 0) { throw 'VOLUME_QUERY' }
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$paths = [System.Collections.Generic.List[string]]::new()
$dir = [System.IO.DirectoryInfo]::new([System.IO.Path]::GetDirectoryName($full))
while ($null -ne $dir) { $paths.Add($dir.FullName); $dir = $dir.Parent }
$paths.Add($full)
foreach ($suffix in @('-wal','-shm','-journal')) { $paths.Add($full + $suffix) }
$nodes = @()
foreach ($path in $paths) {
  if (-not (Test-Path -LiteralPath $path)) { $nodes += @{path=$path; exists=$false}; continue }
  $item = Get-Item -LiteralPath $path -Force
  $acl = Get-Acl -LiteralPath $path
  $raw = [System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
  $aces = @()
  foreach ($ace in $raw.DiscretionaryAcl) {
    if (($ace -isnot [System.Security.AccessControl.CommonAce]) -or $ace.IsCallback) { throw 'UNSUPPORTED_ACE' }
    $kind = switch ($ace.AceQualifier.ToString()) { 'AccessAllowed' {'allow'} 'AccessDenied' {'deny'} default {throw 'UNSUPPORTED_ACE'} }
    $aces += @{type=$kind; sid=$ace.SecurityIdentifier.Value; mask=[long]$ace.AccessMask; flags=[int]$ace.AceFlags}
  }
  $nodes += @{path=$path; exists=$true; attributes=[int]$item.Attributes; owner=$raw.Owner.Value;
    daclPresent=($null -ne $raw.DiscretionaryAcl); aces=$aces}
}
@{schema='vivo.windows-path/1'; path=$full; sid=$sid; driveType=$drive.DriveType.ToString();
  fileSystem=$drive.DriveFormat; device=$device.ToString(); nodes=$nodes} | ConvertTo-Json -Depth 10 -Compress
