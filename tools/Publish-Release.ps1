[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,

    [string]$GameDataPath,

    [string]$OutputDirectory,

    [string]$Repository = 'SacredWoobie/woobies-mission-control',

    [string]$Target = 'main',

    [switch]$CreateDraftRelease
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Get-FullPath {
    param([string]$Path)
    return [System.IO.Path]::GetFullPath($Path)
}

function Assert-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found."
    }
}

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

function Assert-RequiredFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required file is missing: $Path"
    }
}

function Assert-SafeChildPath {
    param(
        [string]$Parent,
        [string]$Child
    )

    $separators = [char[]]@(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $parentFull = (Get-FullPath $Parent).TrimEnd($separators) + [System.IO.Path]::DirectorySeparatorChar
    $childFull = Get-FullPath $Child

    if (-not $childFull.StartsWith($parentFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the release output folder: $childFull"
    }
}

$repoRoot = Get-FullPath (Join-Path $PSScriptRoot '..')

if ([string]::IsNullOrWhiteSpace($GameDataPath)) {
    $documentsRoot = Split-Path $repoRoot -Parent
    $builderRoot = Join-Path $documentsRoot 'Woobies-KRPC-Service-Builder'
    $GameDataPath = Join-Path (Join-Path $builderRoot 'dist') 'GameData'
}
$GameDataPath = Get-FullPath $GameDataPath

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repoRoot 'release-output'
}
$OutputDirectory = Get-FullPath $OutputDirectory

$packageName = "Woobies-Mission-Control-v$Version"
$stageRoot = Join-Path $OutputDirectory $packageName
$zipPath = Join-Path $OutputDirectory "$packageName.zip"
$checksumPath = Join-Path $OutputDirectory "$packageName.zip.sha256"
$notesPath = Join-Path $OutputDirectory "release-notes-v$Version.md"

foreach ($path in @($stageRoot, $zipPath, $checksumPath, $notesPath)) {
    Assert-SafeChildPath -Parent $OutputDirectory -Child $path
}

$sourceFiles = @(
    @{ Source = 'Start KSP Dashboard.bat'; Destination = 'Dashboard/Start KSP Dashboard.bat' },
    @{ Source = 'ksp_dashboard_app.py'; Destination = 'Dashboard/ksp_dashboard_app.py' },
    @{ Source = 'ksp_mission_dashboard.html'; Destination = 'Dashboard/ksp_mission_dashboard.html' },
    @{ Source = 'panel_bridge.py'; Destination = 'Dashboard/panel_bridge.py' },
    @{ Source = 'requirements-dashboard.txt'; Destination = 'Dashboard/requirements-dashboard.txt' },
    @{ Source = 'requirements-panel.txt'; Destination = 'Dashboard/requirements-panel.txt' },
    @{ Source = 'requirements.txt'; Destination = 'Dashboard/requirements.txt' },
    @{ Source = 'telemetry_server.py'; Destination = 'Dashboard/telemetry_server.py' },
    @{ Source = 'LICENSE'; Destination = 'LICENSE' },
    @{ Source = 'README.md'; Destination = 'README.md' },
    @{ Source = 'docs/CONTROL_PAD_PROTOCOL.md'; Destination = 'docs/CONTROL_PAD_PROTOCOL.md' },
    @{ Source = 'docs/images/dashboard-overview.png'; Destination = 'docs/images/dashboard-overview.png' },
    @{ Source = 'docs/images/docking-alignment.png'; Destination = 'docs/images/docking-alignment.png' },
    @{ Source = 'docs/images/science-and-staging.png'; Destination = 'docs/images/science-and-staging.png' },
    @{ Source = 'docs/images/thermal-and-electricity.png'; Destination = 'docs/images/thermal-and-electricity.png' },
    @{ Source = 'firmware/KSP_control.ino'; Destination = 'firmware/KSP_control.ino' }
)

$dllFiles = @(
    @{ Source = 'KRPC.StageStats/KRPC.StageStats.dll'; Destination = 'GameData/KRPC.StageStats/KRPC.StageStats.dll' },
    @{ Source = 'KRPC.SystemHeat/KRPC.SystemHeat.dll'; Destination = 'GameData/KRPC.SystemHeat/KRPC.SystemHeat.dll' },
    @{ Source = 'KRPC.VesselScience/KRPC.VesselScience.dll'; Destination = 'GameData/KRPC.VesselScience/KRPC.VesselScience.dll' }
)

Write-Step 'Checking release inputs'
foreach ($file in $sourceFiles) {
    Assert-RequiredFile (Join-Path $repoRoot $file.Source)
}
foreach ($file in $dllFiles) {
    Assert-RequiredFile (Join-Path $GameDataPath $file.Source)
}

$readme = Get-Content -LiteralPath (Join-Path $repoRoot 'README.md') -Raw
$dashboardApp = Get-Content -LiteralPath (Join-Path $repoRoot 'ksp_dashboard_app.py') -Raw
$dashboardHtml = Get-Content -LiteralPath (Join-Path $repoRoot 'ksp_mission_dashboard.html') -Raw
$changelog = Get-Content -LiteralPath (Join-Path $repoRoot 'CHANGELOG.md') -Raw

if ($readme -notmatch [regex]::Escape("Current release: **v$Version**")) {
    throw "README.md does not identify v$Version as the current release."
}
if ($dashboardApp -notmatch [regex]::Escape("APP_VERSION = `"$Version`"")) {
    throw "ksp_dashboard_app.py does not identify v$Version."
}
if ($dashboardHtml -notmatch [regex]::Escape("Mission Control v$Version")) {
    throw "ksp_mission_dashboard.html does not identify v$Version."
}
if ($changelog -notmatch "(?m)^## v$([regex]::Escape($Version))(?:\s|$)") {
    throw "CHANGELOG.md does not contain a v$Version section."
}

if ($CreateDraftRelease) {
    Write-Step 'Checking Git and GitHub release prerequisites'
    Assert-Command 'git'
    Assert-Command 'gh'

    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.git'))) {
        throw 'Draft releases must be created from a Git checkout.'
    }

    $branch = (& git -C $repoRoot branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or $branch -ne $Target) {
        throw "Draft releases must be created from the '$Target' branch. Current branch: '$branch'."
    }

    $status = (& git -C $repoRoot status --porcelain)
    if ($LASTEXITCODE -ne 0 -or $status) {
        throw 'The Git working tree is not clean. Commit, stash, or remove local changes first.'
    }

    Invoke-CheckedCommand -Command 'git' -Arguments @('-C', $repoRoot, 'fetch', 'origin', $Target, '--quiet')
    $head = (& git -C $repoRoot rev-parse 'HEAD').Trim()
    $remoteHead = (& git -C $repoRoot rev-parse "origin/$Target").Trim()
    if ($LASTEXITCODE -ne 0 -or $head -ne $remoteHead) {
        throw "The local '$Target' branch is not up to date with origin/$Target. Pull the latest changes first."
    }

    Invoke-CheckedCommand -Command 'gh' -Arguments @('auth', 'status', '--hostname', 'github.com')

    & gh release view "v$Version" --repo $Repository *> $null
    if ($LASTEXITCODE -eq 0) {
        throw "A GitHub Release for v$Version already exists."
    }

    $remoteTag = [string](& git -C $repoRoot ls-remote --tags origin "refs/tags/v$Version")
    $remoteTag = $remoteTag.Trim()
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to check the remote release tag.'
    }
    if ($remoteTag) {
        throw "The tag v$Version already exists on the remote."
    }
}

Write-Step 'Assembling an allowlisted release package'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

if (Test-Path -LiteralPath $stageRoot) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
foreach ($path in @($zipPath, $checksumPath, $notesPath)) {
    if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Force
    }
}
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

foreach ($file in $sourceFiles) {
    $source = Join-Path $repoRoot $file.Source
    $destination = Join-Path $stageRoot $file.Destination
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
}

foreach ($file in $dllFiles) {
    $source = Join-Path $GameDataPath $file.Source
    $destination = Join-Path $stageRoot $file.Destination
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
}

$notesPattern = "(?ms)^## v$([regex]::Escape($Version))[^\r\n]*\r?\n(?<body>.*?)(?=^## |\z)"
$notesMatch = [regex]::Match($changelog, $notesPattern)
if (-not $notesMatch.Success) {
    throw "Unable to extract release notes for v$Version from CHANGELOG.md."
}
$notes = $notesMatch.Groups['body'].Value.Trim() + [Environment]::NewLine
[System.IO.File]::WriteAllText($notesPath, $notes, [System.Text.UTF8Encoding]::new($false))

Write-Step 'Creating ZIP and checksum'
Compress-Archive -Path (Join-Path $stageRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal
$hash = Get-FileHash -LiteralPath $zipPath -Algorithm SHA256
$checksumLine = "$($hash.Hash.ToLowerInvariant())  $([System.IO.Path]::GetFileName($zipPath))$([Environment]::NewLine)"
[System.IO.File]::WriteAllText($checksumPath, $checksumLine, [System.Text.UTF8Encoding]::new($false))

Write-Step 'Auditing ZIP contents'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $entries = @($archive.Entries | Where-Object { -not $_.FullName.EndsWith('/') } | ForEach-Object { $_.FullName.Replace('\', '/') })

    $requiredEntries = @($sourceFiles.Destination + $dllFiles.Destination)
    foreach ($required in $requiredEntries) {
        if ($entries -notcontains $required) {
            throw "Release ZIP is missing: $required"
        }
    }

    $dllEntries = @($entries | Where-Object { $_ -match '\.dll$' })
    if ($dllEntries.Count -ne 3) {
        throw "Release ZIP must contain exactly three DLLs; found $($dllEntries.Count)."
    }

    $forbiddenPattern = '(^|/)(\.venv|venv|__pycache__|\.git)(/|$)|^tools/|\.(pdb|mdb|cs|csproj|user|suo)$'
    $forbiddenEntries = @($entries | Where-Object { $_ -match $forbiddenPattern })
    if ($forbiddenEntries.Count -gt 0) {
        throw "Release ZIP contains forbidden files: $($forbiddenEntries -join ', ')"
    }
}
finally {
    $archive.Dispose()
}

Write-Host "`nPackage verified:" -ForegroundColor Green
Write-Host "  ZIP:      $zipPath"
Write-Host "  SHA-256:  $($hash.Hash.ToLowerInvariant())"
Write-Host "  Notes:    $notesPath"

if (-not $CreateDraftRelease) {
    Write-Host "`nPackage-only run complete. No GitHub tag or release was created." -ForegroundColor Yellow
    Write-Host "After testing the ZIP, rerun with -CreateDraftRelease to create a draft GitHub Release."
    return
}

Write-Step 'Creating draft GitHub Release'
$tag = "v$Version"
$releaseArguments = @(
    'release', 'create', $tag,
    $zipPath, $checksumPath,
    '--repo', $Repository,
    '--target', $Target,
    '--title', "Woobie's Mission Control v$Version",
    '--notes-file', $notesPath,
    '--draft'
)
Invoke-CheckedCommand -Command 'gh' -Arguments $releaseArguments

Write-Host "`nDraft release created. Review its notes and assets on GitHub before publishing it." -ForegroundColor Green
