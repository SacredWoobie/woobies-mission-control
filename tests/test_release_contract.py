import importlib.util
import json
import re
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
        self.assertEqual(
            {name: version.rsplit(".0", 1)[0] for name, version in services.items()},
            launcher.SERVICE_TESTED_VERSIONS,
        )

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

    def test_release_inputs_include_current_scene_images(self):
        publish_script = (ROOT / "tools" / "Publish-Release.ps1").read_text(
            encoding="utf-8"
        )
        screenshot_brief = (
            ROOT / "docs" / "images" / "v0.4.0" / "README.md"
        ).read_text(encoding="utf-8")
        gallery_brief, supplemental_brief = screenshot_brief.split(
            "## Supplemental documentation captures", 1
        )
        required = re.findall(r"`([^`]+\.png)`", gallery_brief)
        supplemental = re.findall(r"`([^`]+\.png)`", supplemental_brief)
        self.assertEqual(len(required), 5)
        self.assertIn(
            "docs/images/v0.4.2/space-center-overview.png", publish_script
        )
        for name in required[1:]:
            self.assertIn(f"docs/images/v0.4.0/{name}", publish_script)
        for name in supplemental:
            self.assertNotIn(f"docs/images/v0.4.0/{name}", publish_script)
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
                "zz-02-resonant-orbit-planner.png",
                "zz-03-delta-v-planner.png",
                "zz-04-editor-vab-mission-plan.png",
                "zz-05-flight-dashboard-mission-planning.png",
            ],
        )
        zip_name = "Woobies-Mission-Control-v0.4.2.zip"
        release_image_names = [
            f"Woobies-Mission-Control-v0.4.2.{name}" for name in image_names
        ]
        self.assertEqual(
            sorted([zip_name, *release_image_names], key=str.casefold)[0], zip_name
        )
        self.assertIn("$zipPath, $checksumPath", publish_script)
        self.assertIn(
            ") + $sourceArchiveOutputPaths + $releaseImagePaths + @(",
            publish_script,
        )

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
