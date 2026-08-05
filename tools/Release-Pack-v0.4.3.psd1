@{
    ProductVersion = "0.4.3"
    Status = "release-candidate"

    Services = @(
        @{
            Folder = "WoobiesControlStats"
            File = "WoobiesControlStats.dll"
            Version = "0.2.6.0"
            Sha256 = "B6041F1D8C403C82342B8288B86BEA6139E7949E808E6DD27CC471F73A32A088"
            License = "MIT"
            SourceCommit = "6e3c72f8efdd0637979dac6fabf8d305eec7a123"
            EmbeddedInformationalCommit = "db0e393519a61253634ae773b8a3c7b3a249bab0"
            BuildProvenance = "Built from the completed 6e3c72f source snapshot before that snapshot was committed; the assembly informational version therefore retains the preceding HEAD."
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
            Version = "0.2.9.0"
            Sha256 = "D253044319E44FAFC19F8DB59415339BE8E42BFE9643E44A19332092239C22C4"
            License = "MIT"
            SourceCommit = "341c0edfc3b2ee95af459489f59ada02f92c2fcf"
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
