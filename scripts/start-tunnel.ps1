# Starts a free Cloudflare Quick Tunnel pointed at the local Caddy origin.
# Writes the rotating public URL to data/tunnel-url.txt while the tunnel runs.
#
# Usage:
#   npm run tunnel
#   powershell -ExecutionPolicy Bypass -File scripts/start-tunnel.ps1 -Target http://localhost:8080

[CmdletBinding()]
param(
  [string]$Target = "http://localhost:8080"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path $root "data"
$urlFile = Join-Path $data "tunnel-url.txt"
$logFile = Join-Path $data "tunnel.log"

New-Item -ItemType Directory -Force -Path $data | Out-Null

$candidates = @(
  (Join-Path $root ".tools\cloudflared.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "cloudflared\cloudflared.exe"),
  (Join-Path $env:ProgramFiles "cloudflared\cloudflared.exe")
)
$cloudflared = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $cloudflared) {
  $command = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($command) { $cloudflared = $command.Source }
}

if (-not $cloudflared) {
  throw "cloudflared is not installed. Run: npm run media:setup"
}

if (Test-Path $urlFile) { Remove-Item $urlFile -Force }

Write-Host ""
Write-Host "Cloudflare Quick Tunnel" -ForegroundColor Cyan
Write-Host "  target   $Target"
Write-Host "  url file $urlFile"
Write-Host "  logs     $logFile"
Write-Host ""
Write-Host "Quick Tunnel URLs are public and rotate when this process restarts." -ForegroundColor DarkGray
Write-Host "Press Ctrl+C to close the tunnel." -ForegroundColor DarkGray
Write-Host ""

$foundUrl = $false
$previousErrorAction = $ErrorActionPreference
# Windows PowerShell turns native stderr into terminating errors when
# ErrorActionPreference is Stop. cloudflared logs to stderr, so relax it while
# the tunnel runs and merge both streams into the log/URL watcher below.
$ErrorActionPreference = "Continue"
try {
  & $cloudflared tunnel --url $Target --no-autoupdate 2>&1 | ForEach-Object {
    $line = "$_"
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding utf8
    if (-not $foundUrl -and $line -match "https://[a-z0-9-]+\.trycloudflare\.com") {
      $foundUrl = $true
      $publicUrl = $Matches[0]
      Set-Content -Path $urlFile -Value $publicUrl -NoNewline -Encoding utf8
      Write-Host ""
      Write-Host "Public URL: $publicUrl" -ForegroundColor Green
      Write-Host "Open the studio through this URL so camera permissions get a secure origin." -ForegroundColor Green
      Write-Host ""
    }
  }
} finally {
  $ErrorActionPreference = $previousErrorAction
  if (Test-Path $urlFile) { Remove-Item $urlFile -Force -ErrorAction SilentlyContinue }
  Write-Host "Tunnel closed." -ForegroundColor DarkGray
}
