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
        image_root = ROOT / "docs" / "images" / "v0.3.0"
        required = {
            "flight-dashboard-landscape.png",
            "mission-control-landscape.png",
            "editor-vab-landscape.png",
            "launcher.png",
            "notes-drawer.png",
        }
        actual = {path.name for path in image_root.glob("*.png")}
        self.assertTrue(required.issubset(actual))
        self.assertFalse(any(" " in name or "&" in name for name in actual))

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
                "zz-01-flight-dashboard.png",
                "zz-02-mission-control.png",
                "zz-03-vab-editor.png",
                "zz-04-launcher.png",
                "zz-05-notes-drawer.png",
            ],
        )
        zip_name = "Woobies-Mission-Control-v0.3.0.zip"
        release_image_names = [
            f"Woobies-Mission-Control-v0.3.0.{name}" for name in image_names
        ]
        self.assertEqual(
            sorted([zip_name, *release_image_names], key=str.casefold)[0], zip_name
        )
        self.assertIn("$zipPath, $checksumPath", publish_script)
        self.assertIn(") + $releaseImagePaths + @(", publish_script)


if __name__ == "__main__":
    unittest.main()
