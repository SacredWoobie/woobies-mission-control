@{
    # Development selection for CHANGELOG.md's Unreleased section. The source
    # still identifies as the public 0.5.1 baseline until a release version is
    # deliberately selected; Release-Pack-v0.5.1.psd1 remains the immutable
    # authority for the published v0.5.1 service set.
    ReleaseState = "Unreleased"
    ProductVersion = "0.5.1"
    Krpc = @{
        Version = "0.6.0"
        PackageSha256 = "6B4399A8DB57C41DD15323FCD79DC3AA440999AEFED808729A5C850BAC1A17C8"
        PackageUrl = "https://github.com/krpc/krpc/releases/download/v0.6.0/krpc-0.6.0.zip"
        CoreAssemblies = @{
            "KRPC.dll" = "5AA1D0CDC8EECDE0A3EFBF16DEE8BFA575F4ACD94E8960619F642861F7AFD2E4"
            "KRPC.Core.dll" = "0C7E447FC801C41D38169E82E39CB06C04DF9973A4D6AFA9D4C12E76AB313AD8"
            "KRPC.SpaceCenter.dll" = "EF3855F132477D3DD7C3A8FB8AAE1FBBE8CCA54F23BEC5C333C04A91665BD8A4"
            "Google.Protobuf.dll" = "2210E190ECFA7B27F48B6601FDAD544E8ADB0A9BDCB70D775C8BBDD5E48B5CEE"
        }
    }
    Services = @(
        @{
            Folder = "WoobiesControlStats"
            File = "WoobiesControlStats.dll"
            Version = "0.2.11.0"
            Sha256 = "3E82E0D39C723AD9CF18C33A3237EE123CDBE996B8FED4ADF37541743B6FBA17"
            License = "MIT"
            SourceCommit = "4b8dedfbfe7c3f0b07941e2f410fc2369983fd18"
        }
        @{
            Folder = "KRPC.StageStats"
            File = "KRPC.StageStats.dll"
            Version = "0.2.8.0"
            Sha256 = "20DA352A76AB030EBF8B4BD11DB386387CBDCF8567CE54A0F12A5CE2AB512B07"
            License = "MIT"
            SourceCommit = "f21a30016ab938e1e2bde1f1bf9e133442e3a45c"
        }
        @{
            Folder = "KRPC.SystemHeat"
            File = "KRPC.SystemHeat.dll"
            Version = "0.2.10.0"
            Sha256 = "4077982BC2F2E6A49383E639695D4A81F1D33D0DE8C7D96E978B581BEED17D28"
            License = "MIT"
            SourceCommit = "f21a30016ab938e1e2bde1f1bf9e133442e3a45c"
        }
        @{
            Folder = "KRPC.WoobiesMechJeb"
            File = "KRPC.WoobiesMechJeb.dll"
            Version = "0.8.10.0"
            Sha256 = "67CFC7B3ED7E347F223AACCED5A827A5691DA2CA230B955DBD68FD63DB03A30D"
            License = "GPL-3.0-only"
            SourceCommit = "951cdac773a458e076a8153be209f73ff4db22e5"
            SourceArchive = "KRPC.WoobiesMechJeb-0.8.10-source.zip"
            SourceArchiveSha256 = "0FECF86DA3F014A7D4D5E5091A80FE1A173C11CA01ED240DD67DFE63165637BD"
            RequiredPackageFiles = @("LICENSE", "NOTICE.md")
        }
    )
}
