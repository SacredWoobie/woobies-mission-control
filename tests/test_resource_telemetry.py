import unittest
from types import SimpleNamespace
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


class CountingResources:
    def __init__(self, values):
        self.values = dict(values)
        self.names_reads = 0
        self.max_reads = 0
        self.amount_reads = 0
        self.fail_next_amount = False

    @property
    def names(self):
        self.names_reads += 1
        return list(self.values)

    def max(self, name):
        self.max_reads += 1
        return self.values[name][1]

    def amount(self, name):
        self.amount_reads += 1
        if self.fail_next_amount:
            self.fail_next_amount = False
            raise RuntimeError("stale resource proxy")
        return self.values[name][0]


class CountingParts:
    def __init__(self):
        self.items = []
        self.all_reads = 0
        self.engines = []

    @property
    def all(self):
        self.all_reads += 1
        return list(self.items)


class CountingVessel:
    def __init__(self):
        self.resources = CountingResources({
            "LiquidFuel": (100.0, 200.0),
            "Oxidizer": (120.0, 240.0),
        })
        self.stage_resources = CountingResources({
            "LiquidFuel": (40.0, 80.0),
        })
        self.stage_calls = 0
        self.parts = CountingParts()

    def resources_in_decouple_stage(self, stage, cumulative=False):
        self.stage_calls += 1
        if stage == 1 and cumulative is False:
            return self.stage_resources
        return CountingResources({})


class ResourceTelemetryTests(unittest.TestCase):
    def setUp(self):
        telemetry_server._HAS_CURRENT_STAGE = None
        telemetry_server._STAGE_STATS_CURRENT_STAGE_REPORTED = False
        telemetry_server._clear_resource_topology_cache()

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

    def test_resource_polling_is_slow_while_idle_and_fast_under_thrust(self):
        self.assertEqual(
            telemetry_server._resource_poll_interval({}),
            telemetry_server.RES_IDLE_POLL_SECONDS,
        )
        self.assertEqual(
            telemetry_server._resource_poll_interval({"krpc.throttle": 0.2}),
            telemetry_server.RES_POLL_SECONDS,
        )
        self.assertEqual(
            telemetry_server._resource_poll_interval({"v.thrust": 0.01}),
            telemetry_server.RES_POLL_SECONDS,
        )

    def test_hot_poll_reuses_names_capacities_and_stage_resolution(self):
        vessel = CountingVessel()

        first = telemetry_server._gather_resources(
            vessel,
            current_stage=2,
            resource_identity="vessel-a",
            now=100.0,
        )
        vessel.resources.values["LiquidFuel"] = (95.0, 200.0)
        second = telemetry_server._gather_resources(
            vessel,
            current_stage=2,
            resource_identity="vessel-a",
            now=101.0,
        )

        self.assertEqual(first["r.resource[LiquidFuel]"], 100.0)
        self.assertEqual(second["r.resource[LiquidFuel]"], 95.0)
        self.assertEqual(vessel.resources.names_reads, 1)
        self.assertEqual(vessel.resources.max_reads, 2)
        self.assertEqual(vessel.resources.amount_reads, 4)
        self.assertEqual(vessel.stage_resources.names_reads, 1)
        self.assertEqual(vessel.stage_resources.max_reads, 1)
        self.assertEqual(vessel.stage_resources.amount_reads, 2)
        self.assertEqual(vessel.stage_calls, 1)

    def test_topology_safety_refresh_rereads_cold_values(self):
        vessel = CountingVessel()
        telemetry_server._gather_resources(
            vessel, current_stage=2, resource_identity="vessel-a", now=100.0
        )
        vessel.resources.values["LiquidFuel"] = (90.0, 210.0)

        refreshed = telemetry_server._gather_resources(
            vessel,
            current_stage=2,
            resource_identity="vessel-a",
            now=105.0,
        )

        self.assertEqual(refreshed["r.resourceMax[LiquidFuel]"], 210.0)
        self.assertEqual(vessel.resources.names_reads, 2)
        self.assertEqual(vessel.resources.max_reads, 4)
        self.assertEqual(vessel.stage_calls, 2)
        self.assertEqual(vessel.parts.all_reads, 3)

    def test_topology_change_rebuilds_part_ownership_partition(self):
        vessel = CountingVessel()
        telemetry_server._gather_resources(
            vessel, current_stage=2, resource_identity="vessel-a", now=100.0
        )
        vessel.parts.items.append(SimpleNamespace(_object_id=7))

        telemetry_server._gather_resources(
            vessel, current_stage=2, resource_identity="vessel-a", now=105.0
        )

        self.assertEqual(vessel.parts.all_reads, 4)

    def test_stage_change_invalidates_topology_immediately(self):
        vessel = CountingVessel()
        telemetry_server._gather_resources(
            vessel, current_stage=2, resource_identity="vessel-a", now=100.0
        )
        telemetry_server._gather_resources(
            vessel, current_stage=1, resource_identity="vessel-a", now=100.1
        )

        self.assertEqual(vessel.resources.names_reads, 2)
        self.assertGreater(vessel.stage_calls, 1)

    def test_stale_hot_proxy_clears_cache_and_uses_full_scan(self):
        vessel = CountingVessel()
        telemetry_server._gather_resources(
            vessel, current_stage=2, resource_identity="vessel-a", now=100.0
        )
        vessel.resources.fail_next_amount = True

        recovered = telemetry_server._gather_resources(
            vessel,
            current_stage=2,
            resource_identity="vessel-a",
            now=101.0,
        )

        self.assertEqual(recovered["res.status"], "known")
        self.assertEqual(recovered["r.resource[LiquidFuel]"], 100.0)
        self.assertIsNone(telemetry_server._resource_topology_cache)

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
        self.assertNotIn("r.resource[Oxidizer]", partial)
        self.assertNotIn("r.resourceMax[Oxidizer]", partial)
        self.assertEqual(unavailable, {"res.status": "unknown"})

    def test_partial_poll_replaces_cached_resource_values(self):
        old_cache = {
            "res.status": "known",
            "res.names": ["LiquidFuel", "Oxidizer"],
            "r.resource[LiquidFuel]": 100.0,
            "r.resourceMax[LiquidFuel]": 200.0,
            "r.resource[Oxidizer]": 110.0,
            "r.resourceMax[Oxidizer]": 220.0,
        }
        partial = {
            "res.status": "incomplete",
            "res.names": ["LiquidFuel", "Oxidizer"],
            "r.resource[LiquidFuel]": 90.0,
            "r.resourceMax[LiquidFuel]": 200.0,
            "res.stageKnown": False,
        }
        game_scene = SimpleNamespace(flight="flight")
        conn = SimpleNamespace(
            krpc=SimpleNamespace(
                game_scene="flight",
                GameScene=game_scene,
            ),
            space_center=SimpleNamespace(
                active_vessel=SimpleNamespace(),
                ut=100.0,
            ),
        )

        with mock.patch.multiple(
            telemetry_server,
            _telemetry_mode="flight",
            _stage_cache={},
            _stage_current_authority={},
            _stage_last_poll=100.0,
            _stage_last_ut=100.0,
            _res_cache=old_cache,
            _res_last_poll=0.0,
            _tgt_cache={},
            _tgt_last_poll=100.0,
            _sci_cache={},
            _sci_last_poll=100.0,
            _heat_cache={},
            _heat_last_poll=100.0,
            _elec_cache={},
            _elec_last_poll=100.0,
        ), mock.patch.object(
            telemetry_server.time, "time", return_value=100.0
        ), mock.patch.object(
            telemetry_server, "_current_stage", return_value=None
        ), mock.patch.object(
            telemetry_server, "_gather_sas", return_value={}
        ), mock.patch.object(
            telemetry_server, "_gather_resources", return_value=partial
        ), mock.patch.object(
            telemetry_server, "_attach_notes_telemetry", side_effect=lambda payload, *_args: payload
        ), mock.patch.object(
            telemetry_server, "_finalize_telemetry", side_effect=lambda _conn, payload: payload
        ):
            result = telemetry_server.gather_telemetry(conn)

        self.assertEqual(result["res.status"], "incomplete")
        self.assertEqual(result["r.resource[LiquidFuel]"], 90.0)
        self.assertNotIn("r.resource[Oxidizer]", result)
        self.assertNotIn("r.resourceMax[Oxidizer]", result)


if __name__ == "__main__":
    unittest.main()
