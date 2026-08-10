import base64
import unittest
from types import SimpleNamespace
from unittest import mock

import telemetry_server
from resource_snapshot import (
    MAX_PACKED_CHARACTERS,
    ResourceSnapshotError,
    decode_resource_snapshot,
)


def encoded(value):
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


def snapshot(
        *, vessel="vessel-a", current_stage=5, resource_stage=4,
        activation_stage=5, totals=None, stage=None, status="known"):
    totals = list(
        [("LiquidFuel", 100.0, 200.0)] if totals is None else totals
    )
    stage = list(
        [("LiquidFuel", 40.0, 80.0)] if stage is None else stage
    )
    header = [
        "WCS_RESOURCE_SNAPSHOT",
        "1",
        "1",
        status,
        encoded(vessel),
        str(current_stage),
        "-" if resource_stage is None else str(resource_stage),
        "-" if activation_stage is None else str(activation_stage),
        str(len(totals)),
        str(len(stage)),
    ]
    rows = [
        "\t".join(("R", encoded(name), str(amount), str(maximum)))
        for name, amount, maximum in totals
    ] + [
        "\t".join(("S", encoded(name), str(amount), str(maximum)))
        for name, amount, maximum in stage
    ]
    return "\n".join(["\t".join(header), *rows])


class ResourceSnapshotDecoderTests(unittest.TestCase):
    def test_decodes_exact_existing_flattened_schema(self):
        result = decode_resource_snapshot(
            snapshot(
                totals=[
                    ("LiquidFuel", 100.0, 200.0),
                    ("ElectricCharge", 250.0, 300.0),
                ],
                stage=[("LiquidFuel", 40.0, 80.0)],
            ),
            expected_vessel_id="VESSEL-A",
            expected_stage=5,
        )

        self.assertEqual(result, {
            "res.status": "known",
            "res.names": ["LiquidFuel", "ElectricCharge"],
            "res.stageKnown": True,
            "res.stageResourceStage": 4,
            "res.stageActivationStage": 5,
            "r.resource[LiquidFuel]": 100.0,
            "r.resourceMax[LiquidFuel]": 200.0,
            "r.resource[ElectricCharge]": 250.0,
            "r.resourceMax[ElectricCharge]": 300.0,
            "r.resourceCurrent[LiquidFuel]": 40.0,
            "r.resourceCurrentMax[LiquidFuel]": 80.0,
        })

    def test_rejects_stale_or_wrong_context(self):
        for kwargs in (
            {"expected_vessel_id": "vessel-b"},
            {"expected_stage": 4},
        ):
            with self.subTest(kwargs=kwargs):
                with self.assertRaises(ResourceSnapshotError):
                    decode_resource_snapshot(snapshot(), **kwargs)
        with self.assertRaises(ResourceSnapshotError):
            decode_resource_snapshot(snapshot(status="stale"))
        with self.assertRaises(ResourceSnapshotError):
            decode_resource_snapshot(snapshot(
                resource_stage=None,
                activation_stage=5,
                stage=[],
            ))

    def test_rejects_malformed_unbounded_or_unsafe_values(self):
        valid = snapshot()
        malformed = [
            "",
            "x" * (MAX_PACKED_CHARACTERS + 1),
            valid.replace("WCS_RESOURCE_SNAPSHOT", "WRONG", 1),
            valid.replace("\t1\t1\tknown\t", "\t2\t1\tknown\t", 1),
            valid.replace(encoded("LiquidFuel"), "%%%", 1),
            valid.replace("100.0", "nan", 1),
            valid.replace("200.0", "-1", 1),
            valid + "\nS\t" + encoded("Extra") + "\t1\t1",
            valid.replace("\nS\t", "\nR\t", 1),
        ]
        for packed in malformed:
            with self.subTest(packed=packed[:40]):
                with self.assertRaises(ResourceSnapshotError):
                    decode_resource_snapshot(packed)

    def test_rejects_duplicate_names(self):
        packed = snapshot(totals=[
            ("LiquidFuel", 1, 2),
            ("LiquidFuel", 1, 2),
        ])
        with self.assertRaises(ResourceSnapshotError):
            decode_resource_snapshot(packed)


class PreferredResourceCollectorTests(unittest.TestCase):
    def test_one_custom_call_avoids_stock_collector(self):
        service = SimpleNamespace(
            packed_snapshot=mock.Mock(return_value=snapshot())
        )
        conn = SimpleNamespace(vessel_resources=service)
        vessel = SimpleNamespace()
        with mock.patch.object(
            telemetry_server, "_gather_resources"
        ) as stock:
            result = telemetry_server._gather_resources_preferred(
                conn,
                vessel,
                current_stage=5,
                resource_identity="vessel-a",
                now=100.0,
            )

        service.packed_snapshot.assert_called_once_with(5)
        stock.assert_not_called()
        self.assertEqual(result["r.resource[LiquidFuel]"], 100.0)

    def test_absent_old_service_falls_back_in_same_poll(self):
        vessel = SimpleNamespace()
        fallback = {"res.status": "known", "source": "stock"}
        with mock.patch.object(
            telemetry_server, "_gather_resources", return_value=fallback
        ) as stock:
            result = telemetry_server._gather_resources_preferred(
                SimpleNamespace(),
                vessel,
                current_stage=5,
                resource_identity="vessel-a",
                now=100.0,
            )

        self.assertIs(result, fallback)
        stock.assert_called_once_with(
            vessel,
            current_stage=5,
            resource_identity="vessel-a",
            now=100.0,
        )

    def test_invalid_or_failing_service_falls_back_in_same_poll(self):
        fallback = {"res.status": "known", "source": "stock"}
        for behavior in (
            mock.Mock(return_value=snapshot(status="incomplete")),
            mock.Mock(side_effect=RuntimeError("RPC failed")),
        ):
            with self.subTest(behavior=behavior):
                conn = SimpleNamespace(
                    vessel_resources=SimpleNamespace(packed_snapshot=behavior)
                )
                with mock.patch.object(
                    telemetry_server, "_gather_resources", return_value=fallback
                ) as stock:
                    result = telemetry_server._gather_resources_preferred(
                        conn,
                        SimpleNamespace(),
                        current_stage=5,
                        resource_identity="vessel-a",
                        now=100.0,
                    )
                self.assertIs(result, fallback)
                stock.assert_called_once()


if __name__ == "__main__":
    unittest.main()
