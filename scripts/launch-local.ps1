param(
  [int]$Port = 4321,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$url = "http://127.0.0.1:$Port/"
$server = $null
$serverStdout = Join-Path $env:TEMP "mynoteweb-astro-$Port.out.log"
$serverStderr = Join-Path $env:TEMP "mynoteweb-astro-$Port.err.log"

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
    [System.Diagnostics.Process]$ServerProcess,
    [string]$StdoutPath,
    [string]$StderrPath,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ($ServerProcess -and $ServerProcess.HasExited) {
      $log = @()
      if ($StdoutPath -and (Test-Path -LiteralPath $StdoutPath)) {
        $log += "---- stdout ----"
        $log += Get-Content -LiteralPath $StdoutPath -ErrorAction SilentlyContinue
      }
      if ($StderrPath -and (Test-Path -LiteralPath $StderrPath)) {
        $log += "---- stderr ----"
        $log += Get-Content -LiteralPath $StderrPath -ErrorAction SilentlyContinue
      }
      throw "Local server exited before responding at $TargetUrl.`n$($log -join [Environment]::NewLine)"
    }

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

function Wait-ForStopKey {
  Write-Host ""
  Write-Host "Local server is running at $url"
  Write-Host "Press any key in this window to stop the local server."
  $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
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
  Remove-Item -LiteralPath $serverStdout, $serverStderr -Force -ErrorAction SilentlyContinue

  npm run sync-static
  if ($LASTEXITCODE -ne 0) {
    throw "sync-static failed."
  }

  $server = Start-Process -FilePath "node.exe" `
    -ArgumentList @("scripts\run-astro.mjs", "dev", "--host", "127.0.0.1", "--port", "$Port") `
    -WorkingDirectory $root `
    -WindowStyle Minimized `
    -RedirectStandardOutput $serverStdout `
    -RedirectStandardError $serverStderr `
    -PassThru

  Wait-ForServer -TargetUrl $url -ServerProcess $server -StdoutPath $serverStdout -StderrPath $serverStderr

  $browser = Get-BrowserCommand
  if ($browser) {
    Start-Process -FilePath $browser.Path -ArgumentList $browser.Args | Out-Null
  } else {
    Start-Process $url
    Write-Host "Browser opened with the system default browser."
  }

  Wait-ForStopKey
} catch {
  Write-Host ""
  Write-Host "run-local failed:" -ForegroundColor Red
  Write-Host $_.Exception.Message
  Write-Host ""
  Write-Host "Press any key to close this window."
  $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
  exit 1
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }

  Stop-PortProcess -TargetPort $Port
}
