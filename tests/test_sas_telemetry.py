import unittest
from types import SimpleNamespace

import telemetry_server


class SasTelemetryTests(unittest.TestCase):
    def test_reports_stock_and_active_smart_ass_independently(self):
        vessel = SimpleNamespace(control=SimpleNamespace(
            sas=True,
            sas_mode="SASMode.prograde",
        ))
        conn = SimpleNamespace(mech_jeb=SimpleNamespace(
            api_ready=True,
            smart_ass=SimpleNamespace(
                autopilot_mode="SmartASSAutopilotMode.orbit_prograde",
            ),
        ))

        self.assertEqual(telemetry_server._gather_sas(conn, vessel), {
            "krpc.sas": True,
            "krpc.sasMode": "SASMode.prograde",
            "mj.sasMode": "SmartASSAutopilotMode.orbit_prograde",
            "mj.sasActive": True,
        })

    def test_marks_smart_ass_off_and_keeps_stock_mode(self):
        vessel = SimpleNamespace(control=SimpleNamespace(
            sas=True,
            sas_mode="SASMode.maneuver",
        ))
        conn = SimpleNamespace(mech_jeb=SimpleNamespace(
            api_ready=True,
            smart_ass=SimpleNamespace(
                autopilot_mode="SmartASSAutopilotMode.off",
            ),
        ))

        result = telemetry_server._gather_sas(conn, vessel)
        self.assertFalse(result["mj.sasActive"])
        self.assertTrue(result["krpc.sas"])
        self.assertEqual(result["krpc.sasMode"], "SASMode.maneuver")


if __name__ == "__main__":
    unittest.main()
