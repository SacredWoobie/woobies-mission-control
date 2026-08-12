import base64
import math
import unittest
from types import SimpleNamespace
from unittest import mock

import telemetry_server
from flight_core_snapshot import (
    FIELD_COUNT,
    FlightCoreSnapshotError,
    decode_flight_core_snapshot,
)


VESSEL_ID = "01234567-89ab-cdef-0123-456789abcdef"


def encoded(value):
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


def snapshot(**replacements):
    values = [
        "WCS_FLIGHT_CORE_SNAPSHOT", "1", "1", "known",
        encoded(VESSEL_ID), encoded("Test Craft"), encoded("Kerbin"),
        encoded("PreLaunch"),
        "1000.5", "12.25", "0.5", "100", "120", "90", "45", "-2",
        "1234.5", "20", "250", "1.5", "2300", "80000", "75000",
        "120", "360", "0.1", "0.02", "1800", "50662.5", "5",
        "1", "0.75", "1", encoded("StabilityAssist"),
    ]
    indexes = {
        "magic": 0, "schema": 1, "active": 2, "status": 3,
        "vessel_id": 4, "vessel_name": 5, "body_name": 6,
        "situation": 7, "universal_time": 8, "mission_time": 9,
        "throttle": 10, "thrust": 11, "available_thrust": 12,
        "heading": 13, "pitch": 14, "roll": 15, "altitude": 16,
        "vertical_speed": 17, "surface_speed": 18, "g_force": 19,
        "orbital_speed": 20, "apoapsis": 21, "periapsis": 22,
        "time_to_apoapsis": 23, "time_to_periapsis": 24,
        "inclination": 25, "eccentricity": 26, "period": 27,
        "static_pressure": 28, "current_stage": 29,
        "can_communicate": 30, "signal_strength": 31, "sas": 32,
        "sas_mode": 33,
    }
    for key, value in replacements.items():
        values[indexes[key]] = value
    assert len(values) == FIELD_COUNT
    return "\t".join(values)


class FlightCoreSnapshotDecoderTests(unittest.TestCase):
    def test_decodes_complete_snapshot_to_existing_fields(self):
        result = decode_flight_core_snapshot(
            snapshot(), expected_vessel_id=VESSEL_ID.upper()
        )
        self.assertEqual(result["v.guid"], VESSEL_ID)
        self.assertEqual(result["v.name"], "Test Craft")
        self.assertEqual(result["v.body"], "Kerbin")
        self.assertEqual(result["v.situationString"], "Pre Launch")
        self.assertEqual(result["stage.staticPressureAtm"], 0.5)
        self.assertEqual(result["krpc.currentStage"], 5)
        self.assertAlmostEqual(result["o.inclination"], math.degrees(0.1))
        self.assertEqual(result["krpc.sasMode"], "SASMode.stability_assist")
        self.assertTrue(result["comm.krpc.canCommunicate"])

    def test_optional_comms_and_sas_are_omitted(self):
        result = decode_flight_core_snapshot(snapshot(
            can_communicate="-", signal_strength="-", sas="-", sas_mode="-"
        ))
        self.assertNotIn("comm.krpc.canCommunicate", result)
        self.assertNotIn("comm.krpc.signalStrength", result)
        self.assertNotIn("krpc.sas", result)
        self.assertNotIn("krpc.sasMode", result)

    def test_rejects_status_identity_width_and_unsafe_values(self):
        invalid = [
            snapshot(status="incomplete"),
            snapshot(active="0"),
            snapshot(schema="2"),
            snapshot(vessel_id=encoded("not-a-guid")),
            snapshot(vessel_id=encoded(VESSEL_ID.upper())),
            snapshot(throttle="1.1"),
            snapshot(thrust="nan"),
            snapshot(signal_strength="2"),
            snapshot(current_stage="-2"),
            snapshot(sas="1", sas_mode="-"),
            snapshot() + "\textra",
            snapshot() + "\n",
        ]
        for packed in invalid:
            with self.subTest(packed=packed[:60]):
                with self.assertRaises(FlightCoreSnapshotError):
                    decode_flight_core_snapshot(packed)

    def test_rejects_expected_vessel_mismatch(self):
        with self.assertRaises(FlightCoreSnapshotError):
            decode_flight_core_snapshot(
                snapshot(),
                expected_vessel_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            )


class PreferredFlightCoreCollectorTests(unittest.TestCase):
    def test_one_call_with_missing_stock_guid_uses_context_guard(self):
        vessel = SimpleNamespace()
        service = SimpleNamespace(
            packed_snapshot=mock.Mock(return_value=snapshot())
        )
        conn = SimpleNamespace(
            vessel_flight_core=service,
            space_center=SimpleNamespace(active_vessel=vessel),
        )
        result = telemetry_server._gather_flight_core_preferred(
            conn, vessel, expected_vessel_id=None
        )
        service.packed_snapshot.assert_called_once_with()
        self.assertEqual(result["v.guid"], VESSEL_ID)

    def test_transition_or_invalid_service_returns_none_for_stock_fallback(self):
        vessel = SimpleNamespace(marker="original")
        for conn in (
            SimpleNamespace(),
            SimpleNamespace(
                vessel_flight_core=SimpleNamespace(
                    packed_snapshot=mock.Mock(return_value=snapshot(status="stale"))
                )
            ),
            SimpleNamespace(
                vessel_flight_core=SimpleNamespace(
                    packed_snapshot=mock.Mock(return_value=snapshot())
                ),
                space_center=SimpleNamespace(
                    active_vessel=SimpleNamespace(marker="replacement")
                ),
            ),
        ):
            with self.subTest(conn=conn):
                self.assertIsNone(
                    telemetry_server._gather_flight_core_preferred(
                        conn, vessel, expected_vessel_id=None
                    )
                )


if __name__ == "__main__":
    unittest.main()
