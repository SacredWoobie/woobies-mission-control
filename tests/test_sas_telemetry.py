import unittest
from types import SimpleNamespace
from unittest import mock

import telemetry_server


class SasTelemetryTests(unittest.TestCase):
    def setUp(self):
        telemetry_server._clear_smart_ass_api_ready_cache()

    def tearDown(self):
        telemetry_server._clear_smart_ass_api_ready_cache()

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

    def test_negative_readiness_is_polled_at_one_hz(self):
        class MechJeb:
            reads = 0

            @property
            def api_ready(self):
                self.reads += 1
                return False

        vessel = SimpleNamespace(
            _object_id=1,
            control=SimpleNamespace(sas=False, sas_mode="SASMode.stability_assist"),
        )
        mech_jeb = MechJeb()
        conn = SimpleNamespace(mech_jeb=mech_jeb)

        first = telemetry_server._gather_sas(conn, vessel, now=100.0)
        cached = telemetry_server._gather_sas(conn, vessel, now=100.25)
        refreshed = telemetry_server._gather_sas(conn, vessel, now=101.0)

        self.assertEqual(mech_jeb.reads, 2)
        self.assertNotIn("mj.sasMode", first)
        self.assertNotIn("mj.sasMode", cached)
        self.assertNotIn("mj.sasMode", refreshed)

    def test_positive_readiness_and_mode_remain_live_every_cycle(self):
        class SmartAss:
            reads = 0
            mode = "SmartASSAutopilotMode.orbit_prograde"

            @property
            def autopilot_mode(self):
                self.reads += 1
                return self.mode

        class MechJeb:
            reads = 0
            smart_ass = SmartAss()

            @property
            def api_ready(self):
                self.reads += 1
                return True

        vessel = SimpleNamespace(
            _object_id=1,
            control=SimpleNamespace(sas=False, sas_mode="SASMode.stability_assist"),
        )
        mech_jeb = MechJeb()
        conn = SimpleNamespace(mech_jeb=mech_jeb)

        active = telemetry_server._gather_sas(conn, vessel, now=100.0)
        mech_jeb.smart_ass.mode = "SmartASSAutopilotMode.off"
        inactive = telemetry_server._gather_sas(conn, vessel, now=100.25)

        self.assertEqual(mech_jeb.reads, 2)
        self.assertEqual(mech_jeb.smart_ass.reads, 2)
        self.assertTrue(active["mj.sasActive"])
        self.assertFalse(inactive["mj.sasActive"])
        self.assertEqual(inactive["mj.sasMode"], "SmartASSAutopilotMode.off")

    def test_negative_cache_is_bound_to_connection_and_vessel(self):
        class MechJeb:
            def __init__(self):
                self.reads = 0

            @property
            def api_ready(self):
                self.reads += 1
                return False

        vessel_a = SimpleNamespace(_object_id=1, control=SimpleNamespace(sas=False))
        vessel_b = SimpleNamespace(_object_id=2, control=SimpleNamespace(sas=False))
        service_a = MechJeb()
        service_b = MechJeb()
        conn_a = SimpleNamespace(mech_jeb=service_a)
        conn_b = SimpleNamespace(mech_jeb=service_b)

        telemetry_server._gather_sas(conn_a, vessel_a, now=100.0)
        telemetry_server._gather_sas(conn_a, vessel_b, now=100.25)
        telemetry_server._gather_sas(conn_b, vessel_b, now=100.5)

        self.assertEqual(service_a.reads, 2)
        self.assertEqual(service_b.reads, 1)

    def test_readiness_errors_retry_immediately(self):
        class MechJeb:
            reads = 0

            @property
            def api_ready(self):
                self.reads += 1
                if self.reads == 1:
                    raise RuntimeError("transient readiness failure")
                return False

        vessel = SimpleNamespace(_object_id=1, control=SimpleNamespace(sas=False))
        mech_jeb = MechJeb()
        conn = SimpleNamespace(mech_jeb=mech_jeb)

        telemetry_server._gather_sas(conn, vessel, now=100.0)
        telemetry_server._gather_sas(conn, vessel, now=100.25)

        self.assertEqual(mech_jeb.reads, 2)

    def test_explicit_lifecycle_reset_bypasses_negative_ttl(self):
        class MechJeb:
            reads = 0

            @property
            def api_ready(self):
                self.reads += 1
                return False

        vessel = SimpleNamespace(_object_id=1, control=SimpleNamespace(sas=False))
        mech_jeb = MechJeb()
        conn = SimpleNamespace(mech_jeb=mech_jeb)

        telemetry_server._gather_sas(conn, vessel, now=100.0)
        telemetry_server._clear_smart_ass_api_ready_cache()
        telemetry_server._gather_sas(conn, vessel, now=100.25)

        self.assertEqual(mech_jeb.reads, 2)

    def test_scene_transition_clears_negative_readiness_cache(self):
        class MechJeb:
            reads = 0

            @property
            def api_ready(self):
                self.reads += 1
                return False

        vessel = SimpleNamespace(_object_id=1, control=SimpleNamespace(sas=False))
        mech_jeb = MechJeb()
        scene = SimpleNamespace(
            editor_vab="editor_vab",
            editor_sph="editor_sph",
            flight="flight",
        )
        conn = SimpleNamespace(
            mech_jeb=mech_jeb,
            krpc=SimpleNamespace(game_scene="space_center", GameScene=scene),
        )

        telemetry_server._gather_sas(conn, vessel, now=100.0)
        with mock.patch.multiple(
            telemetry_server,
            _telemetry_mode="flight",
        ), mock.patch.object(
            telemetry_server,
            "_gather_overview_telemetry",
            return_value={"context.mode": "inactive"},
        ), mock.patch.object(
            telemetry_server,
            "_attach_notes_telemetry",
            side_effect=lambda payload, *_args: payload,
        ), mock.patch.object(
            telemetry_server,
            "_finalize_telemetry",
            side_effect=lambda _conn, payload: payload,
        ):
            telemetry_server.gather_telemetry(conn)

        telemetry_server._gather_sas(conn, vessel, now=100.25)
        self.assertEqual(mech_jeb.reads, 2)

    def test_ut_rewind_invokes_smart_ass_cache_reset(self):
        vessel = SimpleNamespace(_object_id=1)
        scene = SimpleNamespace(
            editor_vab="editor_vab",
            editor_sph="editor_sph",
            flight="flight",
        )
        conn = SimpleNamespace(
            krpc=SimpleNamespace(game_scene="flight", GameScene=scene),
            space_center=SimpleNamespace(active_vessel=vessel),
        )
        flight_core = {
            "v.name": "Reverted craft",
            "t.universalTime": 50.0,
            "krpc.currentStage": 3,
        }

        with mock.patch.multiple(
            telemetry_server,
            _telemetry_mode="flight",
            _stage_cache={},
            _stage_current_authority={},
            _stage_last_poll=100.0,
            _stage_last_ut=100.0,
            _damage_cache={"damage.status": "known"},
            _damage_last_poll=100.0,
            _damage_cache_key="Reverted craft",
            _damage_last_ut=50.0,
            _res_cache={"res.status": "known"},
            _res_last_poll=100.0,
            _res_cache_key=("Reverted craft", 3),
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
            telemetry_server,
            "_gather_flight_core_preferred",
            return_value=flight_core,
        ), mock.patch.object(
            telemetry_server,
            "_gather_stages",
            return_value={"stage.currentKsp": 3},
        ), mock.patch.object(
            telemetry_server, "_gather_remote_tech", return_value={}
        ), mock.patch.object(
            telemetry_server, "_gather_sas", return_value={}
        ), mock.patch.object(
            telemetry_server,
            "_gather_resources_preferred",
            return_value={"res.status": "known"},
        ), mock.patch.object(
            telemetry_server,
            "_attach_notes_telemetry",
            side_effect=lambda payload, *_args: payload,
        ), mock.patch.object(
            telemetry_server,
            "_finalize_telemetry",
            side_effect=lambda _conn, payload: payload,
        ), mock.patch.object(
            telemetry_server,
            "_clear_smart_ass_api_ready_cache",
            wraps=telemetry_server._clear_smart_ass_api_ready_cache,
        ) as clear_cache:
            telemetry_server.gather_telemetry(conn)

        clear_cache.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
