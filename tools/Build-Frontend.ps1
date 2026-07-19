[CmdletBinding()]
param(
    [switch]$InstallDependencies,
    [switch]$SkipTests,
    [switch]$StageRuntimeWeb
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-CheckedCommand {
    param(
        [string]$Command,
        [string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $Command $($Arguments -join ' ')"
    }
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$frontendRoot = Join-Path $repoRoot "frontend"
$packageFile = Join-Path $frontendRoot "package.json"
$lockFile = Join-Path $frontendRoot "pnpm-lock.yaml"
$nodeModules = Join-Path $frontendRoot "node_modules"
$distRoot = Join-Path $frontendRoot "dist"

foreach ($required in @($packageFile, $lockFile)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Frontend input is missing: $required"
    }
}

$pnpm = Get-Command "pnpm.cmd" -ErrorAction SilentlyContinue
if (-not $pnpm) {
    $pnpm = Get-Command "pnpm" -ErrorAction SilentlyContinue
}
if (-not $pnpm) {
    throw "pnpm was not found. Install Node.js and enable pnpm with Corepack before building the dashboard."
}

Push-Location $frontendRoot
try {
    if ($InstallDependencies -or -not (Test-Path -LiteralPath $nodeModules -PathType Container)) {
        Write-Host "Installing the locked frontend dependencies..." -ForegroundColor Cyan
        Invoke-CheckedCommand -Command $pnpm.Source -Arguments @("install", "--frozen-lockfile")
    }

    if (-not $SkipTests) {
        Write-Host "Running frontend tests..." -ForegroundColor Cyan
        Invoke-CheckedCommand -Command $pnpm.Source -Arguments @("test")
    }

    Write-Host "Type-checking and building the production dashboard..." -ForegroundColor Cyan
    Invoke-CheckedCommand -Command $pnpm.Source -Arguments @("build")
}
finally {
    Pop-Location
}

$indexPath = Join-Path $distRoot "index.html"
if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) {
    throw "Vite completed without producing $indexPath"
}

$javascriptFiles = @(Get-ChildItem -LiteralPath (Join-Path $distRoot "assets") -Filter "*.js" -File)
if ($javascriptFiles.Count -eq 0) {
    throw "Production dashboard contains no JavaScript bundle."
}
$bundleText = $javascriptFiles |
    ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw } |
    Out-String
foreach ($forbidden in @(
    "deterministic fixtures",
    "React POC controls",
    "React flight dashboard POC",
    "Crew reports nominal systems.",
    "Dual-condition regression craft",
    "React proof of concept",
    "React dashboard · v0.3.0 WIP"
)) {
    if ($bundleText.Contains($forbidden)) {
        throw "Production dashboard contains development-only text: $forbidden"
    }
}

$indexText = Get-Content -LiteralPath $indexPath -Raw
if ($indexText -match '(?i)proof of concept|\bWIP\b') {
    throw "Production dashboard title still contains a development label."
}

if ($StageRuntimeWeb) {
    $runtimeWeb = Join-Path $repoRoot "web"
    if (Test-Path -LiteralPath $runtimeWeb) {
        Remove-Item -LiteralPath $runtimeWeb -Recurse -Force
    }
    New-Item -ItemType Directory -Path $runtimeWeb -Force | Out-Null
    Copy-Item -Path (Join-Path $distRoot "*") -Destination $runtimeWeb -Recurse -Force
    Write-Host "Runtime web assets staged for the source launcher: $runtimeWeb" -ForegroundColor Green
}

Write-Host "Frontend build verified: $distRoot" -ForegroundColor Green
