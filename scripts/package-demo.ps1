[CmdletBinding()]
param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repositoryRoot ('work\static-demo-' + [guid]::NewGuid().ToString('N')) }
$python = Get-Command py -ErrorAction SilentlyContinue
$arguments = @()
if ($python) { $arguments += '-3' } else { $python = Get-Command python -ErrorAction SilentlyContinue }
if (-not $python) { throw 'Python 3.10 or newer is required.' }
$arguments += @((Join-Path $PSScriptRoot 'package_demo.py'),$OutputDirectory)
& $python.Source @arguments
if ($LASTEXITCODE -ne 0) { throw 'Static package validation failed.' }
