@{
    ProductVersion = "0.8.0"
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
            Version = "0.2.21.0"
            Sha256 = "F2F58ADF5EEC66E4A01EE853F14111F73FC21592FA9965B340F0E1EC8DDCD4F2"
            License = "MIT"
            SourceCommit = "5732f928158bde6c5df288d33565f2a7924c14ec"
        }
        @{
            Folder = "KRPC.StageStats"
            File = "KRPC.StageStats.dll"
            Version = "0.2.10.0"
            Sha256 = "3DC9EC805D620DA953A6879A721A7B4D2C97B7ACA21FFB2CF25991CAF0E6DDC2"
            License = "MIT"
            SourceCommit = "4a49d7d0e703b3e03e1916f14d070adb022a2b15"
        }
        @{
            Folder = "KRPC.SystemHeat"
            File = "KRPC.SystemHeat.dll"
            Version = "0.2.11.0"
            Sha256 = "6205C91B64A1B39B7F64BA418AC2CE26CDBC2A68637C2E0C8EA5AB69A6CF8202"
            License = "MIT"
            SourceCommit = "5b15ecd83b95150c7a91006e2c49813a7ea9d6a1"
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
