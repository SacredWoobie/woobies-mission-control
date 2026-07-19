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

function Copy-AllowlistedFile {
    param(
        [string]$SourceRoot,
        [string]$StageRoot,
        [hashtable]$Entry
    )

    $source = Join-Path $SourceRoot $Entry.Source
    $destination = Join-Path $StageRoot $Entry.Destination
    Assert-RequiredFile $source
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
}

$repoRoot = Get-FullPath (Join-Path $PSScriptRoot '..')
$manifestPath = Join-Path $PSScriptRoot 'Release-Manifest.psd1'
$frontendBuildScript = Join-Path $PSScriptRoot 'Build-Frontend.ps1'
$frontendRoot = Join-Path $repoRoot 'frontend'
$frontendDist = Join-Path $frontendRoot 'dist'

Assert-RequiredFile $manifestPath
Assert-RequiredFile $frontendBuildScript
$manifest = Import-PowerShellDataFile -LiteralPath $manifestPath
if ($manifest.ProductVersion -ne $Version) {
    throw "Release-Manifest.psd1 targets $($manifest.ProductVersion), not requested v$Version."
}

$builderReleaseSetPath = $null
if ([string]::IsNullOrWhiteSpace($GameDataPath)) {
    $workspaceRoot = Split-Path $repoRoot -Parent
    $builderRoot = Join-Path $workspaceRoot 'Woobies-KRPC-Service-Builder'
    $GameDataPath = Join-Path $builderRoot 'dist\GameData'
    $builderReleaseSetPath = Join-Path $builderRoot 'Release-Set.psd1'
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
    @{ Source = 'Select Mission Control Setup.ps1'; Destination = 'Dashboard/Select Mission Control Setup.ps1' },
    @{ Source = 'ksp_dashboard_app.py'; Destination = 'Dashboard/ksp_dashboard_app.py' },
    @{ Source = 'panel_bridge.py'; Destination = 'Dashboard/panel_bridge.py' },
    @{ Source = 'requirements-dashboard.txt'; Destination = 'Dashboard/requirements-dashboard.txt' },
    @{ Source = 'requirements-panel.txt'; Destination = 'Dashboard/requirements-panel.txt' },
    @{ Source = 'requirements.txt'; Destination = 'Dashboard/requirements.txt' },
    @{ Source = 'telemetry_server.py'; Destination = 'Dashboard/telemetry_server.py' },
    @{ Source = 'LICENSE'; Destination = 'LICENSE' },
    @{ Source = 'QUICKSTART.txt'; Destination = 'QUICKSTART.txt' },
    @{ Source = 'README.md'; Destination = 'README.md' },
    @{ Source = 'CHANGELOG.md'; Destination = 'CHANGELOG.md' },
    @{ Source = 'docs/CONTROL_PAD_PROTOCOL.md'; Destination = 'docs/CONTROL_PAD_PROTOCOL.md' },
    @{ Source = 'docs/RELEASE_PROCESS.md'; Destination = 'docs/RELEASE_PROCESS.md' },
    @{ Source = 'docs/images/v0.3.0/flight-dashboard-landscape.png'; Destination = 'docs/images/v0.3.0/flight-dashboard-landscape.png' },
    @{ Source = 'docs/images/v0.3.0/mission-control-landscape.png'; Destination = 'docs/images/v0.3.0/mission-control-landscape.png' },
    @{ Source = 'docs/images/v0.3.0/editor-vab-landscape.png'; Destination = 'docs/images/v0.3.0/editor-vab-landscape.png' },
    @{ Source = 'docs/images/v0.3.0/launcher.png'; Destination = 'docs/images/v0.3.0/launcher.png' },
    @{ Source = 'docs/images/v0.3.0/notes-drawer.png'; Destination = 'docs/images/v0.3.0/notes-drawer.png' },
    @{ Source = 'firmware/KSP_control.ino'; Destination = 'firmware/KSP_control.ino' }
)

Write-Step 'Checking release metadata and source inputs'
foreach ($file in $sourceFiles) {
    Assert-RequiredFile (Join-Path $repoRoot $file.Source)
}

if ($builderReleaseSetPath) {
    Assert-RequiredFile $builderReleaseSetPath
    $builderReleaseSet = Import-PowerShellDataFile -LiteralPath $builderReleaseSetPath
    foreach ($service in $manifest.Services) {
        $expectedRelease = ([Version]$service.Version).ToString(3)
        if ($builderReleaseSet[$service.Folder] -ne $expectedRelease) {
            throw "The service builder selects $($service.Folder) $($builderReleaseSet[$service.Folder]); Mission Control requires $expectedRelease. Update Release-Set.psd1 and restage it."
        }
    }
}

$packageJson = Get-Content -LiteralPath (Join-Path $frontendRoot 'package.json') -Raw | ConvertFrom-Json
if ($packageJson.version -ne $Version) {
    throw "frontend/package.json identifies $($packageJson.version), not v$Version."
}

$launcherText = Get-Content -LiteralPath (Join-Path $repoRoot 'ksp_dashboard_app.py') -Raw
$changelog = Get-Content -LiteralPath (Join-Path $repoRoot 'CHANGELOG.md') -Raw
if ($launcherText -notmatch [regex]::Escape("APP_VERSION = `"$Version`"")) {
    throw "ksp_dashboard_app.py does not identify v$Version."
}
if ($changelog -notmatch "(?m)^## v$([regex]::Escape($Version))(?:\s|$)") {
    throw "CHANGELOG.md does not contain a v$Version section."
}

$serviceInputs = @()
foreach ($service in $manifest.Services) {
    $relative = "$($service.Folder)/$($service.File)"
    $path = Join-Path $GameDataPath $relative
    Assert-RequiredFile $path
    $actualVersion = [System.Reflection.AssemblyName]::GetAssemblyName($path).Version
    $expectedVersion = [Version]$service.Version
    if ($actualVersion -ne $expectedVersion) {
        throw "$($service.File) must be $expectedVersion; staged builder copy is $actualVersion."
    }
    $serviceInputs += @{
        Source = $relative
        Destination = "GameData/$relative"
        Folder = $service.Folder
        File = $service.File
        Version = $actualVersion.ToString()
        Hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
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
        throw "Draft releases must be created from '$Target'. Current branch: '$branch'."
    }
    $status = (& git -C $repoRoot status --porcelain)
    if ($LASTEXITCODE -ne 0 -or $status) {
        throw 'The Git working tree must be clean before creating a draft release.'
    }
    Invoke-CheckedCommand -Command 'git' -Arguments @('-C', $repoRoot, 'fetch', 'origin', $Target, '--quiet')
    $head = (& git -C $repoRoot rev-parse 'HEAD').Trim()
    $remoteHead = (& git -C $repoRoot rev-parse "origin/$Target").Trim()
    if ($head -ne $remoteHead) {
        throw "Local '$Target' does not match origin/$Target."
    }
    Invoke-CheckedCommand -Command 'gh' -Arguments @('auth', 'status', '--hostname', 'github.com')
    $existingJson = & gh release list --repo $Repository --limit 1000 --json tagName
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to inspect existing GitHub releases.'
    }
    $existingTags = @($existingJson | ConvertFrom-Json | ForEach-Object { $_.tagName })
    if ($existingTags -contains "v$Version") {
        throw "A GitHub release for v$Version already exists."
    }
}

Write-Step 'Building and verifying the production React dashboard'
& $frontendBuildScript -InstallDependencies

Write-Step 'Assembling the unpacked allowlisted package'
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
    Copy-AllowlistedFile -SourceRoot $repoRoot -StageRoot $stageRoot -Entry $file
}
foreach ($service in $serviceInputs) {
    Copy-AllowlistedFile -SourceRoot $GameDataPath -StageRoot $stageRoot -Entry $service
}

$webTarget = Join-Path $stageRoot 'Dashboard\web'
Assert-RequiredFile (Join-Path $frontendDist 'index.html')
New-Item -ItemType Directory -Path $webTarget -Force | Out-Null
Copy-Item -Path (Join-Path $frontendDist '*') -Destination $webTarget -Recurse -Force

$sourceCommit = 'not-a-git-checkout'
if ((Test-Path -LiteralPath (Join-Path $repoRoot '.git')) -and (Get-Command 'git' -ErrorAction SilentlyContinue)) {
    $sourceCommit = (& git -C $repoRoot rev-parse HEAD 2>$null).Trim()
    if (-not $sourceCommit) {
        $sourceCommit = 'unknown'
    }
    elseif (@(& git -C $repoRoot status --porcelain).Count -gt 0) {
        $sourceCommit += ' (working tree modified)'
    }
}
$buildLines = @(
    "Woobie's Mission Control v$Version",
    "Assembled UTC: $([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))",
    "Source commit: $sourceCommit",
    "Dashboard: React/TypeScript/Vite production bundle $Version",
    "Delivery: Python loopback HTTP and WebSocket on 127.0.0.1:8090",
    '',
    'Selected kRPC services:'
)
foreach ($service in $serviceInputs) {
    $buildLines += "- $($service.Folder) $($service.Version) SHA-256 $($service.Hash)"
}
[System.IO.File]::WriteAllLines(
    (Join-Path $stageRoot 'BUILD-INFO.txt'),
    $buildLines,
    [System.Text.UTF8Encoding]::new($false)
)

$notesPattern = "(?ms)^## v$([regex]::Escape($Version))[^\r\n]*\r?\n(?<body>.*?)(?=^## |\z)"
$notesMatch = [regex]::Match($changelog, $notesPattern)
if (-not $notesMatch.Success) {
    throw "Unable to extract release notes for v$Version."
}
$notes = $notesMatch.Groups['body'].Value.Trim() + [Environment]::NewLine
[System.IO.File]::WriteAllText($notesPath, $notes, [System.Text.UTF8Encoding]::new($false))

Write-Step 'Auditing the unpacked package'
$stageFiles = @(Get-ChildItem -LiteralPath $stageRoot -Recurse -File)
$dllFiles = @($stageFiles | Where-Object { $_.Extension -eq '.dll' })
if ($dllFiles.Count -ne $manifest.Services.Count) {
    throw "Package must contain exactly $($manifest.Services.Count) DLLs; found $($dllFiles.Count)."
}

$relativeStageFiles = @($stageFiles | ForEach-Object {
    $_.FullName.Substring($stageRoot.Length).TrimStart('\').Replace('\', '/')
})
$requiredEntries = @($sourceFiles.Destination + $serviceInputs.Destination + @('Dashboard/web/index.html', 'BUILD-INFO.txt'))
foreach ($required in $requiredEntries) {
    if ($relativeStageFiles -notcontains $required) {
        throw "Unpacked package is missing: $required"
    }
}

$forbiddenPattern = '(^|/)(\.venv|venv|__pycache__|\.git|node_modules|frontend|scripts|tests|tools)(/|$)|(^|/)ksp_mission_dashboard\.html$|\.(pdb|mdb|cs|csproj|ts|tsx|map|pyc)$'
$forbidden = @($relativeStageFiles | Where-Object { $_ -match $forbiddenPattern })
if ($forbidden.Count -gt 0) {
    throw "Unpacked package contains forbidden development files: $($forbidden -join ', ')"
}

Write-Step 'Creating ZIP and checksum'
Compress-Archive -Path (Join-Path $stageRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal
$hash = Get-FileHash -LiteralPath $zipPath -Algorithm SHA256
$checksumLine = "$($hash.Hash.ToLowerInvariant())  $([System.IO.Path]::GetFileName($zipPath))$([Environment]::NewLine)"
[System.IO.File]::WriteAllText($checksumPath, $checksumLine, [System.Text.UTF8Encoding]::new($false))

Write-Step 'Auditing ZIP contents'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $entries = @($archive.Entries |
        Where-Object { -not $_.FullName.EndsWith('/') } |
        ForEach-Object { $_.FullName.Replace('\', '/') })
    foreach ($required in $requiredEntries) {
        if ($entries -notcontains $required) {
            throw "Release ZIP is missing: $required"
        }
    }
    $zipDlls = @($entries | Where-Object { $_ -match '\.dll$' })
    if ($zipDlls.Count -ne $manifest.Services.Count) {
        throw "Release ZIP contains $($zipDlls.Count) DLLs; expected $($manifest.Services.Count)."
    }
    $zipForbidden = @($entries | Where-Object { $_ -match $forbiddenPattern })
    if ($zipForbidden.Count -gt 0) {
        throw "Release ZIP contains forbidden files: $($zipForbidden -join ', ')"
    }
}
finally {
    $archive.Dispose()
}

Write-Host "`nRelease candidate verified:" -ForegroundColor Green
Write-Host "  Unpacked: $stageRoot"
Write-Host "  ZIP:      $zipPath"
Write-Host "  SHA-256:  $($hash.Hash.ToLowerInvariant())"
Write-Host "  Notes:    $notesPath"

if (-not $CreateDraftRelease) {
    Write-Host "`nPackage-only run complete. Nothing was published to GitHub." -ForegroundColor Yellow
    Write-Host 'Acceptance-test the unpacked package and ZIP before creating a draft release.'
    return
}

Write-Step 'Creating draft GitHub release'
$releaseArguments = @(
    'release', 'create', "v$Version",
    $zipPath, $checksumPath,
    '--repo', $Repository,
    '--target', $Target,
    '--title', "Woobie's Mission Control v$Version",
    '--notes-file', $notesPath,
    '--draft'
)
Invoke-CheckedCommand -Command 'gh' -Arguments $releaseArguments
Write-Host "`nDraft release created. Review it before publishing." -ForegroundColor Green
