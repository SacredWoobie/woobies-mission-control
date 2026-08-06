import unittest
from unittest import mock

import telemetry_server


class MissingStockControl:
    @property
    def current_stage(self):
        raise AttributeError("not exposed")


class FakeVessel:
    def __init__(self, stock_stage=None):
        if stock_stage is None:
            self.control = MissingStockControl()
        else:
            self.control = type("Control", (), {"current_stage": stock_stage})()
        self.resources = type("Resources", (), {
            "names": ["LiquidFuel"],
            "amount": lambda _self, _name: 100.0,
            "max": lambda _self, _name: 200.0,
        })()


class ResourceTelemetryTests(unittest.TestCase):
    def setUp(self):
        telemetry_server._HAS_CURRENT_STAGE = None
        telemetry_server._STAGE_STATS_CURRENT_STAGE_REPORTED = False

    def test_prefers_stock_current_stage_over_stage_stats_snapshot(self):
        vessel = FakeVessel(stock_stage=4)
        stage_snapshot = {"stage.currentKsp": 7}

        self.assertEqual(
            telemetry_server._current_stage(vessel, stage_snapshot),
            4,
        )
        self.assertTrue(telemetry_server._HAS_CURRENT_STAGE)

    def test_falls_back_to_stage_stats_when_stock_property_is_missing(self):
        vessel = FakeVessel()

        self.assertEqual(
            telemetry_server._current_stage(
                vessel, {"stage.currentKsp": 7}
            ),
            7,
        )
        self.assertFalse(telemetry_server._HAS_CURRENT_STAGE)

    def test_missing_or_invalid_stage_stats_value_fails_closed(self):
        vessel = FakeVessel()

        self.assertIsNone(
            telemetry_server._current_stage(vessel, {})
        )
        self.assertIsNone(
            telemetry_server._current_stage(
                vessel, {"stage.currentKsp": -1}
            )
        )

    def test_negative_stock_stage_fails_closed(self):
        self.assertIsNone(
            telemetry_server._current_stage(
                FakeVessel(stock_stage=-1),
                {"stage.currentKsp": 7},
            )
        )
        self.assertTrue(telemetry_server._HAS_CURRENT_STAGE)

    def test_failed_stage_poll_invalidates_current_stage_authority(self):
        authority = telemetry_server._current_stage_authority({
            "stage.available": True,
            "stage.currentKsp": 7,
        })
        self.assertEqual(authority, {"stage.currentKsp": 7})

        authority = telemetry_server._current_stage_authority({})
        self.assertEqual(authority, {})

    def test_explicit_fallback_stage_populates_current_resource_values(self):
        vessel = FakeVessel()
        with mock.patch.object(
            telemetry_server,
            "_current_stage_resource_values",
            return_value=(6, 7, {"LiquidFuel": (40.0, 80.0)}),
        ) as gather_stage:
            result = telemetry_server._gather_resources(
                vessel,
                current_stage=7,
            )

        gather_stage.assert_called_once_with(vessel, 7)
        self.assertEqual(result["res.status"], "known")
        self.assertTrue(result["res.stageKnown"])
        self.assertEqual(result["res.stageResourceStage"], 6)
        self.assertEqual(result["res.stageActivationStage"], 7)
        self.assertEqual(result["r.resourceCurrent[LiquidFuel]"], 40.0)
        self.assertEqual(result["r.resourceCurrentMax[LiquidFuel]"], 80.0)

    def test_marks_partial_and_unavailable_resource_sources(self):
        vessel = FakeVessel(stock_stage=0)
        vessel.resources = type("Resources", (), {
            "names": ["LiquidFuel", "Oxidizer"],
            "amount": lambda _self, name: 100.0 if name == "LiquidFuel" else (_ for _ in ()).throw(RuntimeError("RPC failed")),
            "max": lambda _self, _name: 200.0,
        })()

        partial = telemetry_server._gather_resources(vessel, current_stage=None)
        unavailable = telemetry_server._gather_resources(
            type("Vessel", (), {
                "resources": property(lambda _self: (_ for _ in ()).throw(RuntimeError("RPC failed"))),
            })(),
            current_stage=None,
        )

        self.assertEqual(partial["res.status"], "incomplete")
        self.assertEqual(unavailable, {"res.status": "unknown"})


if __name__ == "__main__":
    unittest.main()
