# Same as build.py, for Windows PowerShell (no Python needed).   Run:  powershell -File tools\build.ps1
# NOTE: written alongside build.py but not run on Windows yet. If it misbehaves, use build.py.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Split-Path $PSScriptRoot -Parent
$ext  = Join-Path $root 'extension'
$m    = Get-Content (Join-Path $ext 'manifest.json') -Raw | ConvertFrom-Json
$ver  = if ($m.version_name) { $m.version_name } else { $m.version }
New-Item -ItemType Directory -Force (Join-Path $root 'dist') | Out-Null
New-Item -ItemType Directory -Force (Join-Path $root 'public\download') | Out-Null
$hosted = Join-Path $root 'public\download\film-room-overlay.zip'
$versioned = Join-Path $root "dist\film-room-overlay-v$ver.zip"
$tmp = Join-Path $env:TEMP ('fr-build-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force (Join-Path $tmp 'film-room-overlay') | Out-Null
Copy-Item (Join-Path $ext '*') (Join-Path $tmp 'film-room-overlay') -Recurse
if (Test-Path $hosted) { Remove-Item $hosted }
[IO.Compression.ZipFile]::CreateFromDirectory($tmp, $hosted)   # keeps the film-room-overlay folder at the top of the zip
Copy-Item $hosted $versioned -Force
Remove-Item $tmp -Recurse -Force
$bytes = (Get-Item $hosted).Length
$sha = (Get-FileHash $hosted -Algorithm SHA256).Hash.ToLower()
@{ version = $ver; bytes = $bytes; sha256 = $sha } | ConvertTo-Json | Set-Content (Join-Path $root 'public\download\version.json')
"built $versioned"; "$ver  $bytes bytes  sha256 $sha"
