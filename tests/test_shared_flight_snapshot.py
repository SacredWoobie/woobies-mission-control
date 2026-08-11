import base64
import unittest
from types import SimpleNamespace
from unittest import mock

import staging
import telemetry_server


def _encoded(value):
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


def _flight_core_snapshot():
    return "\t".join([
        "WCS_FLIGHT_CORE_SNAPSHOT", "1", "1", "known",
        _encoded("01234567-89ab-cdef-0123-456789abcdef"),
        _encoded("Packed Core"), _encoded("Kerbin"), _encoded("Flying"),
        "100", "12", "0.25", "100", "200", "90", "5", "0",
        "1234.5", "100", "250", "1.2", "2200", "80000", "75000",
        "120", "360", "0.01", "0.02", "1800", "50662.5", "3",
        "1", "1", "1", _encoded("Prograde"),
    ])


class _Bomb:
    def __getattr__(self, name):
        raise AssertionError(f"unexpected repeated read: {name}")


class SharedFlightSnapshotTests(unittest.TestCase):
    def test_staging_reuses_known_scalars_and_cycle_proxies(self):
        class Vessel:
            situation = "VesselSituation.flying"

            @property
            def orbit(self):
                raise AssertionError("orbit proxy was reacquired")

            @property
            def control(self):
                raise AssertionError("control proxy was reacquired")

            def flight(self, _frame):
                raise AssertionError("flight proxy was reacquired")

        class Flight:
            static_pressure = 50_662.5

            @property
            def mean_altitude(self):
                raise AssertionError("known altitude was reread")

        result = staging.flight_conditions(
            SimpleNamespace(),
            vessel=Vessel(),
            body=_Bomb(),
            flight=Flight(),
            control=_Bomb(),
            known={
                "stage.body": "Kerbin",
                "stage.altitude": 1234.6,
                "stage.throttle": 0.42,
            },
        )

        self.assertEqual(result, {
            "stage.body": "Kerbin",
            "stage.altitude": 1234.6,
            "stage.throttle": 0.42,
            "stage.staticPressureAtm": 0.5,
            "stage.situation": "Flying",
        })

    def test_staging_retains_independent_lookup_fallback(self):
        body = SimpleNamespace(name="Kerbin", reference_frame="body")
        flight = SimpleNamespace(mean_altitude=999.94, static_pressure=101_325.0)
        control = SimpleNamespace(throttle=0.33333)
        vessel = SimpleNamespace(
            orbit=SimpleNamespace(body=body),
            flight=lambda _frame: flight,
            situation="VesselSituation.sub_orbital",
            control=control,
        )
        conn = SimpleNamespace(space_center=SimpleNamespace(active_vessel=vessel))

        self.assertEqual(staging.flight_conditions(conn), {
            "stage.body": "Kerbin",
            "stage.altitude": 999.9,
            "stage.staticPressureAtm": 1.0,
            "stage.situation": "Sub Orbital",
            "stage.throttle": 0.3333,
        })

    def test_stale_shared_proxies_retry_through_original_lookup(self):
        fresh_control = SimpleNamespace(
            throttle=0.6,
            current_stage=2,
            sas=True,
            sas_mode="SASMode.radial",
        )
        fresh_body = SimpleNamespace(name="Kerbin", reference_frame="fresh-body")
        fresh_flight = SimpleNamespace(
            mean_altitude=2500.0,
            static_pressure=25_331.25,
        )
        vessel = SimpleNamespace(
            control=fresh_control,
            orbit=SimpleNamespace(body=fresh_body),
            flight=lambda _frame: fresh_flight,
            situation="VesselSituation.flying",
            thrust=10.0,
            available_thrust=20.0,
        )

        stage = staging.flight_conditions(
            SimpleNamespace(),
            vessel=vessel,
            body=_Bomb(),
            flight=_Bomb(),
            control=_Bomb(),
            known={"stage.body": "Kerbin", "stage.altitude": 2500.0},
        )
        self.assertEqual(stage["stage.staticPressureAtm"], 0.25)
        self.assertEqual(stage["stage.throttle"], 0.6)

        with mock.patch.object(telemetry_server, "_HAS_CURRENT_STAGE", True):
            self.assertEqual(
                telemetry_server._current_stage(
                    vessel, control=_Bomb()
                ),
                2,
            )
        self.assertEqual(
            telemetry_server._gather_throttle_state(vessel, control=_Bomb()),
            {
                "krpc.throttle": 0.6,
                "v.thrust": 10.0,
                "v.availableThrust": 20.0,
            },
        )
        sas = telemetry_server._gather_sas(
            SimpleNamespace(), vessel, control=_Bomb()
        )
        self.assertTrue(sas["krpc.sas"])
        self.assertEqual(sas["krpc.sasMode"], "SASMode.radial")

    def test_core_cycle_acquires_control_and_orbit_once(self):
        counts = {"control": 0, "orbit": 0, "flight": 0}
        control = SimpleNamespace(
            throttle=0.25,
            current_stage=3,
            sas=True,
            sas_mode="SASMode.prograde",
        )
        body = SimpleNamespace(name="Kerbin", reference_frame="body")
        orbit = SimpleNamespace(
            body=body,
            speed=2200.0,
            apoapsis_altitude=80_000.0,
            periapsis_altitude=75_000.0,
            time_to_apoapsis=120.0,
            time_to_periapsis=360.0,
            inclination=0.01,
            eccentricity=0.02,
            period=1800.0,
        )
        surface_flight = SimpleNamespace(heading=90.0, pitch=5.0, roll=0.0)
        body_flight = SimpleNamespace(
            mean_altitude=1234.56,
            vertical_speed=100.0,
            speed=250.0,
            g_force=1.2,
            static_pressure=50_662.5,
        )

        class Vessel:
            name = "Shared Snapshot"
            met = 12.0
            thrust = 100.0
            available_thrust = 200.0
            surface_reference_frame = "surface"
            situation = "VesselSituation.flying"
            comms = SimpleNamespace(can_communicate=True, signal_strength=1.0)
            _object_id = 42

            @property
            def control(self):
                counts["control"] += 1
                return control

            @property
            def orbit(self):
                counts["orbit"] += 1
                return orbit

            def flight(self, reference_frame):
                counts["flight"] += 1
                return (
                    surface_flight
                    if reference_frame == "surface"
                    else body_flight
                )

        vessel = Vessel()
        scene = SimpleNamespace(flight="flight")
        conn = SimpleNamespace(
            krpc=SimpleNamespace(game_scene="flight", GameScene=scene),
            space_center=SimpleNamespace(active_vessel=vessel, ut=100.0),
        )
        stage_result = {"stage.currentKsp": 3}

        with mock.patch.multiple(
            telemetry_server,
            _telemetry_mode="flight",
            _stage_cache={},
            _stage_current_authority={},
            _stage_last_poll=0.0,
            _stage_last_ut=100.0,
            _damage_cache={"damage.status": "known"},
            _damage_last_poll=100.0,
            _damage_cache_key="Shared Snapshot",
            _damage_last_ut=100.0,
            _res_cache={"res.status": "known"},
            _res_last_poll=100.0,
            _res_cache_key=("Shared Snapshot", 3),
            _tgt_cache={},
            _tgt_last_poll=100.0,
            _sci_cache={},
            _sci_last_poll=100.0,
            _heat_cache={},
            _heat_last_poll=0.0,
            _elec_cache={},
            _elec_last_poll=0.0,
            _HAS_CURRENT_STAGE=True,
        ), mock.patch.object(
            telemetry_server.time, "time", return_value=100.0
        ), mock.patch.object(
            telemetry_server, "_gather_stages", return_value=stage_result
        ) as gather_stages, mock.patch.object(
            telemetry_server,
            "_gather_heat_electricity_preferred",
            return_value={
                "heat": {"heat.backend": "system_heat"},
                "electricity": {"elec.reactorsStatus": "known"},
            },
        ) as gather_heat_electricity, mock.patch.object(
            telemetry_server,
            "_attach_notes_telemetry",
            side_effect=lambda payload, *_args: payload,
        ), mock.patch.object(
            telemetry_server,
            "_finalize_telemetry",
            side_effect=lambda _conn, payload: payload,
        ):
            result = telemetry_server.gather_telemetry(conn)

        self.assertEqual(counts, {"control": 1, "orbit": 1, "flight": 2})
        self.assertEqual(result["krpc.currentStage"], 3)
        self.assertEqual(result["krpc.sasMode"], "SASMode.prograde")
        gather_heat_electricity.assert_called_once_with(conn, None)
        context = gather_stages.call_args.kwargs["flight_context"]
        self.assertIs(context["control"], control)
        self.assertIs(context["body"], body)
        self.assertIs(context["flight"], body_flight)
        self.assertEqual(context["known"], {
            "stage.body": "Kerbin",
            "stage.altitude": 1234.6,
            "stage.throttle": 0.25,
        })

    def test_packed_core_cycle_avoids_all_stock_hot_scalar_reads(self):
        class Vessel:
            _object_id = 42

            def __getattr__(self, name):
                raise AssertionError(f"unexpected stock Flight read: {name}")

        vessel = Vessel()
        scene = SimpleNamespace(flight="flight")
        conn = SimpleNamespace(
            krpc=SimpleNamespace(game_scene="flight", GameScene=scene),
            space_center=SimpleNamespace(active_vessel=vessel),
            vessel_flight_core=SimpleNamespace(
                packed_snapshot=mock.Mock(return_value=_flight_core_snapshot())
            ),
        )
        stage_result = {"stage.currentKsp": 3}

        with mock.patch.multiple(
            telemetry_server,
            _telemetry_mode="flight",
            _stage_cache={},
            _stage_current_authority={},
            _stage_last_poll=0.0,
            _stage_last_ut=100.0,
            _damage_cache={"damage.status": "known"},
            _damage_last_poll=100.0,
            _damage_cache_key="Packed Core",
            _damage_last_ut=100.0,
            _res_cache={"res.status": "known"},
            _res_last_poll=100.0,
            _res_cache_key=("Packed Core", 3),
            _tgt_cache={},
            _tgt_last_poll=100.0,
            _sci_cache={},
            _sci_last_poll=100.0,
            _heat_cache={},
            _heat_last_poll=0.0,
            _elec_cache={},
            _elec_last_poll=0.0,
        ), mock.patch.object(
            telemetry_server.time, "time", return_value=100.0
        ), mock.patch.object(
            telemetry_server, "_gather_stages", return_value=stage_result
        ) as gather_stages, mock.patch.object(
            telemetry_server,
            "_gather_heat_electricity_preferred",
            return_value={
                "heat": {"heat.backend": "system_heat"},
                "electricity": {"elec.reactorsStatus": "known"},
            },
        ), mock.patch.object(
            telemetry_server,
            "_attach_notes_telemetry",
            side_effect=lambda payload, *_args: payload,
        ), mock.patch.object(
            telemetry_server,
            "_finalize_telemetry",
            side_effect=lambda _conn, payload: payload,
        ):
            result = telemetry_server.gather_telemetry(conn)

        self.assertEqual(result["v.name"], "Packed Core")
        self.assertEqual(result["krpc.currentStage"], 3)
        self.assertEqual(result["krpc.sasMode"], "SASMode.prograde")
        self.assertEqual(result["stage.staticPressureAtm"], 0.5)
        context = gather_stages.call_args.kwargs["flight_context"]
        self.assertIsNone(context["control"])
        self.assertIsNone(context["body"])
        self.assertIsNone(context["flight"])
        self.assertEqual(context["known"], {
            "stage.body": "Kerbin",
            "stage.altitude": 1234.5,
            "stage.throttle": 0.25,
            "stage.staticPressureAtm": 0.5,
            "stage.situation": "Flying",
        })


if __name__ == "__main__":
    unittest.main()
