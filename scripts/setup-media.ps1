# MeshStream media toolchain bootstrap.
# Downloads MediaMTX (WHIP + LL-HLS) and Caddy (single origin) into .tools/.
# Cloudflared is optional; an existing installation is reused when present.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/setup-media.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/setup-media.ps1 -Force

[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $root ".tools"
$data = Join-Path $root "data"

New-Item -ItemType Directory -Force -Path $tools, $data | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $data "recordings") | Out-Null

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step([string]$message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Get-ReleaseAssetUrl {
  param(
    [Parameter(Mandatory = $true)][string]$Repository,
    [Parameter(Mandatory = $true)][string]$Pattern
  )

  $headers = @{
    "User-Agent" = "meshstream-setup"
    "Accept"     = "application/vnd.github+json"
  }
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/latest" -Headers $headers
  $asset = $release.assets |
    Where-Object { $_.name -match $Pattern } |
    Select-Object -First 1
  if (-not $asset) {
    throw "Could not find a Windows amd64 asset for $Repository (pattern: $Pattern)."
  }
  return $asset.browser_download_url
}

function Download-File {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Destination
  )
  Write-Host "    download $Url"
  Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
}

function Expand-Zip {
  param(
    [Parameter(Mandatory = $true)][string]$Zip,
    [Parameter(Mandatory = $true)][string]$Destination
  )
  if (Test-Path $Destination) {
    Remove-Item -Recurse -Force $Destination
  }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Expand-Archive -Path $Zip -DestinationPath $Destination -Force
}

# ---------------------------------------------------------------------------
# MediaMTX
# ---------------------------------------------------------------------------
$mediamtxExe = Join-Path $tools "mediamtx\mediamtx.exe"
if ($Force -or -not (Test-Path $mediamtxExe)) {
  Write-Step "MediaMTX"
  $zip = Join-Path $tools "mediamtx.zip"
  $url = Get-ReleaseAssetUrl -Repository "bluenviron/mediamtx" -Pattern "^mediamtx_.*_windows_amd64\.zip$"
  Download-File -Url $url -Destination $zip
  Expand-Zip -Zip $zip -Destination (Join-Path $tools "mediamtx")
  Remove-Item $zip -Force
  if (-not (Test-Path $mediamtxExe)) {
    throw "MediaMTX archive did not contain mediamtx.exe."
  }
  Write-Host "    installed .tools\mediamtx\mediamtx.exe" -ForegroundColor Green
} else {
  Write-Host "MediaMTX already installed (use -Force to update)." -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# Caddy
# ---------------------------------------------------------------------------
$caddyExe = Join-Path $tools "caddy\caddy.exe"
if ($Force -or -not (Test-Path $caddyExe)) {
  Write-Step "Caddy"
  $zip = Join-Path $tools "caddy.zip"
  $url = Get-ReleaseAssetUrl -Repository "caddyserver/caddy" -Pattern "^caddy_.*_windows_amd64\.zip$"
  Download-File -Url $url -Destination $zip
  Expand-Zip -Zip $zip -Destination (Join-Path $tools "caddy")
  Remove-Item $zip -Force
  if (-not (Test-Path $caddyExe)) {
    throw "Caddy archive did not contain caddy.exe."
  }
  Write-Host "    installed .tools\caddy\caddy.exe" -ForegroundColor Green
} else {
  Write-Host "Caddy already installed (use -Force to update)." -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# cloudflared (optional but required for a public free URL)
# ---------------------------------------------------------------------------
$cloudflaredExe = Join-Path $tools "cloudflared.exe"
$systemCloudflared = Join-Path ${env:ProgramFiles(x86)} "cloudflared\cloudflared.exe"
if ($Force -or (-not (Test-Path $cloudflaredExe) -and -not (Test-Path $systemCloudflared))) {
  Write-Step "cloudflared"
  $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
  Download-File -Url $url -Destination $cloudflaredExe
  Write-Host "    installed .tools\cloudflared.exe" -ForegroundColor Green
} elseif (Test-Path $cloudflaredExe) {
  Write-Host "cloudflared already installed (use -Force to update)." -ForegroundColor DarkGray
} else {
  Write-Host "Using system cloudflared at $systemCloudflared" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# Verify binaries
# ---------------------------------------------------------------------------
Write-Step "Versions"
& $mediamtxExe --version
& $caddyExe version

$cloudflared = if (Test-Path $cloudflaredExe) { $cloudflaredExe } elseif (Test-Path $systemCloudflared) { $systemCloudflared } else { $null }
if ($cloudflared) {
  & $cloudflared --version
}

Write-Host ""
Write-Host "Toolchain ready." -ForegroundColor Green
Write-Host "Next:"
Write-Host "  1. Copy .env.example to .env and change COOKIE_SECRET / PLAYBACK_SECRET / INTERNAL_SECRET."
Write-Host "  2. npm run dev"
Write-Host "  3. npm run media:start   (in a second terminal)"
Write-Host "  4. Open http://localhost:3000"
Write-Host ""
Write-Host "For a production-style single origin:"
Write-Host "  npm run build; npm run up"
