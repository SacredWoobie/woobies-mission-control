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

    def test_development_manifest_records_krpc_060_service_cohort(self):
        manifest = (
            ROOT / "tools" / "Release-Manifest.psd1"
        ).read_text(encoding="utf-8")
        spec = importlib.util.spec_from_file_location(
            "krpc_release_launcher", ROOT / "ksp_dashboard_app.py"
        )
        launcher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(launcher)

        self.assertIn('ReleaseState = "Unreleased"', manifest)
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
            r'Version = "0\.2\.13\.0".*?'
            r'Sha256 = "F26AD928F51530C7CC6D3BF5EFC6163A9CE90D691DF52002039F05552AB9BA92".*?'
            r'SourceCommit = "f944cb6952d93e06046a41050d1f45bdce19aa3f"',
        )

    def test_unreleased_manifest_cannot_be_packaged_as_v051(self):
        publish_script = (ROOT / "tools" / "Publish-Release.ps1").read_text(
            encoding="utf-8"
        )
        release_process = (ROOT / "docs" / "RELEASE_PROCESS.md").read_text(
            encoding="utf-8"
        )

        self.assertIn("$manifest.ReleaseState -eq 'Unreleased'", publish_script)
        self.assertIn("Choose and align the product release version", publish_script)
        self.assertIn("not the published v0.5.1 service set", release_process)

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
            "Current public release: **[v0.5.1]"
            "(https://github.com/SacredWoobie/woobies-mission-control/"
            "releases/tag/v0.5.1)**",
            readme,
        )
        self.assertIn("The v0.5.1 public release selects", readme)
        self.assertNotIn("Next release candidate", readme)
        self.assertNotIn("v0.5.1 release candidate", readme)

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
            ROOT / "docs" / "images" / "v0.5.1" / "README.md"
        ).read_text(encoding="utf-8")
        required = re.findall(
            r"\| \d \| (?:not ready|ready|captured|approved) "
            r"\| `([^`]+\.png)` \|",
            screenshot_brief,
        )
        self.assertEqual(len(required), 5)
        for name in required:
            self.assertIn(f"docs/images/v0.5.1/{name}", publish_script)
            image = (
                ROOT / "docs" / "images" / "v0.5.1" / name
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
                "zz-04-flight-monitor.png",
                "zz-05-flight-plan-workspace.png",
            ],
        )
        zip_name = "Woobies-Mission-Control-v0.5.1.zip"
        checksum_name = f"{zip_name}.sha256"
        release_image_names = [
            f"Woobies-Mission-Control-v0.5.1.{name}" for name in image_names
        ]
        source_archive_name = (
            "Woobies-Mission-Control-v0.5.1.zz-00-"
            "KRPC.WoobiesMechJeb-0.8.6-source.zip"
        )
        self.assertEqual(
            sorted(
                [
                    zip_name,
                    checksum_name,
                    source_archive_name,
                    *release_image_names,
                ],
                key=str.casefold,
            ),
            [
                zip_name,
                checksum_name,
                source_archive_name,
                *release_image_names,
            ],
        )
        self.assertIn(
            '"$packageName.zz-00-$($_.SourceArchive)"', publish_script
        )
        self.assertIn("$zipPath, $checksumPath", publish_script)
        self.assertIn(
            ") + $sourceArchiveOutputPaths + $releaseImagePaths + @(",
            publish_script,
        )

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

    def test_release_package_includes_runtime_and_license_materials(self):
        publish_script = (ROOT / "tools" / "Publish-Release.ps1").read_text(
            encoding="utf-8"
        )
        for module in (
            "electricity.py",
            "heat.py",
            "mission_planning.py",
            "planner_persistence.py",
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


if __name__ == "__main__":
    unittest.main()
