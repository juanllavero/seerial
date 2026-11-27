# Downloads libmpv for Windows (shinchiro/mpv-winbuild-cmake dev build) into src-tauri/lib:
#   - mpv.dll  shipped next to the .exe (tauri.conf.json bundle.resources)
#   - mpv.lib  import library used only at link time (build.rs)
#
#   pwsh apps/desktop/scripts/fetch-libmpv-windows.ps1 [-Tag 20251124]
#
# Needs the MSVC tools (dumpbin, lib): found with vswhere, or already on PATH in a
# "Developer PowerShell" / after ilammy/msvc-dev-cmd in CI. 7-Zip must be installed.
param(
  [string]$Tag = 'latest',
  [switch]$Force
)
$ErrorActionPreference = 'Stop'

$libDir = Join-Path $PSScriptRoot '..\src-tauri\lib' | Resolve-Path -ErrorAction SilentlyContinue
if (-not $libDir) { $libDir = New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot '..\src-tauri\lib') }
$libDir = "$libDir"

if (-not $Force -and (Test-Path "$libDir\mpv.dll") -and (Test-Path "$libDir\mpv.lib")) {
  Write-Host "libmpv already present in $libDir (use -Force to download it again)"
  exit 0
}

function Find-MsvcTool([string]$name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path $vswhere)) { throw "$name not found and vswhere is missing: install the MSVC build tools" }
  $vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  $tool = Get-ChildItem "$vs\VC\Tools\MSVC\*\bin\Hostx64\x64\$name.exe" | Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $tool) { throw "$name.exe not found in $vs" }
  return $tool.FullName
}

$sevenZip = (Get-Command 7z -ErrorAction SilentlyContinue).Source
if (-not $sevenZip) { $sevenZip = "$env:ProgramFiles\7-Zip\7z.exe" }
if (-not (Test-Path $sevenZip)) { throw '7-Zip not found' }

$headers = @{ 'User-Agent' = 'seerial-build' }
if ($env:GITHUB_TOKEN) { $headers.Authorization = "Bearer $env:GITHUB_TOKEN" }
$api = 'https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases'
$release = if ($Tag -eq 'latest') { Invoke-RestMethod "$api/latest" -Headers $headers } else { Invoke-RestMethod "$api/tags/$Tag" -Headers $headers }
# x86_64 baseline build (the -v3 one needs AVX2)
$asset = $release.assets | Where-Object { $_.name -match '^mpv-dev-x86_64-\d{8}-git-[0-9a-f]+\.7z$' } | Select-Object -First 1
if (-not $asset) { throw "No mpv-dev-x86_64 asset in release $($release.tag_name)" }

$tmp = Join-Path ([IO.Path]::GetTempPath()) "libmpv-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Write-Host "Downloading $($asset.name) ($($release.tag_name))"
  Invoke-WebRequest $asset.browser_download_url -OutFile "$tmp\mpv-dev.7z" -Headers $headers
  & $sevenZip x "$tmp\mpv-dev.7z" "-o$tmp\x" -y | Out-Null
  $dll = Get-ChildItem "$tmp\x" -Recurse -Filter 'libmpv-2.dll' | Select-Object -First 1
  if (-not $dll) { throw 'libmpv-2.dll not found in the archive' }

  # Import library for a DLL renamed to mpv.dll: exports from dumpbin -> .def -> lib
  $dumpbin = Find-MsvcTool 'dumpbin'
  $libExe = Find-MsvcTool 'lib'
  $exports = & $dumpbin /exports $dll.FullName |
    Where-Object { $_ -match '^\s+\d+\s+[0-9A-F]+\s+[0-9A-F]+\s+(\S+)' } |
    ForEach-Object { $Matches[1] }
  if (-not $exports) { throw 'No exports found in libmpv-2.dll' }
  Set-Content "$tmp\mpv.def" -Value (@('LIBRARY mpv.dll', 'EXPORTS') + ($exports | ForEach-Object { "    $_" }))
  & $libExe /nologo "/def:$tmp\mpv.def" "/out:$tmp\mpv.lib" /machine:x64 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'lib.exe failed' }

  Copy-Item $dll.FullName "$libDir\mpv.dll" -Force
  Copy-Item "$tmp\mpv.lib" "$libDir\mpv.lib" -Force
  Set-Content "$libDir\mpv.VERSION" -Value "$($release.tag_name) $($asset.name)"
  Write-Host "libmpv $($release.tag_name) -> $libDir (mpv.dll + mpv.lib, $($exports.Count) exports)"
}
finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
