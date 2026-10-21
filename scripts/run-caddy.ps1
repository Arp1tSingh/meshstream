# Caddy process used by npm run up.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root ".tools\caddy\caddy.exe"
$config = Join-Path $root "services\caddy\Caddyfile"

if (-not (Test-Path $exe)) {
  $command = Get-Command caddy -ErrorAction SilentlyContinue
  if ($command) {
    $exe = $command.Source
  } else {
    throw "Caddy is not installed. Run: npm run media:setup"
  }
}

Set-Location $root
Write-Host "Caddy single origin on http://localhost:8080" -ForegroundColor Cyan
& $exe run --config $config
exit $LASTEXITCODE
