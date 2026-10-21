# Production app process used by npm run up.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path (Join-Path $root "apps\web\.next\BUILD_ID"))) {
  throw "No production build found. Run npm run build first."
}

Write-Host "MeshStream app (Next + API + signal)" -ForegroundColor Cyan
npm run start
