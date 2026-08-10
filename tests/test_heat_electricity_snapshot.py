import base64
import unittest
from types import SimpleNamespace
from unittest import mock

from heat_electricity_snapshot import decode_heat_electricity_snapshot
from telemetry_server import _gather_heat_electricity_preferred


VESSEL_ID = "11111111-2222-3333-4444-555555555555"


def text(value):
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


def snapshot(*, vessel_id=VESSEL_ID, component_count=1):
    lines = [
        "\t".join([
            "WMC_HEAT_ELECTRICITY", "1", vessel_id, "1", "1",
            str(component_count), "1", "1", "120", "80", "45",
            "1", "0.75", "2", "12.5", "0.5",
        ]),
        "\t".join([
            "L", "1", "700", "120", "80", "800", "40", "1",
            "1", text("online"), text("stop"), "1",
        ]),
        "\t".join(["D", "1", "10"]),
        "\t".join([
            "C", "1", "10", "120", text("Reactor\tOne"),
            text("ModuleSystemHeatFissionReactor"), text("producer"),
        ]),
        "\t".join([
            "R", "0", "10", text("fission"), text("Reactor\nOne"),
            "1", text("Nominal"), "40", "60", "750", "800",
            text("59y"), text("life"), "100", text("stop"),
            text("not_applicable"), "-", "1", "99", text(""),
            text(""),
        ]),
    ]
    return "\n".join(lines) + "\n"


class HeatElectricitySnapshotTests(unittest.TestCase):
    def test_decodes_complete_snapshot_to_existing_flat_contract(self):
        result = decode_heat_electricity_snapshot(
            snapshot(), expected_vessel_id=VESSEL_ID
        )

        self.assertEqual(result["schema"], 1)
        self.assertEqual(result["heat"]["heat.backend"], "system_heat")
        loop = result["heat"]["heat.loops"][0]
        self.assertEqual(loop["radiatorPartIds"], [10])
        self.assertEqual(loop["radiatorControlAction"], "stop")
        self.assertEqual(loop["producers"][0]["name"], "Reactor\tOne")
        elec = result["electricity"]
        self.assertEqual(elec["elec.reactorsStatus"], "known")
        self.assertEqual(elec["elec.reactors"][0]["name"], "Reactor\nOne")
        self.assertEqual(elec["rtg.outputEcPerSec"], 0.75)
        self.assertEqual(elec["solar.outputEcPerSec"], 12.5)
        self.assertEqual(elec["elec.totalGenEcPerSec"], 57.5)
        self.assertEqual(elec["elec.otherEcPerSec"], 4.25)

    def test_one_preferred_call_avoids_all_legacy_procedures(self):
        service = SimpleNamespace(
            telemetry_snapshot=mock.Mock(return_value=snapshot())
        )
        result = _gather_heat_electricity_preferred(
            SimpleNamespace(system_heat=service), VESSEL_ID
        )

        service.telemetry_snapshot.assert_called_once_with()
        self.assertIsNotNone(result)
        self.assertFalse(hasattr(service, "available"))

    def test_absent_failing_or_malformed_service_signals_same_poll_fallback(self):
        cases = [
            SimpleNamespace(),
            SimpleNamespace(
                system_heat=SimpleNamespace(
                    telemetry_snapshot=mock.Mock(
                        side_effect=RuntimeError("RPC failed")
                    )
                )
            ),
            SimpleNamespace(
                system_heat=SimpleNamespace(
                    telemetry_snapshot=mock.Mock(return_value="broken")
                )
            ),
        ]
        for conn in cases:
            with self.subTest(conn=conn):
                self.assertIsNone(
                    _gather_heat_electricity_preferred(conn, VESSEL_ID)
                )

    def test_rejects_stale_incomplete_and_nonfinite_payloads(self):
        malformed = [
            (snapshot(vessel_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"), VESSEL_ID),
            (snapshot(component_count=2), VESSEL_ID),
            (snapshot().replace("\t120\t80\t45\t", "\tnan\t80\t45\t", 1), VESSEL_ID),
            (snapshot().replace(text("online"), text("mystery"), 1), VESSEL_ID),
        ]
        for payload, expected in malformed:
            with self.subTest(payload=payload[:80]):
                with self.assertRaises(ValueError):
                    decode_heat_electricity_snapshot(
                        payload, expected_vessel_id=expected
                    )

    def test_accepts_electricity_snapshot_without_system_heat_simulator(self):
        payload = "\t".join([
            "WMC_HEAT_ELECTRICITY", "1", VESSEL_ID, "0", "0", "0",
            "0", "0", "0", "0", "0.75", "1", "0.75", "0",
            "0", "0",
        ]) + "\n"
        result = decode_heat_electricity_snapshot(
            payload, expected_vessel_id=VESSEL_ID
        )
        self.assertIsNone(result["heat"])
        self.assertEqual(
            result["electricity"]["elec.reactorsStatus"],
            "not_applicable",
        )
        self.assertEqual(result["electricity"]["elec.totalGenEcPerSec"], 0.75)


if __name__ == "__main__":
    unittest.main()
