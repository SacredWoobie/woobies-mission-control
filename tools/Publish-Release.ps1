[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,

    [string]$GameDataPath,

    [string]$OutputDirectory,

    [string]$Repository = 'SacredWoobie/woobies-mission-control',

    [string]$Target = 'main',

    [switch]$SkipReleaseImages,

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

function Write-Utf8Json {
    param(
        [string]$Path,
        [Parameter(Mandatory)]
        $Value
    )

    $json = $Value | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText(
        $Path,
        $json + [Environment]::NewLine,
        [System.Text.UTF8Encoding]::new($false)
    )
}

function Sort-CanonicalManifestPaths {
    param([string[]]$Paths)

    # The public Python updater validates paths with str.casefold(). Package
    # paths are ASCII, so lowercase-then-ordinal is the exact compatible order.
    # OrdinalIgnoreCase is not equivalent: it compares uppercase code points
    # and can place letters before underscores in hashed asset names.
    $comparer = [System.Collections.Generic.Comparer[string]]::Create(
        [System.Comparison[string]]{
            param([string]$Left, [string]$Right)
            return [System.StringComparer]::Ordinal.Compare(
                $Left.ToLowerInvariant(),
                $Right.ToLowerInvariant()
            )
        }
    )
    [System.Array]::Sort($Paths, $comparer)
}

function Get-PackageFileRecord {
    param(
        [string]$StageRoot,
        [string]$RelativePath,
        [string]$ManifestPath = $RelativePath
    )

    $path = Join-Path $StageRoot $RelativePath
    Assert-RequiredFile $path
    $file = Get-Item -LiteralPath $path
    return [ordered]@{
        path = $ManifestPath.Replace('\', '/')
        size = [long]$file.Length
        sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

function Test-ManagedRuntimePath {
    param([string]$RelativePath)

    $path = $RelativePath.Replace('\', '/')
    $segments = @($path.Split('/'))
    if ($script:RuntimeUpdateContract.root_managed_files -ccontains $path) {
        return $true
    }
    if ($path -ceq $script:RuntimeUpdateContract.dashboard_contract_path) {
        return $true
    }
    if ($segments.Count -eq 2 -and $segments[0] -ceq 'Dashboard') {
        $extension = [System.IO.Path]::GetExtension($segments[1]).ToLowerInvariant()
        return $script:RuntimeUpdateContract.dashboard_top_level_extensions -ccontains $extension
    }
    if ($path -ceq $script:RuntimeUpdateContract.dashboard_web_index) {
        return $true
    }
    if ($segments.Count -eq 4 -and
        $segments[0] -ceq 'Dashboard' -and
        $segments[1] -ceq 'web' -and
        $segments[2] -ceq 'assets') {
        $extension = [System.IO.Path]::GetExtension($segments[3]).ToLowerInvariant()
        return $script:RuntimeUpdateContract.dashboard_asset_extensions -ccontains $extension
    }
    if ($segments.Count -ge 3 -and
        $segments[0] -ceq 'GameData' -and
        $script:RuntimeUpdateContract.service_folders -ccontains $segments[1]) {
        return $true
    }
    if ($segments.Count -eq 2 -and
        $segments[0] -ceq 'SOURCE' -and
        $segments[1].EndsWith(
            $script:RuntimeUpdateContract.source_archive_suffix,
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
        return $true
    }
    return $false
}

$repoRoot = Get-FullPath (Join-Path $PSScriptRoot '..')
$runtimeUpdateContractPath = Join-Path $repoRoot 'runtime-update-contract.json'
Assert-RequiredFile $runtimeUpdateContractPath
$script:RuntimeUpdateContract = Get-Content -LiteralPath $runtimeUpdateContractPath `
    -Raw -Encoding UTF8 | ConvertFrom-Json
if ($script:RuntimeUpdateContract.schema -ne 1) {
    throw 'runtime-update-contract.json has an unsupported schema.'
}
$manifestPath = Join-Path $PSScriptRoot 'Release-Manifest.psd1'
$frontendBuildScript = Join-Path $PSScriptRoot 'Build-Frontend.ps1'
$frontendRoot = Join-Path $repoRoot 'frontend'
$frontendDist = Join-Path $frontendRoot 'dist'

Assert-RequiredFile $manifestPath
Assert-RequiredFile $frontendBuildScript
$manifest = Import-PowerShellDataFile -LiteralPath $manifestPath
if ($manifest.ContainsKey('ReleaseState') -and
    $manifest.ReleaseState -eq 'Unreleased') {
    throw (
        'Release-Manifest.psd1 is an Unreleased development selection. ' +
        'Choose and align the product release version before packaging.'
    )
}
if ($manifest.ProductVersion -ne $Version) {
    throw "Release-Manifest.psd1 targets $($manifest.ProductVersion), not requested v$Version."
}
if ($CreateDraftRelease -and $SkipReleaseImages) {
    throw '-SkipReleaseImages is only valid for internal package acceptance.'
}

$builderReleaseSetPath = $null
if ([string]::IsNullOrWhiteSpace($GameDataPath)) {
    $repoParent = Split-Path $repoRoot -Parent
    $workspaceCandidates = @(
        $repoParent,
        (Split-Path $repoParent -Parent)
    )
    $builderRoot = $workspaceCandidates |
        ForEach-Object { Join-Path $_ 'Woobies-KRPC-Service-Builder' } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Container } |
        Select-Object -First 1
    if (-not $builderRoot) {
        throw 'Unable to locate the sibling Woobies-KRPC-Service-Builder repository.'
    }
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
$updateArchivePath = Join-Path $OutputDirectory "$packageName.zz-90-runtime-update.zip"
$updateChecksumPath = "$updateArchivePath.sha256"
$updateStageRoot = Join-Path $OutputDirectory "$packageName-runtime-update-stage"
$notesPath = Join-Path $OutputDirectory "release-notes-v$Version.md"
$releaseImages = @(
    @{ Source = 'docs/images/v0.7.2/flight-mission-control-dark.png'; Name = "$packageName.zz-01-flight-mission-control-dark.png" },
    @{ Source = 'docs/images/v0.7.2/editor-green-phosphor.png'; Name = "$packageName.zz-02-editor-green-phosphor.png" },
    @{ Source = 'docs/images/v0.7.2/mission-overview-warm-crt.png'; Name = "$packageName.zz-03-mission-overview-warm-crt.png" },
    @{ Source = 'docs/images/v0.7.2/mission-overview-settings-daylight.png'; Name = "$packageName.zz-04-mission-overview-settings-daylight.png" },
    @{ Source = 'docs/images/v0.7.2/delta-v-planner-daylight.png'; Name = "$packageName.zz-05-delta-v-planner-daylight.png" }
)
$activeReleaseImages = @(
    if (-not $SkipReleaseImages) {
        $releaseImages
    }
)
$releaseImagePaths = @(
    $activeReleaseImages |
        ForEach-Object { Join-Path $OutputDirectory $_.Name }
)
$sourceArchiveAssets = @(
    $manifest.Services |
        Where-Object { $_.ContainsKey('SourceArchive') } |
        ForEach-Object {
            @{
                Source = $_.SourceArchive
                OutputPath = Join-Path $OutputDirectory "$packageName.zz-00-$($_.SourceArchive)"
            }
        }
)
$sourceArchiveOutputPaths = @($sourceArchiveAssets | ForEach-Object { $_.OutputPath })
$releaseUpdatePaths = @($updateArchivePath, $updateChecksumPath)
foreach ($path in @($stageRoot, $zipPath, $checksumPath, $updateStageRoot, $notesPath) + $releaseUpdatePaths + $releaseImagePaths + $sourceArchiveOutputPaths) {
    Assert-SafeChildPath -Parent $OutputDirectory -Child $path
}

$sourceFiles = @(
    @{ Source = 'Start KSP Dashboard.bat'; Destination = 'Dashboard/Start KSP Dashboard.bat' },
    @{ Source = 'Select Mission Control Setup.ps1'; Destination = 'Dashboard/Select Mission Control Setup.ps1' },
    @{ Source = 'ksp_dashboard_app.py'; Destination = 'Dashboard/ksp_dashboard_app.py' },
    @{ Source = 'runtime_update.py'; Destination = 'Dashboard/runtime_update.py' },
    @{ Source = 'runtime_update_helper.py'; Destination = 'Dashboard/runtime_update_helper.py' },
    @{ Source = 'runtime-update-contract.json'; Destination = 'Dashboard/runtime-update-contract.json' },
    @{ Source = 'panel_bridge.py'; Destination = 'Dashboard/panel_bridge.py' },
    @{ Source = 'dashboard_capabilities.py'; Destination = 'Dashboard/dashboard_capabilities.py' },
    @{ Source = 'damage.py'; Destination = 'Dashboard/damage.py' },
    @{ Source = 'electricity.py'; Destination = 'Dashboard/electricity.py' },
    @{ Source = 'editor_electrical_snapshot.py'; Destination = 'Dashboard/editor_electrical_snapshot.py' },
    @{ Source = 'flight_core_snapshot.py'; Destination = 'Dashboard/flight_core_snapshot.py' },
    @{ Source = 'heat.py'; Destination = 'Dashboard/heat.py' },
    @{ Source = 'heat_electricity_snapshot.py'; Destination = 'Dashboard/heat_electricity_snapshot.py' },
    @{ Source = 'mission_planning.py'; Destination = 'Dashboard/mission_planning.py' },
    @{ Source = 'planner_persistence.py'; Destination = 'Dashboard/planner_persistence.py' },
    @{ Source = 'resource_snapshot.py'; Destination = 'Dashboard/resource_snapshot.py' },
    @{ Source = 'stage_snapshot.py'; Destination = 'Dashboard/stage_snapshot.py' },
    @{ Source = 'staging.py'; Destination = 'Dashboard/staging.py' },
    @{ Source = 'telemetry_runtime.py'; Destination = 'Dashboard/telemetry_runtime.py' },
    @{ Source = 'requirements-dashboard.txt'; Destination = 'Dashboard/requirements-dashboard.txt' },
    @{ Source = 'requirements-panel.txt'; Destination = 'Dashboard/requirements-panel.txt' },
    @{ Source = 'requirements.txt'; Destination = 'Dashboard/requirements.txt' },
    @{ Source = 'telemetry_server.py'; Destination = 'Dashboard/telemetry_server.py' },
    @{ Source = 'LICENSE'; Destination = 'LICENSE' },
    @{ Source = 'QUICKSTART.txt'; Destination = 'QUICKSTART.txt' },
    @{ Source = 'README.md'; Destination = 'README.md' },
    @{ Source = 'CHANGELOG.md'; Destination = 'CHANGELOG.md' },
    @{ Source = 'THIRD_PARTY_LICENSES.md'; Destination = 'THIRD-PARTY/NOTICES.md' },
    @{ Source = 'docs/CONTROL_PAD_PROTOCOL.md'; Destination = 'docs/CONTROL_PAD_PROTOCOL.md' },
    @{ Source = 'docs/RELEASE_PROCESS.md'; Destination = 'docs/RELEASE_PROCESS.md' },
    @{ Source = 'firmware/KSP_control.ino'; Destination = 'firmware/KSP_control.ino' }
)
foreach ($image in $activeReleaseImages) {
    $sourceFiles += @{
        Source = $image.Source
        Destination = $image.Source
    }
}

Write-Step 'Checking release metadata and source inputs'
foreach ($file in $sourceFiles) {
    Assert-RequiredFile (Join-Path $repoRoot $file.Source)
}
foreach ($image in $activeReleaseImages) {
    Assert-RequiredFile (Join-Path $repoRoot $image.Source)
    if ([System.StringComparer]::OrdinalIgnoreCase.Compare(
        [System.IO.Path]::GetFileName($zipPath),
        $image.Name
    ) -ge 0) {
        throw "Release image '$($image.Name)' must sort after '$([System.IO.Path]::GetFileName($zipPath))'."
    }
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

$packageJson = Get-Content -LiteralPath (Join-Path $frontendRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($packageJson.version -ne $Version) {
    throw "frontend/package.json identifies $($packageJson.version), not v$Version."
}

$launcherText = Get-Content -LiteralPath (Join-Path $repoRoot 'ksp_dashboard_app.py') -Raw -Encoding UTF8
$changelog = Get-Content -LiteralPath (Join-Path $repoRoot 'CHANGELOG.md') -Raw -Encoding UTF8
if ($launcherText -notmatch [regex]::Escape("APP_VERSION = `"$Version`"")) {
    throw "ksp_dashboard_app.py does not identify v$Version."
}
if ($changelog -notmatch "(?m)^## v$([regex]::Escape($Version))(?:\s|$)") {
    throw "CHANGELOG.md does not contain a v$Version section."
}

$serviceInputs = @()
$serviceCompanionInputs = @()
$sourceArchiveInputs = @()
$sourceArchiveRoot = Join-Path (Split-Path $GameDataPath -Parent) 'source'
foreach ($service in $manifest.Services) {
    $relative = "$($service.Folder)/$($service.File)"
    $path = Join-Path $GameDataPath $relative
    Assert-RequiredFile $path
    $actualVersion = [System.Reflection.AssemblyName]::GetAssemblyName($path).Version
    $expectedVersion = [Version]$service.Version
    if ($actualVersion -ne $expectedVersion) {
        throw "$($service.File) must be $expectedVersion; staged builder copy is $actualVersion."
    }
    $actualHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if (
        $service.ContainsKey('Sha256') -and
        -not $actualHash.Equals(
            $service.Sha256,
            [System.StringComparison]::OrdinalIgnoreCase
        )
    ) {
        throw "$($service.File) SHA-256 does not match Release-Manifest.psd1."
    }
    $serviceInputs += @{
        Source = $relative
        Destination = "GameData/$relative"
        Folder = $service.Folder
        File = $service.File
        Version = $actualVersion.ToString()
        Hash = $actualHash.ToLowerInvariant()
    }
    if ($service.ContainsKey('RequiredPackageFiles')) {
        foreach ($requiredFile in $service.RequiredPackageFiles) {
            $companionRelative = "$($service.Folder)/$requiredFile"
            Assert-RequiredFile (Join-Path $GameDataPath $companionRelative)
            $serviceCompanionInputs += @{
                Source = $companionRelative
                Destination = "GameData/$companionRelative"
            }
        }
    }
    if ($service.ContainsKey('SourceArchive')) {
        $sourceArchivePath = Join-Path $sourceArchiveRoot $service.SourceArchive
        Assert-RequiredFile $sourceArchivePath
        $sourceArchiveHash = (
            Get-FileHash -LiteralPath $sourceArchivePath -Algorithm SHA256
        ).Hash
        if (-not $sourceArchiveHash.Equals(
            $service.SourceArchiveSha256,
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
            throw "$($service.SourceArchive) SHA-256 does not match Release-Manifest.psd1."
        }
        $sourceArchiveInputs += @{
            Source = $service.SourceArchive
            Destination = "SOURCE/$($service.SourceArchive)"
            Hash = $sourceArchiveHash.ToLowerInvariant()
        }
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
    $immutableJson = & gh api `
        -H 'Accept: application/vnd.github+json' `
        -H 'X-GitHub-Api-Version: 2026-03-10' `
        "repos/$Repository/immutable-releases"
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to verify the repository immutable-release setting.'
    }
    $immutableSetting = $immutableJson | ConvertFrom-Json
    if ($immutableSetting.enabled -ne $true) {
        throw (
            'GitHub release immutability must be enabled before creating an ' +
            'updater-capable draft release.'
        )
    }
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
if (Test-Path -LiteralPath $updateStageRoot) {
    Remove-Item -LiteralPath $updateStageRoot -Recurse -Force
}
foreach ($path in @($zipPath, $checksumPath, $notesPath) + $releaseUpdatePaths + $releaseImagePaths + $sourceArchiveOutputPaths) {
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
foreach ($companion in $serviceCompanionInputs) {
    Copy-AllowlistedFile -SourceRoot $GameDataPath -StageRoot $stageRoot -Entry $companion
}
foreach ($sourceArchive in $sourceArchiveInputs) {
    Copy-AllowlistedFile -SourceRoot $sourceArchiveRoot -StageRoot $stageRoot -Entry $sourceArchive
    $sourceArchiveAsset = $sourceArchiveAssets |
        Where-Object { $_.Source -eq $sourceArchive.Source } |
        Select-Object -First 1
    if (-not $sourceArchiveAsset) {
        throw "No release asset path was defined for source archive $($sourceArchive.Source)."
    }
    Copy-Item -LiteralPath (Join-Path $sourceArchiveRoot $sourceArchive.Source) `
        -Destination $sourceArchiveAsset.OutputPath -Force
}

$webTarget = Join-Path $stageRoot 'Dashboard\web'
Assert-RequiredFile (Join-Path $frontendDist 'index.html')
New-Item -ItemType Directory -Path $webTarget -Force | Out-Null
Copy-Item -Path (Join-Path $frontendDist '*') -Destination $webTarget -Recurse -Force

$sourceCommit = $null
if ((Test-Path -LiteralPath (Join-Path $repoRoot '.git')) -and (Get-Command 'git' -ErrorAction SilentlyContinue)) {
    $sourceCommit = (& git -C $repoRoot rev-parse HEAD 2>$null).Trim()
    $sourceDirty = @(& git -C $repoRoot status --porcelain)
}
if (-not $sourceCommit -or $sourceCommit -notmatch '^[0-9a-fA-F]{40}$') {
    throw 'Runtime-update packages require an exact Git source commit.'
}
if ($sourceDirty.Count -gt 0) {
    throw 'Runtime-update packages must be assembled from a clean Git checkout.'
}
$sourceCommit = $sourceCommit.ToLowerInvariant()
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
foreach ($sourceArchive in $sourceArchiveInputs) {
    $buildLines += "- Corresponding source: $($sourceArchive.Source) SHA-256 $($sourceArchive.Hash)"
}
[System.IO.File]::WriteAllLines(
    (Join-Path $stageRoot 'BUILD-INFO.txt'),
    $buildLines,
    [System.Text.UTF8Encoding]::new($false)
)

Write-Step 'Creating managed installation and runtime-update manifests'
$runtimeSurfacePaths = @(
    Get-ChildItem -LiteralPath $stageRoot -Recurse -File |
        ForEach-Object {
            $_.FullName.Substring($stageRoot.Length).TrimStart('\').Replace('\', '/')
        } |
        Where-Object {
            $_.StartsWith('Dashboard/', [System.StringComparison]::Ordinal) -or
            $_.StartsWith('GameData/', [System.StringComparison]::Ordinal) -or
            $_.StartsWith('SOURCE/', [System.StringComparison]::Ordinal)
        }
)
$unmanagedRuntimePaths = @(
    $runtimeSurfacePaths | Where-Object { -not (Test-ManagedRuntimePath $_) }
)
if ($unmanagedRuntimePaths.Count -gt 0) {
    throw (
        'Packaged runtime paths are absent from runtime-update-contract.json: ' +
        ($unmanagedRuntimePaths -join ', ')
    )
}
$managedPaths = [string[]]@(
    Get-ChildItem -LiteralPath $stageRoot -Recurse -File |
        ForEach-Object {
            $_.FullName.Substring($stageRoot.Length).TrimStart('\').Replace('\', '/')
        } |
        Where-Object { Test-ManagedRuntimePath $_ }
)
Sort-CanonicalManifestPaths $managedPaths
if ($managedPaths.Count -eq 0) {
    throw 'The managed runtime file set is empty.'
}
$managedRecords = @(
    $managedPaths |
        ForEach-Object { Get-PackageFileRecord -StageRoot $stageRoot -RelativePath $_ }
)
$serviceRecords = @(
    $serviceInputs |
        Sort-Object { $_.Folder.ToLowerInvariant() } |
        ForEach-Object {
            [ordered]@{
                name = $_.Folder
                version = $_.Version
                sha256 = $_.Hash
            }
        }
)
$installManifest = [ordered]@{
    schema = 1
    product_version = $Version
    updater_protocol = 1
    source_commit = $sourceCommit
    services = $serviceRecords
    files = $managedRecords
}
$installManifestPath = Join-Path $stageRoot 'WMC-INSTALL-MANIFEST.json'
Write-Utf8Json -Path $installManifestPath -Value $installManifest

New-Item -ItemType Directory -Path (Join-Path $updateStageRoot 'payload') -Force | Out-Null
foreach ($relativePath in $managedPaths + @('WMC-INSTALL-MANIFEST.json')) {
    $source = Join-Path $stageRoot $relativePath
    $destination = Join-Path (Join-Path $updateStageRoot 'payload') $relativePath
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
}
$payloadPaths = [string[]]@(
    Get-ChildItem -LiteralPath (Join-Path $updateStageRoot 'payload') -Recurse -File |
        ForEach-Object {
            $_.FullName.Substring($updateStageRoot.Length).TrimStart('\').Replace('\', '/')
        }
)
Sort-CanonicalManifestPaths $payloadPaths
$payloadRecords = @(
    $payloadPaths |
        ForEach-Object { Get-PackageFileRecord -StageRoot $updateStageRoot -RelativePath $_ }
)
$updateManifest = [ordered]@{
    schema = 1
    product_version = $Version
    source_commit = $sourceCommit
    compatible_updater_protocols = @(1)
    services = $serviceRecords
    files = $payloadRecords
}
Write-Utf8Json -Path (Join-Path $updateStageRoot 'update-manifest.json') -Value $updateManifest

$contractLimits = $script:RuntimeUpdateContract.limits
$updateManifestFile = Get-Item -LiteralPath (Join-Path $updateStageRoot 'update-manifest.json')
if ($payloadRecords.Count + 1 -gt [long]$contractLimits.archive_entries) {
    throw 'Runtime-update payload exceeds the updater archive entry limit.'
}
if ($updateManifestFile.Length -gt [long]$contractLimits.archive_file_bytes) {
    throw 'Runtime-update manifest exceeds the updater per-file limit.'
}
$expandedBytes = [long]$updateManifestFile.Length
foreach ($record in $payloadRecords) {
    if ($record.path.Length -gt [long]$contractLimits.relative_path_length) {
        throw "Runtime-update path exceeds the updater length limit: $($record.path)"
    }
    if ([long]$record.size -gt [long]$contractLimits.archive_file_bytes) {
        throw "Runtime-update file exceeds the updater per-file limit: $($record.path)"
    }
    $expandedBytes += [long]$record.size
}
if ($expandedBytes -gt [long]$contractLimits.archive_expanded_bytes) {
    throw 'Runtime-update payload exceeds the updater expanded-size limit.'
}

Write-Step 'Creating runtime-update archive and checksum'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$updateArchiveStream = [System.IO.File]::Open(
    $updateArchivePath,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
)
try {
    $updateArchiveWriter = [System.IO.Compression.ZipArchive]::new(
        $updateArchiveStream,
        [System.IO.Compression.ZipArchiveMode]::Create,
        $false
    )
    try {
        $updateArchiveInputs = @('update-manifest.json') + $payloadPaths
        foreach ($relativePath in $updateArchiveInputs) {
            $entryName = $relativePath.Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $updateArchiveWriter,
                (Join-Path $updateStageRoot $relativePath),
                $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    }
    finally {
        $updateArchiveWriter.Dispose()
    }
}
finally {
    $updateArchiveStream.Dispose()
}
$updateArchiveFile = Get-Item -LiteralPath $updateArchivePath
if ($updateArchiveFile.Length -gt [long]$contractLimits.download_bytes) {
    throw 'Runtime-update ZIP exceeds the updater download limit.'
}
$updateHash = Get-FileHash -LiteralPath $updateArchivePath -Algorithm SHA256
$updateChecksumLine = (
    "$($updateHash.Hash.ToLowerInvariant())  " +
    "$([System.IO.Path]::GetFileName($updateArchivePath))" +
    [Environment]::NewLine
)
[System.IO.File]::WriteAllText(
    $updateChecksumPath,
    $updateChecksumLine,
    [System.Text.UTF8Encoding]::new($false)
)
if ((Get-Item -LiteralPath $updateChecksumPath).Length -gt [long]$contractLimits.checksum_bytes) {
    throw 'Runtime-update checksum exceeds the updater checksum limit.'
}

$updateArchive = [System.IO.Compression.ZipFile]::OpenRead($updateArchivePath)
try {
    $updateEntries = @(
        $updateArchive.Entries |
            Where-Object { -not $_.FullName.EndsWith('/') }
    )
    if ($updateEntries.Count -gt [long]$contractLimits.archive_entries) {
        throw 'Runtime-update ZIP exceeds the updater archive entry limit.'
    }
    $archiveExpandedBytes = [long]0
    foreach ($entry in $updateEntries) {
        if ($entry.Length -gt [long]$contractLimits.archive_file_bytes) {
            throw "Runtime-update ZIP entry exceeds the updater per-file limit: $($entry.FullName)"
        }
        $archiveExpandedBytes += [long]$entry.Length
    }
    if ($archiveExpandedBytes -gt [long]$contractLimits.archive_expanded_bytes) {
        throw 'Runtime-update ZIP exceeds the updater expanded-size limit.'
    }
    $expectedUpdateEntries = @('update-manifest.json') + $payloadRecords.path
    $actualUpdateEntries = @($updateEntries | ForEach-Object { $_.FullName.Replace('\', '/') })
    if ($actualUpdateEntries.Count -ne $expectedUpdateEntries.Count -or
        @($expectedUpdateEntries | Where-Object { $actualUpdateEntries -notcontains $_ }).Count -gt 0 -or
        @($actualUpdateEntries | Where-Object { $expectedUpdateEntries -notcontains $_ }).Count -gt 0) {
        throw 'Runtime-update ZIP entries do not exactly match update-manifest.json.'
    }
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        foreach ($record in $payloadRecords) {
            $entry = $updateEntries |
                Where-Object { $_.FullName.Replace('\', '/') -eq $record.path } |
                Select-Object -First 1
            if (-not $entry -or $entry.Length -ne $record.size) {
                throw "Runtime-update ZIP size mismatch: $($record.path)"
            }
            $stream = $entry.Open()
            try {
                $entryHash = [System.BitConverter]::ToString(
                    $sha256.ComputeHash($stream)
                ).Replace('-', '').ToLowerInvariant()
            }
            finally {
                $stream.Dispose()
            }
            if ($entryHash -ne $record.sha256) {
                throw "Runtime-update ZIP hash mismatch: $($record.path)"
            }
        }
    }
    finally {
        $sha256.Dispose()
    }
}
finally {
    $updateArchive.Dispose()
}
Remove-Item -LiteralPath $updateStageRoot -Recurse -Force

$notesPattern = "(?ms)^## v$([regex]::Escape($Version))[^\r\n]*\r?\n(?<body>.*?)(?=^## |\z)"
$notesMatch = [regex]::Match($changelog, $notesPattern)
if (-not $notesMatch.Success) {
    throw "Unable to extract release notes for v$Version."
}
$notes = $notesMatch.Groups['body'].Value.Trim() + [Environment]::NewLine
[System.IO.File]::WriteAllText($notesPath, $notes, [System.Text.UTF8Encoding]::new($false))

foreach ($image in $activeReleaseImages) {
    $source = Join-Path $repoRoot $image.Source
    $destination = Join-Path $OutputDirectory $image.Name
    Copy-Item -LiteralPath $source -Destination $destination -Force
}

Write-Step 'Auditing the unpacked package'
$stageFiles = @(Get-ChildItem -LiteralPath $stageRoot -Recurse -File)
$dllFiles = @($stageFiles | Where-Object { $_.Extension -eq '.dll' })
if ($dllFiles.Count -ne $manifest.Services.Count) {
    throw "Package must contain exactly $($manifest.Services.Count) DLLs; found $($dllFiles.Count)."
}

$relativeStageFiles = @($stageFiles | ForEach-Object {
    $_.FullName.Substring($stageRoot.Length).TrimStart('\').Replace('\', '/')
})
$requiredEntries = @(
    $sourceFiles.Destination +
    $serviceInputs.Destination +
    $serviceCompanionInputs.Destination +
    $sourceArchiveInputs.Destination +
    @('Dashboard/web/index.html', 'BUILD-INFO.txt', 'WMC-INSTALL-MANIFEST.json')
)
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
$fullZipFile = Get-Item -LiteralPath $zipPath
$updateZipFile = Get-Item -LiteralPath $updateArchivePath
if ($updateZipFile.Length -ge $fullZipFile.Length) {
    throw 'The runtime-update asset must be smaller than the normal release ZIP.'
}
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
Write-Host "  Update:   $updateArchivePath"
Write-Host "  Update SHA-256: $($updateHash.Hash.ToLowerInvariant())"
Write-Host "  Notes:    $notesPath"
if ($releaseImagePaths.Count -gt 0) {
    Write-Host '  Images:'
    foreach ($imagePath in $releaseImagePaths) {
        Write-Host "             $imagePath"
    }
}
if ($sourceArchiveOutputPaths.Count -gt 0) {
    Write-Host '  Source:'
    foreach ($sourceArchivePath in $sourceArchiveOutputPaths) {
        Write-Host "             $sourceArchivePath"
    }
}

if (-not $CreateDraftRelease) {
    Write-Host "`nPackage-only run complete. Nothing was published to GitHub." -ForegroundColor Yellow
    Write-Host 'Acceptance-test the unpacked package and ZIP before creating a draft release.'
    return
}

Write-Step 'Creating draft GitHub release'
$releaseArguments = @(
    'release', 'create', "v$Version",
    $zipPath, $checksumPath
) + $sourceArchiveOutputPaths + $releaseImagePaths + $releaseUpdatePaths + @(
    '--repo', $Repository,
    '--target', $Target,
    '--title', "Woobie's Mission Control v$Version",
    '--notes-file', $notesPath,
    '--draft'
)
Invoke-CheckedCommand -Command 'gh' -Arguments $releaseArguments
Write-Host "`nDraft release created. Review it before publishing." -ForegroundColor Green
