# Optional: run MeshStream at Windows logon with Scheduled Tasks.
# This is the free, no-extra-service-manager equivalent of systemd units.
#
# Usage (PowerShell, normal user is usually enough):
#   powershell -ExecutionPolicy Bypass -File scripts/install-services.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/install-services.ps1 -IncludeTunnel
#   powershell -ExecutionPolicy Bypass -File scripts/install-services.ps1 -Remove
#
# The tunnel task is opt-in because Quick Tunnel URLs rotate on restart.

[CmdletBinding()]
param(
  [switch]$Remove,
  [switch]$IncludeTunnel,
  [switch]$Start
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$taskNames = @("MeshStream-Media", "MeshStream-App", "MeshStream-Caddy")
if ($IncludeTunnel) { $taskNames += "MeshStream-Tunnel" }

if ($Remove) {
  foreach ($name in $taskNames) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($task) {
      Unregister-ScheduledTask -TaskName $name -Confirm:$false
      Write-Host "Removed $name" -ForegroundColor Yellow
    }
  }
  Write-Host "Scheduled tasks removed." -ForegroundColor Green
  return
}

if (-not (Test-Path (Join-Path $root "apps\web\.next\BUILD_ID"))) {
  throw "Build the app first: npm run build"
}
if (-not (Test-Path (Join-Path $root ".tools\mediamtx\mediamtx.exe"))) {
  throw "Missing MediaMTX. Run: npm run media:setup"
}
if (-not (Test-Path (Join-Path $root ".tools\caddy\caddy.exe"))) {
  throw "Missing Caddy. Run: npm run media:setup"
}

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

function Install-MeshTask {
  param(
    [string]$Name,
    [string]$Description,
    [string]$ScriptFile
  )

  $action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptFile`"" `
    -WorkingDirectory $root

  Register-ScheduledTask `
    -TaskName $Name `
    -Description $Description `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Force | Out-Null

  Write-Host "Installed $Name" -ForegroundColor Green
  if ($Start) {
    Start-ScheduledTask -TaskName $Name
    Write-Host "Started $Name" -ForegroundColor Cyan
  }
}

Install-MeshTask `
  -Name "MeshStream-Media" `
  -Description "MeshStream MediaMTX WHIP + LL-HLS origin" `
  -ScriptFile (Join-Path $PSScriptRoot "start-media.ps1")

Install-MeshTask `
  -Name "MeshStream-App" `
  -Description "MeshStream Next web, API and signal server" `
  -ScriptFile (Join-Path $PSScriptRoot "run-app.ps1")

Install-MeshTask `
  -Name "MeshStream-Caddy" `
  -Description "MeshStream Caddy single-origin proxy on :8080" `
  -ScriptFile (Join-Path $PSScriptRoot "run-caddy.ps1")

if ($IncludeTunnel) {
  Install-MeshTask `
    -Name "MeshStream-Tunnel" `
    -Description "MeshStream Cloudflare Quick Tunnel (rotating public URL)" `
    -ScriptFile (Join-Path $PSScriptRoot "start-tunnel.ps1")
}

Write-Host ""
Write-Host "Logon tasks installed. Logs: data\tunnel.log and the task windows (hidden)." -ForegroundColor Green
Write-Host "The public URL is written to data\tunnel-url.txt by the tunnel task."
