import ast
import importlib.util
import json
import re
import struct
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_manifest(path):
    text = path.read_text(encoding="utf-8")
    product = re.search(r'ProductVersion\s*=\s*"([^"]+)"', text).group(1)
    services = {
        folder: version
        for folder, version in re.findall(
            r'Folder\s*=\s*"([^"]+)".*?Version\s*=\s*"([^"]+)"',
            text,
            re.DOTALL,
        )
    }
    return product, services


class ReleaseContractTests(unittest.TestCase):
    def test_v040_release_pack_records_licenses_sources_and_screenshot_slots(self):
        release_pack = (
            ROOT / "tools" / "Release-Pack-v0.4.0.psd1"
        ).read_text(encoding="utf-8")

        self.assertIn('ProductVersion = "0.4.0"', release_pack)
        expected_services = {
            "WoobiesControlStats": (
                "0.2.1.0",
                "8ADFC473189A0BE978E4DFB29CE66BD734C81BC4F7496D972DE2F4DBB9E12AA4",
            ),
            "KRPC.StageStats": (
                "0.2.5.0",
                "FDCACF4BDB71551BC80FD06C2522C1C5620A5E146B4B667B8128CDF7740CF67E",
            ),
            "KRPC.SystemHeat": (
                "0.2.2.0",
                "2265CC09E391A629D5281EA0BB74B47CBC4311AD40F1B14DA9C273D0CED723EF",
            ),
            "KRPC.WoobiesMechJeb": (
                "0.8.6.0",
                "0B6EF8FDF2567F6BDD80C639C06C3707B02C6B6BDEDEF65A8DE9EEED3FF94C3A",
            ),
        }
        for service, (version, sha256) in expected_services.items():
            self.assertRegex(
                release_pack,
                rf'(?s)Folder = "{re.escape(service)}".*?'
                rf'Version = "{re.escape(version)}".*?'
                rf'Sha256 = "{sha256}"',
            )

        self.assertIn('License = "GPL-3.0-only"', release_pack)
        self.assertIn(
            'SourceCommit = "25e80bf1fe0da4426759e919b378488a13b93534"',
            release_pack,
        )
        self.assertIn(
            'SourceArchive = "KRPC.WoobiesMechJeb-0.8.6-source.zip"',
            release_pack,
        )
        self.assertIn(
            'SourceArchiveSha256 = '
            '"E65E11040E9AA55F961CC1EA42F67E406CEC759FB6A9F5F69B16150DE5B871F5"',
            release_pack,
        )
        self.assertIn('RequiredPackageFiles = @("LICENSE", "NOTICE.md")', release_pack)
        self.assertIn('DashboardCreditRequired = $false', release_pack)
        self.assertIn('Bundled = $false', release_pack)

        for dependency in (
            "React",
            "React DOM",
            "Scheduler",
            "ResonantOrbitCalculator",
            "Eric Meyer's original Resonant Orbit Calculator",
        ):
            self.assertIn(f'Name = "{dependency}"', release_pack)

        screenshot_brief = (
            ROOT / "docs" / "images" / "v0.4.0" / "README.md"
        ).read_text(encoding="utf-8")
        screenshot_names = re.findall(
            r"\| \d \| (?:not ready|ready|captured|approved) "
            r"\| `([^`]+\.png)` \|",
            screenshot_brief,
        )
        self.assertEqual(
            screenshot_names,
            [
                "space-center-overview.png",
                "resonant-orbit-planner.png",
                "delta-v-planner.png",
                "editor-vab-mission-plan.png",
                "flight-dashboard-mission-planning.png",
            ],
        )

    def test_v041_release_pack_selects_committed_stagestats(self):
        release_pack = (
            ROOT / "tools" / "Release-Pack-v0.4.1.psd1"
        ).read_text(encoding="utf-8")

        self.assertIn('ProductVersion = "0.4.1"', release_pack)
        self.assertRegex(
            release_pack,
            r'(?s)Folder = "KRPC\.StageStats".*?'
            r'Version = "0\.2\.7\.0".*?'
            r'Sha256 = "18AE2F6D14B63476E37F2EC052119E49C421043FDB1A63F0C9BBED05D5A265EC".*?'
            r'SourceCommit = "f74c49fd4c335a73a4377eee71e19724356945d3"',
        )
        self.assertIn(
            'SourceArchive = "KRPC.WoobiesMechJeb-0.8.6-source.zip"',
            release_pack,
        )
        self.assertIn(
            'SourceArchiveSha256 = '
            '"E65E11040E9AA55F961CC1EA42F67E406CEC759FB6A9F5F69B16150DE5B871F5"',
            release_pack,
        )

    def test_v042_release_pack_selects_vessel_management_service(self):
        release_pack = (
            ROOT / "tools" / "Release-Pack-v0.4.2.psd1"
        ).read_text(encoding="utf-8")

        self.assertIn('ProductVersion = "0.4.2"', release_pack)
        self.assertRegex(
            release_pack,
            r'(?s)Folder = "WoobiesControlStats".*?'
            r'Version = "0\.2\.3\.0".*?'
            r'Sha256 = "CB5E720A3FA7EDF64CC09C946F749006B737ACE8881682D8F76AC6C8B1E99F22".*?'
            r'SourceCommit = "c655ae1806af21d8420278e386c9b4e99964c32c"',
        )

    def test_v043_release_pack_selects_flight_system_services(self):
        release_pack = (
            ROOT / "tools" / "Release-Pack-v0.4.3.psd1"
        ).read_text(encoding="utf-8")

        self.assertIn('ProductVersion = "0.4.3"', release_pack)
        expected_services = {
            "WoobiesControlStats": (
                "0.2.6.0",
                "B6041F1D8C403C82342B8288B86BEA6139E7949E808E6DD27CC471F73A32A088",
                "6e3c72f8efdd0637979dac6fabf8d305eec7a123",
            ),
            "KRPC.SystemHeat": (
                "0.2.9.0",
                "D253044319E44FAFC19F8DB59415339BE8E42BFE9643E44A19332092239C22C4",
                "341c0edfc3b2ee95af459489f59ada02f92c2fcf",
            ),
        }
        for service, (version, sha256, source_commit) in expected_services.items():
            self.assertRegex(
                release_pack,
                rf'(?s)Folder = "{re.escape(service)}".*?'
                rf'Version = "{re.escape(version)}".*?'
                rf'Sha256 = "{sha256}".*?'
                rf'SourceCommit = "{source_commit}"',
            )
        self.assertIn(
            'EmbeddedInformationalCommit = '
            '"db0e393519a61253634ae773b8a3c7b3a249bab0"',
            release_pack,
        )
        self.assertIn("assembly informational version", release_pack)

    def test_v044_release_pack_preserves_v043_service_set(self):
        release_pack = (
            ROOT / "tools" / "Release-Pack-v0.4.4.psd1"
        ).read_text(encoding="utf-8")

        self.assertIn('ProductVersion = "0.4.4"', release_pack)
        for service, version, sha256 in (
            (
                "WoobiesControlStats",
                "0.2.6.0",
                "B6041F1D8C403C82342B8288B86BEA6139E7949E808E6DD27CC471F73A32A088",
            ),
            (
                "KRPC.StageStats",
                "0.2.7.0",
                "18AE2F6D14B63476E37F2EC052119E49C421043FDB1A63F0C9BBED05D5A265EC",
            ),
            (
                "KRPC.SystemHeat",
                "0.2.9.0",
                "D253044319E44FAFC19F8DB59415339BE8E42BFE9643E44A19332092239C22C4",
            ),
            (
                "KRPC.WoobiesMechJeb",
                "0.8.6.0",
                "0B6EF8FDF2567F6BDD80C639C06C3707B02C6B6BDEDEF65A8DE9EEED3FF94C3A",
            ),
        ):
            self.assertRegex(
                release_pack,
                rf'(?s)Folder = "{re.escape(service)}".*?'
                rf'Version = "{re.escape(version)}".*?Sha256 = "{sha256}"',
            )

    def test_v050_release_pack_reuses_the_v044_service_set(self):
        v044_product, v044_services = read_manifest(
            ROOT / "tools" / "Release-Pack-v0.4.4.psd1"
        )
        v050_product, v050_services = read_manifest(
            ROOT / "tools" / "Release-Pack-v0.5.0.psd1"
        )

        self.assertEqual(v044_product, "0.4.4")
        self.assertEqual(v050_product, "0.5.0")
        self.assertEqual(v050_services, v044_services)

    def test_v051_release_pack_remains_immutable(self):
        v051_product, v051_services = read_manifest(
            ROOT / "tools" / "Release-Pack-v0.5.1.psd1"
        )

        self.assertEqual(v051_product, "0.5.1")
        self.assertEqual(v051_services["WoobiesControlStats"], "0.2.7.0")

    def test_v060_release_pack_remains_immutable(self):
        v060_product, v060_services = read_manifest(
            ROOT / "tools" / "Release-Pack-v0.6.0.psd1"
        )

        self.assertEqual(v060_product, "0.6.0")
        self.assertEqual(v060_services["WoobiesControlStats"], "0.2.16.0")

    def test_v061_release_pack_remains_immutable(self):
        v061_product, v061_services = read_manifest(
            ROOT / "tools" / "Release-Pack-v0.6.1.psd1"
        )

        self.assertEqual(v061_product, "0.6.1")
        self.assertEqual(v061_services["WoobiesControlStats"], "0.2.16.0")

    def test_v070_release_manifest_records_krpc_060_service_cohort(self):
        manifest = (
            ROOT / "tools" / "Release-Manifest.psd1"
        ).read_text(encoding="utf-8")
        spec = importlib.util.spec_from_file_location(
            "krpc_release_launcher", ROOT / "ksp_dashboard_app.py"
        )
        launcher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(launcher)

        self.assertIn('ReleaseState = "Release"', manifest)
        self.assertIn('ProductVersion = "0.7.0"', manifest)
        self.assertIn('Version = "0.6.0"', manifest)
        self.assertIn(
            'PackageSha256 = "6B4399A8DB57C41DD15323FCD79DC3AA440999AEFED808729A5C850BAC1A17C8"',
            manifest,
        )
        for definition in launcher.KSP_PREREQUISITES:
            expected_sha256 = definition.get("expected_sha256")
            if expected_sha256 is not None:
                self.assertIn(expected_sha256.upper(), manifest)
        self.assertRegex(
            manifest,
            r'(?s)Folder = "WoobiesControlStats".*?'
            r'Version = "0\.2\.21\.0".*?'
            r'Sha256 = "F2F58ADF5EEC66E4A01EE853F14111F73FC21592FA9965B340F0E1EC8DDCD4F2".*?'
            r'SourceCommit = "5732f928158bde6c5df288d33565f2a7924c14ec"',
        )
        self.assertRegex(
            manifest,
            r'(?s)Folder = "KRPC\.SystemHeat".*?'
            r'Version = "0\.2\.11\.0".*?'
            r'Sha256 = "6205C91B64A1B39B7F64BA418AC2CE26CDBC2A68637C2E0C8EA5AB69A6CF8202".*?'
            r'SourceCommit = "5b15ecd83b95150c7a91006e2c49813a7ea9d6a1"',
        )

    def test_v070_release_pack_matches_the_selected_manifest(self):
        publish_script = (ROOT / "tools" / "Publish-Release.ps1").read_text(
            encoding="utf-8"
        )
        release_process = (ROOT / "docs" / "RELEASE_PROCESS.md").read_text(
            encoding="utf-8"
        )
        manifest_product, manifest_services = read_manifest(
            ROOT / "tools" / "Release-Manifest.psd1"
        )
        pack_product, pack_services = read_manifest(
            ROOT / "tools" / "Release-Pack-v0.7.0.psd1"
        )

        self.assertIn("$manifest.ReleaseState -eq 'Unreleased'", publish_script)
        self.assertIn("Choose and align the product release version", publish_script)
        self.assertEqual(manifest_product, "0.7.0")
        self.assertEqual(pack_product, manifest_product)
        self.assertEqual(pack_services, manifest_services)
        self.assertIn("v0.7.0 release manifest selects", release_process)

    def test_product_versions_and_service_selection_are_aligned(self):
        spec = importlib.util.spec_from_file_location(
            "release_launcher", ROOT / "ksp_dashboard_app.py"
        )
        launcher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(launcher)

        package = json.loads(
            (ROOT / "frontend" / "package.json").read_text(encoding="utf-8")
        )
        product, services = read_manifest(ROOT / "tools" / "Release-Manifest.psd1")

        self.assertEqual(product, launcher.APP_VERSION)
        self.assertEqual(package["version"], launcher.APP_VERSION)
        self.assertIn(
            f'PRODUCT_VERSION = "{launcher.APP_VERSION}"',
            (ROOT / "frontend" / "src" / "buildIdentity.ts").read_text(
                encoding="utf-8"
            ),
        )
        self.assertIn(
            f"VERSION {launcher.APP_VERSION}",
            (ROOT / "QUICKSTART.txt").read_text(encoding="utf-8"),
        )
        self.assertEqual(
            {name: version.rsplit(".0", 1)[0] for name, version in services.items()},
            launcher.SERVICE_TESTED_VERSIONS,
        )

    def test_readme_identifies_the_current_public_release(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")

        self.assertIn(
            "Current public release: **[v0.7.0]"
            "(https://github.com/SacredWoobie/woobies-mission-control/"
            "releases/tag/v0.7.0)**",
            readme,
        )
        self.assertIn("The v0.7.0 public release selects", readme)
        self.assertNotIn("Next release candidate", readme)
        self.assertNotIn("v0.7.0 release candidate", readme)

    def test_only_react_loopback_runtime_is_supported(self):
        self.assertFalse((ROOT / "ksp_mission_dashboard.html").exists())
        self.assertFalse((ROOT / "Start React POC.bat").exists())
        self.assertFalse((ROOT / "Stop React POC.bat").exists())
        self.assertTrue((ROOT / "frontend" / "src" / "App.tsx").is_file())
        self.assertTrue((ROOT / "scripts" / "dashboard-dev.ps1").is_file())

        launcher = (ROOT / "ksp_dashboard_app.py").read_text(encoding="utf-8")
        telemetry = (ROOT / "telemetry_server.py").read_text(encoding="utf-8")
        self.assertIn('DASHBOARD = HERE / "web" / "index.html"', launcher)
        self.assertIn('DASHBOARD_URL = "http://127.0.0.1:8090/"', launcher)
        self.assertIn('DASHBOARD_WEB_ROOT = Path(__file__).resolve().parent / "web"', telemetry)

    def test_managed_frontend_server_uses_the_configured_vite_port(self):
        dev_script = (ROOT / "scripts" / "dashboard-dev.ps1").read_text(
            encoding="utf-8"
        )
        vite_config = (ROOT / "frontend" / "vite.config.ts").read_text(
            encoding="utf-8"
        )
        frontend_readme = (ROOT / "frontend" / "README.md").read_text(
            encoding="utf-8"
        )

        self.assertIn('$DashboardUrl = "http://127.0.0.1:5174/"', dev_script)
        self.assertIn("port: 5174", vite_config)
        self.assertIn("http://127.0.0.1:5174/", frontend_readme)

    def test_component_specific_first_run_menu_is_packaged(self):
        menu = (ROOT / "Select Mission Control Setup.ps1").read_text(encoding="utf-8")
        batch = (ROOT / "Start KSP Dashboard.bat").read_text(encoding="utf-8")
        for option in (
            "Set up Dashboard and ESP32 Controlpad",
            "Set up just Mission Control Dashboard",
            "Set up just ESP32 Controlpad",
            "Exit",
        ):
            self.assertIn(option, menu)
        self.assertIn("UpArrow", menu)
        self.assertIn("DownArrow", menu)
        self.assertIn("requirements-dashboard.txt", batch)
        self.assertIn("requirements-panel.txt", batch)

    def test_krpc_060_python_runtime_is_pinned_for_both_components(self):
        dashboard = (ROOT / "requirements-dashboard.txt").read_text(
            encoding="utf-8"
        )
        panel = (ROOT / "requirements-panel.txt").read_text(encoding="utf-8")
        batch = (ROOT / "Start KSP Dashboard.bat").read_text(encoding="utf-8")

        for requirements in (dashboard, panel):
            self.assertIn("krpc==0.6.0", requirements)
            self.assertIn("protobuf==7.35.1", requirements)
            self.assertNotIn("krpc==0.5.4", requirements)
        self.assertIn("'krpc':'0.6.0'", batch)
        self.assertIn("'protobuf':'7.35.1'", batch)

    def test_runtime_uses_supported_krpc_060_scene_property(self):
        runtime_files = (
            "telemetry_server.py",
            "panel_bridge.py",
            "tools/probe_stage_stats.py",
            "tools/probe_mechjeb_transfer.py",
        )
        for relative_path in runtime_files:
            source = (ROOT / relative_path).read_text(encoding="utf-8")
            self.assertNotIn("current_game_scene", source, relative_path)

    def test_quickstart_keeps_the_release_outside_ksp_gamedata(self):
        quickstart = (ROOT / "QUICKSTART.txt").read_text(encoding="utf-8")
        normalized = " ".join(quickstart.split())

        self.assertIn("outside KSP's GameData folder", normalized)
        self.assertIn("Do not", normalized)
        self.assertIn("KSP loads DLLs from nested folders", normalized)
        self.assertIn(
            "Dashboard and GameData folders next to one another", normalized
        )

    def test_release_inputs_include_current_scene_images(self):
        publish_script = (ROOT / "tools" / "Publish-Release.ps1").read_text(
            encoding="utf-8"
        )
        screenshot_brief = (
            ROOT / "docs" / "images" / "v0.7.0" / "README.md"
        ).read_text(encoding="utf-8")
        required = re.findall(
            r"\| \d \| (?:not ready|ready|captured|approved) "
            r"\| `([^`]+\.png)` \|",
            screenshot_brief,
        )
        self.assertEqual(len(required), 5)
        for name in required:
            self.assertIn(f"docs/images/v0.7.0/{name}", publish_script)
            image = (
                ROOT / "docs" / "images" / "v0.7.0" / name
            ).read_bytes()
            self.assertTrue(image.startswith(b"\x89PNG\r\n\x1a\n"), name)
            self.assertEqual(struct.unpack(">II", image[16:24]), (1920, 889))
        self.assertFalse(any(" " in name or "&" in name for name in required))

    def test_release_assets_sort_zip_before_curated_images(self):
        publish_script = (ROOT / "tools" / "Publish-Release.ps1").read_text(
            encoding="utf-8"
        )
        image_names = re.findall(
            r'Name = "\$packageName\.([^\"]+\.png)"', publish_script
        )

        self.assertEqual(
            image_names,
            [
                "zz-01-space-center-overview.png",
                "zz-02-active-contract-focus.png",
                "zz-03-editor-craft-analysis.png",
                "zz-04-flight-damage-monitor.png",
                "zz-05-flight-plan-workspace.png",
            ],
        )
        zip_name = "Woobies-Mission-Control-v0.7.0.zip"
        checksum_name = f"{zip_name}.sha256"
        release_image_names = [
            f"Woobies-Mission-Control-v0.7.0.{name}" for name in image_names
        ]
        source_archive_name = (
            "Woobies-Mission-Control-v0.7.0.zz-00-"
            "KRPC.WoobiesMechJeb-0.8.10-source.zip"
        )
        update_name = (
            "Woobies-Mission-Control-v0.7.0.zz-90-runtime-update.zip"
        )
        update_checksum_name = f"{update_name}.sha256"
        self.assertEqual(
            sorted(
                [
                    zip_name,
                    checksum_name,
                    source_archive_name,
                    *release_image_names,
                    update_name,
                    update_checksum_name,
                ],
                key=str.casefold,
            ),
            [
                zip_name,
                checksum_name,
                source_archive_name,
                *release_image_names,
                update_name,
                update_checksum_name,
            ],
        )
        self.assertIn(
            '"$packageName.zz-00-$($_.SourceArchive)"', publish_script
        )
        self.assertIn("$zipPath, $checksumPath", publish_script)
        self.assertIn(
            ") + $sourceArchiveOutputPaths + $releaseImagePaths + $releaseUpdatePaths + @(",
            publish_script,
        )

    def test_release_packager_emits_verified_managed_update_contract(self):
        publish_script = (ROOT / "tools" / "Publish-Release.ps1").read_text(
            encoding="utf-8"
        )

        for packaged_source in (
            "runtime_update.py",
            "runtime_update_helper.py",
            "runtime-update-contract.json",
        ):
            self.assertIn(
                f"@{{ Source = '{packaged_source}'; Destination = "
                f"'Dashboard/{packaged_source}' }}",
                publish_script,
            )
        self.assertIn("WMC-INSTALL-MANIFEST.json", publish_script)
        self.assertIn("$packageName.zz-90-runtime-update.zip", publish_script)
        self.assertIn("compatible_updater_protocols = @(1)", publish_script)
        self.assertIn("function Sort-CanonicalManifestPaths", publish_script)
        self.assertEqual(
            publish_script.count("Sort-CanonicalManifestPaths $"),
            2,
        )
        self.assertIn("$Left.ToLowerInvariant()", publish_script)
        self.assertIn("$Right.ToLowerInvariant()", publish_script)
        self.assertIn("[System.StringComparer]::Ordinal.Compare", publish_script)
        self.assertEqual(publish_script.count("[System.Array]::Sort("), 1)
        self.assertIn("ZipFileExtensions]::CreateEntryFromFile", publish_script)
        self.assertIn("$entryName = $relativePath.Replace('\\', '/')", publish_script)
        self.assertIn("Runtime-update ZIP entries do not exactly match", publish_script)
        self.assertIn("Runtime-update ZIP hash mismatch", publish_script)
        self.assertIn("must be smaller than the normal release ZIP", publish_script)
        self.assertIn("status --porcelain", publish_script)
        self.assertIn("must be assembled from a clean Git checkout", publish_script)
        self.assertIn("runtime-update-contract.json", publish_script)
        self.assertIn("$contractLimits.archive_entries", publish_script)
        self.assertIn("$contractLimits.archive_file_bytes", publish_script)
        self.assertIn("$contractLimits.archive_expanded_bytes", publish_script)
        self.assertIn("$contractLimits.download_bytes", publish_script)
        self.assertIn("$contractLimits.checksum_bytes", publish_script)
        self.assertIn(
            "Packaged runtime paths are absent from runtime-update-contract.json",
            publish_script,
        )

        self.assertIn("repos/$Repository/immutable-releases", publish_script)
        self.assertIn("X-GitHub-Api-Version: 2026-03-10", publish_script)
        self.assertIn("$immutableSetting.enabled -ne $true", publish_script)
        self.assertNotIn("-X PUT", publish_script)
        self.assertNotIn("--method PUT", publish_script)

    def test_v050_release_notes_preserve_utf8_and_exclude_mock_only_history(self):
        publish_script = (ROOT / "tools" / "Publish-Release.ps1").read_text(
            encoding="utf-8"
        )
        changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        release_section = changelog.split(
            "## v0.5.0 - Flight dashboard workspaces", 1
        )[1].split("\n## ", 1)[0]

        self.assertIn(
            "Get-Content -LiteralPath (Join-Path $repoRoot 'CHANGELOG.md') "
            "-Raw -Encoding UTF8",
            publish_script,
        )
        self.assertIn("`Δv LIVE`", release_section)
        self.assertIn("`TWR · LIVE`", release_section)
        self.assertNotIn("mock", release_section.casefold())
        self.assertNotIn("fixture", release_section.casefold())

    def test_v051_release_notes_cover_deadlines_and_quality_gates(self):
        changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        release_section = changelog.split(
            "## v0.5.1 - Contract deadlines and UI foundations", 1
        )[1].split("\n## ", 1)[0]

        self.assertIn("authoritative live KSP deadlines", release_section)
        self.assertIn("dashboard CSS foundation", release_section)
        self.assertIn("GitHub continuous integration", release_section)
        self.assertNotIn("mock", release_section.casefold())
        self.assertNotIn("fixture", release_section.casefold())

    def test_v060_release_notes_are_user_facing(self):
        changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        release_section = changelog.split(
            "## v0.6.0 - kRPC 0.6 and faster Flight telemetry", 1
        )[1].split("\n## ", 1)[0]

        self.assertIn("persistent unexpected part-loss detection", release_section)
        self.assertIn("`DAMAGE` annunciator", release_section)
        self.assertIn("kRPC 0.6.0", release_section)
        for internal_term in (
            "worktree",
            "spike/",
            "profiler",
            "audit lane",
            "process development",
        ):
            self.assertNotIn(internal_term, release_section.casefold())

    def test_v061_release_notes_explain_the_updater_bootstrap(self):
        changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        release_section = changelog.split(
            "## v0.6.1 - Managed runtime updates", 1
        )[1].split("\n## ", 1)[0]

        self.assertIn("explicitly confirmed in-app updater", release_section)
        self.assertIn("one normal full-package install", release_section)
        self.assertIn("never writes the user's selected live KSP", release_section)
        for internal_term in (
            "worktree",
            "spike/",
            "profiler",
            "audit lane",
            "process development",
        ):
            self.assertNotIn(internal_term, release_section.casefold())

    def test_release_package_includes_runtime_and_license_materials(self):
        publish_script = (ROOT / "tools" / "Publish-Release.ps1").read_text(
            encoding="utf-8"
        )
        for module in (
            "damage.py",
            "electricity.py",
            "editor_electrical_snapshot.py",
            "flight_core_snapshot.py",
            "heat.py",
            "heat_electricity_snapshot.py",
            "mission_planning.py",
            "planner_persistence.py",
            "resource_snapshot.py",
            "stage_snapshot.py",
            "staging.py",
            "telemetry_runtime.py",
        ):
            self.assertIn(
                f"Destination = 'Dashboard/{module}'",
                publish_script,
            )
        self.assertIn(
            "Destination = 'THIRD-PARTY/NOTICES.md'",
            publish_script,
        )
        self.assertIn("RequiredPackageFiles", publish_script)
        self.assertIn("SourceArchiveSha256", publish_script)
        self.assertIn('Destination = "SOURCE/', publish_script)

    def test_packaged_python_runtime_closes_over_local_imports(self):
        publish_script = (ROOT / "tools" / "Publish-Release.ps1").read_text(
            encoding="utf-8"
        )
        packaged_sources = re.findall(
            r"@\{ Source = '([^']+\.py)'; Destination = "
            r"'Dashboard/([^']+\.py)' \}",
            publish_script,
        )
        self.assertIn(
            ("telemetry_server.py", "telemetry_server.py"), packaged_sources
        )
        packaged_modules = {
            Path(destination).stem for _, destination in packaged_sources
        }
        local_modules = {path.stem for path in ROOT.glob("*.py")}
        missing_imports = {}

        for source, destination in packaged_sources:
            tree = ast.parse((ROOT / source).read_text(encoding="utf-8"), source)
            imported_modules = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    imported_modules.update(
                        alias.name.split(".", 1)[0] for alias in node.names
                    )
                elif (
                    isinstance(node, ast.ImportFrom)
                    and node.level == 0
                    and node.module
                ):
                    imported_modules.add(node.module.split(".", 1)[0])

            missing = sorted(imported_modules & local_modules - packaged_modules)
            if missing:
                missing_imports[destination] = missing

        self.assertEqual(missing_imports, {})


if __name__ == "__main__":
    unittest.main()
