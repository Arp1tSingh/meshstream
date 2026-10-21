# Starts MediaMTX with the MeshStream config.
# Run from anywhere; the repo root becomes the working directory so recordings
# land in ./data/recordings and the API can scan them.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$config = Join-Path $root "services\mediamtx\mediamtx.yml"
$exe = Join-Path $root ".tools\mediamtx\mediamtx.exe"

if (-not (Test-Path $config)) {
  throw "Missing config: $config"
}

if (-not (Test-Path $exe)) {
  $command = Get-Command mediamtx -ErrorAction SilentlyContinue
  if ($command) {
    $exe = $command.Source
  } else {
    throw "MediaMTX is not installed. Run: npm run media:setup"
  }
}

New-Item -ItemType Directory -Force -Path (Join-Path $root "data\recordings") | Out-Null

Write-Host ""
Write-Host "MediaMTX" -ForegroundColor Cyan
Write-Host "  WHIP ingest  http://127.0.0.1:8889/live/<stream>/whip"
Write-Host "  HLS edge     http://127.0.0.1:8888/live/<stream>/index.m3u8"
Write-Host "  Recordings   data\recordings\<stream>\"
Write-Host "  Config      $config"
Write-Host ""

Set-Location $root
& $exe $config
exit $LASTEXITCODE
