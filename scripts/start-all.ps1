# One-command production-ish stack:
#   MediaMTX :8888/:8889  +  Next/API/signal :3000/:4000/:4001
#   Caddy :8080           +  Cloudflare Quick Tunnel (foreground)
#
# Requires: npm install, npm run media:setup, and a successful npm run build.
#
# Usage:
#   npm run up
#   powershell -ExecutionPolicy Bypass -File scripts/start-all.ps1 -SkipBuild

[CmdletBinding()]
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-Port([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(250)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Start-StackWindow([string]$Title, [string]$ScriptPath) {
  Write-Host "Starting $Title in a new window..." -ForegroundColor Cyan
  $arguments = "-NoExit -ExecutionPolicy Bypass -File `"$ScriptPath`""
  Start-Process -FilePath "powershell.exe" -ArgumentList $arguments | Out-Null
}

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------
if (-not (Test-Path (Join-Path $root "node_modules"))) {
  Write-Host "Installing npm dependencies..." -ForegroundColor Cyan
  npm install
}

if (-not (Test-Path (Join-Path $root ".tools\mediamtx\mediamtx.exe")) -or
    -not (Test-Path (Join-Path $root ".tools\caddy\caddy.exe"))) {
  Write-Host "Media toolchain missing; running setup..." -ForegroundColor Cyan
  & (Join-Path $PSScriptRoot "setup-media.ps1")
}

if (-not (Test-Path (Join-Path $root ".env"))) {
  Write-Host "Creating .env with fresh local secrets..." -ForegroundColor Cyan
  function New-Secret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
      $rng.GetBytes($bytes)
    } finally {
      $rng.Dispose()
    }
    return [Convert]::ToBase64String($bytes)
  }
  $envBody = @"
COOKIE_SECRET=$(New-Secret)
PLAYBACK_SECRET=$(New-Secret)
INTERNAL_SECRET=$(New-Secret)
"@
  $envPath = Join-Path $root ".env"
  [System.IO.File]::WriteAllText($envPath, $envBody, (New-Object System.Text.UTF8Encoding($false)))
}

if (-not $SkipBuild) {
  Write-Host "Building the web app..." -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Build failed." }
} else {
  Write-Host "Skipping build (-SkipBuild)." -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# Start only what is not already listening
# ---------------------------------------------------------------------------
if (-not (Test-Port 8889) -or -not (Test-Port 8888)) {
  Start-StackWindow "MeshStream Media" (Join-Path $PSScriptRoot "start-media.ps1")
  Start-Sleep -Seconds 2
} else {
  Write-Host "MediaMTX already listening on :8888/:8889" -ForegroundColor DarkGray
}

if (-not (Test-Port 3000) -or -not (Test-Port 4000) -or -not (Test-Port 4001)) {
  Start-StackWindow "MeshStream App" (Join-Path $PSScriptRoot "run-app.ps1")
} else {
  Write-Host "Web/API/signal already listening on :3000/:4000/:4001" -ForegroundColor DarkGray
}

if (-not (Test-Port 8080)) {
  Start-StackWindow "MeshStream Caddy" (Join-Path $PSScriptRoot "run-caddy.ps1")
  Start-Sleep -Seconds 2
} else {
  Write-Host "Caddy already listening on :8080" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# Wait for the local origin to answer
# ---------------------------------------------------------------------------
Write-Host ""
$ready = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:8080/api/health" -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      $ready = $true
      break
    }
  } catch {
    Start-Sleep -Milliseconds 800
  }
}

if (-not $ready) {
  Write-Warning "Caddy did not answer on http://localhost:8080. Check the app and Caddy windows."
} else {
  Write-Host "Local origin ready: http://localhost:8080" -ForegroundColor Green
  Write-Host "Media health:       http://localhost:8080/api/media/health" -ForegroundColor Green
}

Write-Host ""
& (Join-Path $PSScriptRoot "start-tunnel.ps1") -Target "http://localhost:8080"
