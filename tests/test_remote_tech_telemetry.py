import unittest
from types import SimpleNamespace
from unittest import mock

import telemetry_server


class _CountingComms:
    def __init__(self, connected, delay=0.0):
        self.connected = connected
        self.delay = delay
        self.connection_reads = 0
        self.delay_reads = 0

    @property
    def has_connection(self):
        self.connection_reads += 1
        return self.connected

    @property
    def signal_delay(self):
        self.delay_reads += 1
        return self.delay


class _CountingRemoteTech:
    def __init__(self, available, comms=None):
        self.value = available
        self.comms_proxy = comms
        self.available_reads = 0
        self.comms_calls = 0

    @property
    def available(self):
        self.available_reads += 1
        return self.value

    def comms(self, _vessel):
        self.comms_calls += 1
        return self.comms_proxy


class RemoteTechTelemetryTests(unittest.TestCase):
    def setUp(self):
        telemetry_server._clear_remote_tech_binding_cache()

    def tearDown(self):
        telemetry_server._clear_remote_tech_binding_cache()

    def test_connected_link_reads_each_live_property_once(self):
        comms = _CountingComms(True, 1.25)
        remote_tech = _CountingRemoteTech(True, comms)

        result = telemetry_server._gather_remote_tech(
            SimpleNamespace(remote_tech=remote_tech),
            SimpleNamespace(),
        )

        self.assertEqual(result, {
            "rt.available": True,
            "rt.hasConnection": True,
            "rt.signalDelay": 1.25,
        })
        self.assertEqual(remote_tech.available_reads, 1)
        self.assertEqual(remote_tech.comms_calls, 1)
        self.assertEqual(comms.connection_reads, 1)
        self.assertEqual(comms.delay_reads, 1)

    def test_unavailable_service_does_not_request_comms(self):
        remote_tech = _CountingRemoteTech(False)

        result = telemetry_server._gather_remote_tech(
            SimpleNamespace(remote_tech=remote_tech),
            SimpleNamespace(),
        )

        self.assertEqual(result, {"rt.available": False})
        self.assertEqual(remote_tech.available_reads, 1)
        self.assertEqual(remote_tech.comms_calls, 0)

    def test_disconnected_link_omits_signal_delay_read(self):
        comms = _CountingComms(False, 99.0)
        remote_tech = _CountingRemoteTech(True, comms)

        result = telemetry_server._gather_remote_tech(
            SimpleNamespace(remote_tech=remote_tech),
            SimpleNamespace(),
        )

        self.assertEqual(result, {
            "rt.available": True,
            "rt.hasConnection": False,
            "rt.signalDelay": None,
        })
        self.assertEqual(comms.connection_reads, 1)
        self.assertEqual(comms.delay_reads, 0)

    def test_missing_remote_tech_remains_nonfatal(self):
        self.assertEqual(
            telemetry_server._gather_remote_tech(
                SimpleNamespace(),
                SimpleNamespace(),
            ),
            {},
        )

    def test_positive_binding_is_reused_but_live_link_state_is_not_cached(self):
        comms = _CountingComms(True, 1.25)
        remote_tech = _CountingRemoteTech(True, comms)
        conn = SimpleNamespace(remote_tech=remote_tech)
        vessel = SimpleNamespace(_object_id=17)

        first = telemetry_server._gather_remote_tech(conn, vessel, now=100.0)
        comms.connected = False
        comms.delay = 99.0
        second = telemetry_server._gather_remote_tech(conn, vessel, now=100.25)

        self.assertEqual(first, {
            "rt.available": True,
            "rt.hasConnection": True,
            "rt.signalDelay": 1.25,
        })
        self.assertEqual(second, {
            "rt.available": True,
            "rt.hasConnection": False,
            "rt.signalDelay": None,
        })
        self.assertEqual(remote_tech.available_reads, 1)
        self.assertEqual(remote_tech.comms_calls, 1)
        self.assertEqual(comms.connection_reads, 2)
        self.assertEqual(comms.delay_reads, 1)

    def test_binding_refreshes_at_ttl_boundary(self):
        comms = _CountingComms(True, 0.5)
        remote_tech = _CountingRemoteTech(True, comms)
        conn = SimpleNamespace(remote_tech=remote_tech)
        vessel = SimpleNamespace(_object_id=17)

        telemetry_server._gather_remote_tech(conn, vessel, now=100.0)
        telemetry_server._gather_remote_tech(conn, vessel, now=104.999)
        telemetry_server._gather_remote_tech(conn, vessel, now=105.0)

        self.assertEqual(remote_tech.available_reads, 2)
        self.assertEqual(remote_tech.comms_calls, 2)
        self.assertEqual(comms.connection_reads, 3)
        self.assertEqual(comms.delay_reads, 3)

    def test_binding_is_bound_to_connection_and_vessel(self):
        comms_a = _CountingComms(True, 0.1)
        comms_b = _CountingComms(True, 0.2)
        remote_a = _CountingRemoteTech(True, comms_a)
        remote_b = _CountingRemoteTech(True, comms_b)
        conn_a = SimpleNamespace(remote_tech=remote_a)
        conn_b = SimpleNamespace(remote_tech=remote_b)
        vessel_a = SimpleNamespace(_object_id=17)
        vessel_b = SimpleNamespace(_object_id=18)

        telemetry_server._gather_remote_tech(conn_a, vessel_a, now=100.0)
        telemetry_server._gather_remote_tech(conn_a, vessel_b, now=100.25)
        telemetry_server._gather_remote_tech(conn_b, vessel_b, now=100.5)

        self.assertEqual(remote_a.available_reads, 2)
        self.assertEqual(remote_a.comms_calls, 2)
        self.assertEqual(remote_b.available_reads, 1)
        self.assertEqual(remote_b.comms_calls, 1)

    def test_unavailable_service_is_retried_immediately(self):
        remote_tech = _CountingRemoteTech(False)
        conn = SimpleNamespace(remote_tech=remote_tech)
        vessel = SimpleNamespace(_object_id=17)

        telemetry_server._gather_remote_tech(conn, vessel, now=100.0)
        telemetry_server._gather_remote_tech(conn, vessel, now=100.25)

        self.assertEqual(remote_tech.available_reads, 2)
        self.assertEqual(remote_tech.comms_calls, 0)

    def test_live_property_error_clears_binding_and_retries_full_resolution(self):
        class FlakyComms(_CountingComms):
            fail_next = True

            @property
            def has_connection(self):
                self.connection_reads += 1
                if self.fail_next:
                    self.fail_next = False
                    raise RuntimeError("transient link read failure")
                return self.connected

        comms = FlakyComms(True, 0.75)
        remote_tech = _CountingRemoteTech(True, comms)
        conn = SimpleNamespace(remote_tech=remote_tech)
        vessel = SimpleNamespace(_object_id=17)

        first = telemetry_server._gather_remote_tech(conn, vessel, now=100.0)
        second = telemetry_server._gather_remote_tech(conn, vessel, now=100.25)

        self.assertEqual(first, {"rt.available": True})
        self.assertEqual(second, {
            "rt.available": True,
            "rt.hasConnection": True,
            "rt.signalDelay": 0.75,
        })
        self.assertEqual(remote_tech.available_reads, 2)
        self.assertEqual(remote_tech.comms_calls, 2)
        self.assertEqual(comms.connection_reads, 2)
        self.assertEqual(comms.delay_reads, 1)

    def test_wall_clock_rewind_forces_binding_refresh(self):
        comms = _CountingComms(True, 0.5)
        remote_tech = _CountingRemoteTech(True, comms)
        conn = SimpleNamespace(remote_tech=remote_tech)
        vessel = SimpleNamespace(_object_id=17)

        telemetry_server._gather_remote_tech(conn, vessel, now=100.0)
        telemetry_server._gather_remote_tech(conn, vessel, now=99.0)

        self.assertEqual(remote_tech.available_reads, 2)
        self.assertEqual(remote_tech.comms_calls, 2)

    def test_scene_transition_invokes_binding_cache_reset(self):
        scene = SimpleNamespace(
            editor_vab="editor_vab",
            editor_sph="editor_sph",
            flight="flight",
        )
        conn = SimpleNamespace(
            krpc=SimpleNamespace(game_scene="space_center", GameScene=scene),
        )

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
        ), mock.patch.object(
            telemetry_server,
            "_clear_remote_tech_binding_cache",
            wraps=telemetry_server._clear_remote_tech_binding_cache,
        ) as clear_cache:
            telemetry_server.gather_telemetry(conn)

        clear_cache.assert_called_once_with()

    def test_ut_rewind_invokes_binding_cache_reset(self):
        vessel = SimpleNamespace(_object_id=17)
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
            "_clear_remote_tech_binding_cache",
            wraps=telemetry_server._clear_remote_tech_binding_cache,
        ) as clear_cache:
            telemetry_server.gather_telemetry(conn)

        clear_cache.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
