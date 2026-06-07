param(
  [int]$Port = 4321,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$url = "http://127.0.0.1:$Port/"
$server = $null

function Stop-PortProcess {
  param([int]$TargetPort)

  $connections = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue
  $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique

  foreach ($processId in $pids) {
    if ($processId -and $processId -ne $PID) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
  }
}

function Wait-ForServer {
  param(
    [string]$TargetUrl,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $TargetUrl -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  throw "Local server did not respond at $TargetUrl within $TimeoutSeconds seconds."
}

function Get-BrowserCommand {
  $edge = @(
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:LocalAppData\Microsoft\Edge\Application\msedge.exe"
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

  if ($edge) {
    return @{
      Path = $edge
      Args = @("--app=$url", "--user-data-dir=$env:TEMP\mynoteweb-edge-profile-$Port")
    }
  }

  $chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

  if ($chrome) {
    return @{
      Path = $chrome
      Args = @("--app=$url", "--user-data-dir=$env:TEMP\mynoteweb-chrome-profile-$Port")
    }
  }

  return $null
}

try {
  Set-Location $root

  if (-not (Test-Path "node_modules\astro")) {
    throw "Dependencies are missing. Run npm install first."
  }

  if ($DryRun) {
    Write-Host "Root: $root"
    Write-Host "URL: $url"
    Write-Host "Command: npm run sync-static; node scripts\run-astro.mjs dev --host 127.0.0.1 --port $Port"
    return
  }

  Stop-PortProcess -TargetPort $Port

  npm run sync-static
  if ($LASTEXITCODE -ne 0) {
    throw "sync-static failed."
  }

  $server = Start-Process -FilePath "node.exe" `
    -ArgumentList @("scripts\run-astro.mjs", "dev", "--host", "127.0.0.1", "--port", "$Port") `
    -WorkingDirectory $root `
    -WindowStyle Minimized `
    -PassThru

  Wait-ForServer -TargetUrl $url

  $browser = Get-BrowserCommand
  if ($browser) {
    $browserProcess = Start-Process -FilePath $browser.Path -ArgumentList $browser.Args -Wait -PassThru
  } else {
    Start-Process $url
    Write-Host ""
    Write-Host "Browser opened with the system default browser."
    Write-Host "Close the browser tab, then press any key here to stop the local server."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
  }
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }

  Stop-PortProcess -TargetPort $Port
}
