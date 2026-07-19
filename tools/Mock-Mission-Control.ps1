[CmdletBinding()]
param(
    [ValidateSet("menu", "start", "restart", "stop", "status", "open", "logs")]
    [string]$Action = "menu",

    [ValidateSet("cycle", "flight", "editor", "inactive")]
    [string]$Scene = "cycle",

    [switch]$NoBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$serverScript = Join-Path $PSScriptRoot "mock_mission_control_server.py"
$stateRoot = Join-Path $PSScriptRoot ".mock"
$pidFile = Join-Path $stateRoot "server.pid"
$startTimeFile = Join-Path $stateRoot "server.start-time"
$sceneFile = Join-Path $stateRoot "server.scene"
$outputLog = Join-Path $stateRoot "server.output.log"
$errorLog = Join-Path $stateRoot "server.error.log"
$dashboardUrl = "http://127.0.0.1:8090/"
$statusUrl = "http://127.0.0.1:8090/__mock/status"

function Remove-StaleState {
    Remove-Item -LiteralPath $pidFile, $startTimeFile, $sceneFile -Force -ErrorAction SilentlyContinue
}

function Get-ManagedProcess {
    if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
    $rawPid = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    $processId = 0
    if (-not [int]::TryParse($rawPid, [ref]$processId)) {
        Remove-StaleState
        return $null
    }
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $process) {
        Remove-StaleState
        return $null
    }
    $savedTicks = 0L
    $rawTicks = if (Test-Path -LiteralPath $startTimeFile) {
        (Get-Content -LiteralPath $startTimeFile -Raw).Trim()
    } else { "" }
    $actualTicks = try { $process.StartTime.ToUniversalTime().Ticks } catch { 0L }
    if (-not [long]::TryParse($rawTicks, [ref]$savedTicks) -or
            $savedTicks -ne $actualTicks -or $process.ProcessName -ne "python") {
        Write-Warning "The saved mock-server PID no longer identifies the Python process started by this tool. It will not be stopped."
        Remove-StaleState
        return $null
    }
    return $process
}

function Get-MockStatus {
    try {
        return Invoke-RestMethod -Uri $statusUrl -TimeoutSec 1
    } catch {
        return $null
    }
}

function Test-LoopbackPortOpen {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $connection = $client.ConnectAsync("127.0.0.1", 8090)
        return $connection.Wait(300) -and $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Show-Logs {
    foreach ($path in @($outputLog, $errorLog)) {
        if (Test-Path -LiteralPath $path) {
            Write-Host ""
            Write-Host "--- $(Split-Path -Leaf $path) ---" -ForegroundColor Cyan
            Get-Content -LiteralPath $path -Tail 40
        }
    }
}

function Resolve-Python {
    $localPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $localPython -PathType Leaf) {
        return $localPython
    }
    throw "The repository's .venv is missing. Run 'Start KSP Dashboard.bat --setup-only' once, then try again."
}

function Resolve-WebRoot {
    foreach ($path in @((Join-Path $repoRoot "web"), (Join-Path $repoRoot "frontend\dist"))) {
        if (Test-Path -LiteralPath (Join-Path $path "index.html") -PathType Leaf) {
            return $path
        }
    }
    throw "Compiled dashboard files are missing. Run tools\Build-Frontend.ps1 -StageRuntimeWeb first."
}

function ConvertTo-ProcessArgument {
    param([string]$Value)
    if ($Value -notmatch '[\s"]') { return $Value }
    $builder = [System.Text.StringBuilder]::new()
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') {
            $backslashes += 1
            continue
        }
        if ($character -eq '"') {
            [void]$builder.Append(('\' * ($backslashes * 2 + 1)))
            [void]$builder.Append('"')
        } else {
            if ($backslashes -gt 0) { [void]$builder.Append(('\' * $backslashes)) }
            [void]$builder.Append($character)
        }
        $backslashes = 0
    }
    if ($backslashes -gt 0) { [void]$builder.Append(('\' * ($backslashes * 2))) }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Stop-MockServer {
    $process = Get-ManagedProcess
    if (-not $process) {
        Write-Host "Mock Mission Control is not running."
        if (Get-MockStatus) {
            Write-Warning "Port 8090 is serving a mock endpoint, but it is not owned by this tool's saved process."
        }
        return
    }
    Write-Host "Stopping Mock Mission Control (PID $($process.Id))..."
    Stop-Process -Id $process.Id -Force
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 100
    }
    if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
        throw "The managed mock server did not stop."
    }
    Remove-StaleState
    Write-Host "Mock Mission Control stopped." -ForegroundColor Green
}

function Start-MockServer {
    param(
        [string]$SelectedScene,
        [switch]$OpenBrowser
    )

    $existing = Get-ManagedProcess
    $status = Get-MockStatus
    if ($existing -and $status) {
        $runningScene = if (Test-Path -LiteralPath $sceneFile) {
            (Get-Content -LiteralPath $sceneFile -Raw).Trim()
        } else { "unknown" }
        Write-Host "Mock Mission Control is already running (PID $($existing.Id), scene $runningScene)."
        if ($OpenBrowser) { Start-Process $dashboardUrl }
        return
    }
    if ($existing) {
        Write-Host "Removing an unresponsive managed mock process..."
        Stop-MockServer
    } elseif ($status) {
        throw "Port 8090 already has a mock server that is not owned by this controller. Stop it before continuing."
    } elseif (Test-LoopbackPortOpen) {
        throw "Port 8090 is already in use. Stop the real Mission Control dashboard feed before starting mock telemetry."
    }

    $python = Resolve-Python
    $webRoot = Resolve-WebRoot
    if (-not (Test-Path -LiteralPath $serverScript -PathType Leaf)) {
        throw "Mock server script is missing: $serverScript"
    }
    $scenes = switch ($SelectedScene) {
        "flight" { "flight" }
        "editor" { "editor" }
        "inactive" { "inactive" }
        default { "flight,editor,inactive" }
    }

    New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
    Remove-Item -LiteralPath $outputLog, $errorLog -Force -ErrorAction SilentlyContinue
    Write-Host "Starting Mock Mission Control ($SelectedScene)..."
    $arguments = @(
        "-u", $serverScript,
        "--host", "127.0.0.1",
        "--port", "8090",
        "--scenes", $scenes,
        "--web-root", $webRoot,
        "--output-log", $outputLog,
        "--error-log", $errorLog
    )
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $python
    $startInfo.Arguments = (($arguments | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join ' ')
    $startInfo.WorkingDirectory = $repoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "Windows did not start the mock telemetry process."
    }
    Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ascii
    Set-Content -LiteralPath $startTimeFile -Value $process.StartTime.ToUniversalTime().Ticks -Encoding ascii
    Set-Content -LiteralPath $sceneFile -Value $SelectedScene -Encoding ascii

    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($process.HasExited) { break }
        if (Get-MockStatus) {
            Write-Host "Mock Mission Control is ready: $dashboardUrl" -ForegroundColor Green
            if ($SelectedScene -eq "cycle") {
                Write-Host "Scenes change every 15 seconds: Flight -> VAB/SPH -> Mission Control."
            }
            if ($OpenBrowser) { Start-Process $dashboardUrl }
            return
        }
        Start-Sleep -Milliseconds 250
        $process.Refresh()
    }

    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-StaleState
    Show-Logs
    throw "Mock Mission Control did not become ready."
}

function Show-Status {
    $process = Get-ManagedProcess
    $status = Get-MockStatus
    if ($process -and $status) {
        $scene = (Get-Content -LiteralPath $sceneFile -Raw).Trim()
        Write-Host "Mock Mission Control is running (PID $($process.Id), scene $scene)." -ForegroundColor Green
        Write-Host $dashboardUrl
    } elseif ($process) {
        Write-Warning "The managed process exists but is not responding."
    } else {
        Write-Host "Mock Mission Control is not running."
    }
}

function Switch-Scene {
    param(
        [string]$SelectedScene,
        [switch]$SuppressBrowser
    )
    if (Get-ManagedProcess) { Stop-MockServer }
    Start-MockServer -SelectedScene $SelectedScene -OpenBrowser:(-not $SuppressBrowser)
}

function Show-Menu {
    while ($true) {
        Write-Host ""
        Write-Host "Woobie's Mission Control - Mock Telemetry" -ForegroundColor Cyan
        Write-Host "  1. Flight dashboard"
        Write-Host "  2. VAB/SPH dashboard"
        Write-Host "  3. Mission Control dashboard"
        Write-Host "  4. Cycle all scenes every 15 seconds"
        Write-Host "  5. Open current dashboard"
        Write-Host "  6. Status"
        Write-Host "  7. Stop mock server"
        Write-Host "  8. Show logs"
        Write-Host "  9. Exit this menu"
        $choice = (Read-Host "Select").Trim()
        try {
            switch ($choice) {
                "1" { Switch-Scene "flight" }
                "2" { Switch-Scene "editor" }
                "3" { Switch-Scene "inactive" }
                "4" { Switch-Scene "cycle" }
                "5" { if (Get-MockStatus) { Start-Process $dashboardUrl } else { Write-Warning "Start the mock server first." } }
                "6" { Show-Status }
                "7" { Stop-MockServer }
                "8" { Show-Logs }
                "9" { return }
                default { Write-Warning "Enter a number from 1 through 9." }
            }
        } catch {
            Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

switch ($Action) {
    "menu" { Show-Menu }
    "start" { Start-MockServer -SelectedScene $Scene -OpenBrowser:(-not $NoBrowser) }
    "restart" { Switch-Scene -SelectedScene $Scene -SuppressBrowser:$NoBrowser }
    "stop" { Stop-MockServer }
    "status" { Show-Status }
    "open" { if (Get-MockStatus) { Start-Process $dashboardUrl } else { Start-MockServer -SelectedScene $Scene -OpenBrowser } }
    "logs" { Show-Logs }
}
