@{
    ProductVersion = "0.4.1"
    Status = "integration-input"

    Services = @(
        @{
            Folder = "WoobiesControlStats"
            File = "WoobiesControlStats.dll"
            Version = "0.2.1.0"
            Sha256 = "8ADFC473189A0BE978E4DFB29CE66BD734C81BC4F7496D972DE2F4DBB9E12AA4"
            License = "MIT"
        }
        @{
            Folder = "KRPC.StageStats"
            File = "KRPC.StageStats.dll"
            Version = "0.2.7.0"
            Sha256 = "18AE2F6D14B63476E37F2EC052119E49C421043FDB1A63F0C9BBED05D5A265EC"
            License = "MIT"
            SourceCommit = "f74c49fd4c335a73a4377eee71e19724356945d3"
        }
        @{
            Folder = "KRPC.SystemHeat"
            File = "KRPC.SystemHeat.dll"
            Version = "0.2.2.0"
            Sha256 = "2265CC09E391A629D5281EA0BB74B47CBC4311AD40F1B14DA9C273D0CED723EF"
            License = "MIT"
            SourceCommit = "ddb0874bd28691d90825cd91bea3a19450d367f1"
        }
        @{
            Folder = "KRPC.WoobiesMechJeb"
            File = "KRPC.WoobiesMechJeb.dll"
            Version = "0.8.6.0"
            Sha256 = "0B6EF8FDF2567F6BDD80C639C06C3707B02C6B6BDEDEF65A8DE9EEED3FF94C3A"
            License = "GPL-3.0-only"
            SourceCommit = "25e80bf1fe0da4426759e919b378488a13b93534"
            SourceArchive = "KRPC.WoobiesMechJeb-0.8.6-source.zip"
            SourceArchiveSha256 = "E65E11040E9AA55F961CC1EA42F67E406CEC759FB6A9F5F69B16150DE5B871F5"
            RequiredPackageFiles = @("LICENSE", "NOTICE.md")
        }
    )

    ThirdParty = @(
        @{
            Name = "React"
            Version = "19.2.7"
            License = "MIT"
            Source = "https://github.com/facebook/react"
        }
        @{
            Name = "React DOM"
            Version = "19.2.7"
            License = "MIT"
            Source = "https://github.com/facebook/react"
        }
        @{
            Name = "Scheduler"
            Version = "0.27.0"
            License = "MIT"
            Source = "https://github.com/facebook/react"
        }
        @{
            Name = "ResonantOrbitCalculator"
            Commit = "09da28df5422f8d060d1a03a9c9a391f01a01351"
            License = "MIT"
            Source = "https://github.com/linuxgurugamer/ResonantOrbitCalculator"
        }
        @{
            Name = "Eric Meyer's original Resonant Orbit Calculator"
            License = "MIT"
            Source = "https://meyerweb.com/eric/ksp/resonant-orbits/"
        }
    )

    IntegrationCredit = @{
        Name = "MechJeb 2"
        Source = "https://github.com/MuMech/MechJeb2"
        Placement = @("README", "release notes", "package notices", "service source")
        DashboardCreditRequired = $false
        Bundled = $false
        AffiliatedOrEndorsed = $false
    }

    Screenshots = @(
        "space-center-overview.png",
        "resonant-orbit-planner.png",
        "delta-v-planner.png",
        "editor-vab-mission-plan.png",
        "flight-dashboard-mission-planning.png"
    )
}
