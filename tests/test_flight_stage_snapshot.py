import math
import unittest

from stage_snapshot import (
    HEADER_WIDTH,
    MAX_ROWS,
    ROW_WIDTH,
    SCHEMA_VERSION,
    decode_flight_stage_snapshot,
)


def snapshot(*, current_stage=1, rows=None):
    rows = rows if rows is not None else [
        [0, 100.04, 150.06, 0.8, 0.9, 1.1, 20.04],
        [1, 200.04, 250.06, 1.8, 1.9, 2.1, 30.04],
    ]
    return [
        SCHEMA_VERSION,
        HEADER_WIDTH,
        ROW_WIDTH,
        current_stage,
        len(rows),
        len(rows),
        *(value for row in rows for value in row),
    ]


class FlightStageSnapshotTests(unittest.TestCase):
    def test_decodes_complete_aligned_table(self):
        result = decode_flight_stage_snapshot(snapshot())

        self.assertTrue(result["stage.available"])
        self.assertTrue(result["stage.complete"])
        self.assertEqual(result["stage.flightSnapshotSchema"], 1)
        self.assertEqual(result["stage.count"], 2)
        self.assertEqual(result["stage.currentKsp"], 1)
        self.assertEqual(result["stage.mapping"], "complete")
        self.assertEqual(result["stage.totalDvAtmo"], 300.1)
        self.assertEqual(result["stage.totalDvVac"], 400.1)
        self.assertEqual(result["stage.stages"][0]["twrStart"], 0.8)
        self.assertEqual(result["stage.stages"][1]["twrEnd"], 2.1)
        self.assertEqual(result["stage.stages"][1]["burn"], 30.0)

    def test_accepts_empty_no_stage_table(self):
        result = decode_flight_stage_snapshot(
            snapshot(current_stage=-1, rows=[])
        )
        self.assertEqual(result["stage.count"], 0)
        self.assertEqual(result["stage.stages"], [])

    def test_rejects_every_structural_mismatch(self):
        cases = []
        value = snapshot()
        value[0] = 2
        cases.append(value)
        value = snapshot()
        value[1] = HEADER_WIDTH + 1
        cases.append(value)
        value = snapshot()
        value[2] = ROW_WIDTH + 1
        cases.append(value)
        value = snapshot()
        value[4] = 1
        cases.append(value)
        value = snapshot()
        value[5] = 1
        cases.append(value)
        value = snapshot()
        value[6] = 4
        cases.append(value)
        cases.append(snapshot()[:-1])
        cases.append(snapshot() + [0])
        cases.append(snapshot(current_stage=MAX_ROWS, rows=[]))

        for payload in cases:
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    decode_flight_stage_snapshot(payload)

    def test_rejects_non_numeric_and_non_finite_values(self):
        for invalid in (True, "1", None, math.nan, math.inf, -math.inf):
            payload = snapshot()
            payload[7] = invalid
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    decode_flight_stage_snapshot(payload)

        with self.assertRaises(ValueError):
            decode_flight_stage_snapshot("not-a-vector")


if __name__ == "__main__":
    unittest.main()
