[CmdletBinding()]
param(
    [ValidateSet("start", "open", "stop", "restart", "status", "logs")]
    [string]$Action = "start"
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$FrontendRoot = Join-Path $ProjectRoot "frontend"
$ViteEntry = Join-Path $FrontendRoot "node_modules\vite\bin\vite.js"
$StateRoot = Join-Path $FrontendRoot ".dev"
$PidFile = Join-Path $StateRoot "vite.pid"
$StartTimeFile = Join-Path $StateRoot "vite.start-time"
$OutputLog = Join-Path $StateRoot "vite.output.log"
$ErrorLog = Join-Path $StateRoot "vite.error.log"
$DashboardUrl = "http://127.0.0.1:5173/"

function Test-DashboardReady {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $DashboardUrl -TimeoutSec 1
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

function Remove-StalePidFile {
    Remove-Item -LiteralPath $PidFile, $StartTimeFile -Force -ErrorAction SilentlyContinue
}

function Get-ManagedViteProcess {
    if (-not (Test-Path -LiteralPath $PidFile)) {
        return $null
    }

    $rawPid = (Get-Content -LiteralPath $PidFile -Raw).Trim()
    $processId = 0
    if (-not [int]::TryParse($rawPid, [ref]$processId)) {
        Remove-StalePidFile
        return $null
    }

    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $process) {
        Remove-StalePidFile
        return $null
    }

    $rawStartTime = if (Test-Path -LiteralPath $StartTimeFile) {
        (Get-Content -LiteralPath $StartTimeFile -Raw).Trim()
    }
    else {
        ""
    }
    $savedStartTime = 0L
    $actualStartTime = try { $process.StartTime.ToUniversalTime().Ticks } catch { 0L }
    $startTimeMatches = [long]::TryParse($rawStartTime, [ref]$savedStartTime) -and
        $savedStartTime -eq $actualStartTime
    $isNode = $process.ProcessName -eq "node"

    if (-not $isNode -or -not $startTimeMatches) {
        Write-Warning "The saved PID no longer matches the Node process started by this launcher; it will not be stopped."
        Remove-StalePidFile
        return $null
    }

    return $process
}

function Show-RecentLogs {
    foreach ($logPath in @($OutputLog, $ErrorLog)) {
        if (Test-Path -LiteralPath $logPath) {
            Write-Host ""
            Write-Host "--- $(Split-Path -Leaf $logPath) ---"
            Get-Content -LiteralPath $logPath -Tail 30
        }
    }
}

function Start-ViteServer {
    param([switch]$OpenBrowser)

    $existing = Get-ManagedViteProcess
    if ($existing -and (Test-DashboardReady)) {
        Write-Host "Dashboard development server is already running (PID $($existing.Id))."
        Write-Host $DashboardUrl
        if ($OpenBrowser) {
            Start-Process $DashboardUrl
        }
        return
    }

    if ($existing) {
        Write-Host "Removing an unresponsive dashboard development process (PID $($existing.Id))..."
        Stop-Process -Id $existing.Id -Force
        for ($attempt = 0; $attempt -lt 25; $attempt++) {
            if (-not (Get-Process -Id $existing.Id -ErrorAction SilentlyContinue)) { break }
            Start-Sleep -Milliseconds 100
        }
        Remove-StalePidFile
    }

    if (-not (Test-Path -LiteralPath $ViteEntry)) {
        throw "Vite dependencies are missing. Open a terminal in '$FrontendRoot' and run 'pnpm install' first."
    }

    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        throw "Node.js was not found on PATH. Install Node.js, then run this launcher again."
    }

    New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
    Remove-Item -LiteralPath $OutputLog, $ErrorLog -Force -ErrorAction SilentlyContinue

    Write-Host "Starting dashboard development server..."
    $process = Start-Process `
        -FilePath $nodeCommand.Source `
        -ArgumentList @($ViteEntry, "--host", "127.0.0.1") `
        -WorkingDirectory $FrontendRoot `
        -RedirectStandardOutput $OutputLog `
        -RedirectStandardError $ErrorLog `
        -WindowStyle Hidden `
        -PassThru

    Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ascii
    Set-Content -LiteralPath $StartTimeFile -Value $process.StartTime.ToUniversalTime().Ticks -Encoding ascii

    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($process.HasExited) { break }
        if (Test-DashboardReady) {
            Write-Host "Dashboard development server is running (PID $($process.Id))."
            Write-Host $DashboardUrl
            if ($OpenBrowser) {
                Start-Process $DashboardUrl
            }
            return
        }
        Start-Sleep -Milliseconds 250
        $process.Refresh()
    }

    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-StalePidFile
    Show-RecentLogs
    throw "Vite did not become ready. The log files are in '$StateRoot'."
}

function Stop-ViteServer {
    $process = Get-ManagedViteProcess
    if (-not $process) {
        Write-Host "Dashboard development server is not running."
        if (Test-DashboardReady) {
            Write-Warning "Port 5173 is responding, but it is not owned by this launcher's saved process."
        }
        return
    }

    Write-Host "Stopping dashboard development server (PID $($process.Id))..."
    Stop-Process -Id $process.Id -Force
    for ($attempt = 0; $attempt -lt 25; $attempt++) {
        if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 100
    }

    if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
        throw "The dashboard development process did not stop."
    }

    Remove-StalePidFile
    Write-Host "Dashboard development server stopped."
}

switch ($Action.ToLowerInvariant()) {
    "start"   { Start-ViteServer }
    "open"    { Start-ViteServer -OpenBrowser }
    "stop"    { Stop-ViteServer }
    "restart" { Stop-ViteServer; Start-ViteServer -OpenBrowser }
    "status"  {
        $process = Get-ManagedViteProcess
        if ($process -and (Test-DashboardReady)) {
            Write-Host "Dashboard development server is running (PID $($process.Id))."
            Write-Host $DashboardUrl
        }
        elseif ($process) {
            Write-Warning "Dashboard development process $($process.Id) exists but is not responding."
            exit 2
        }
        else {
            Write-Host "Dashboard development server is not running."
            exit 1
        }
    }
    "logs"    { Show-RecentLogs }
}
