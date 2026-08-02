import importlib.util
import math
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "electricity.py"

spec = importlib.util.spec_from_file_location("electricity_extension", EXTENSION)
electricity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(electricity)


def flight_payload(
    *,
    ut=100.0,
    amount=100.0,
    capacity=200.0,
    generation=5.0,
    guid="vessel-1",
    name="Ship",
):
    payload = {
        "context.mode": "flight",
        "t.universalTime": ut,
        "v.guid": guid,
        "v.name": name,
        "r.resource[ElectricCharge]": amount,
        "r.resourceMax[ElectricCharge]": capacity,
    }
    if generation is not None:
        payload["elec.totalGenEcPerSec"] = generation
    return payload


class ElectricityFlowEstimatorTests(unittest.TestCase):
    def setUp(self):
        self.estimator = electricity.ElectricityFlowEstimator()

    def update(self, **overrides):
        return self.estimator.update(flight_payload(**overrides))

    def test_generation_remainder_clamps_sequential_sample_noise(self):
        self.assertEqual(
            electricity.generation_remainder(62.5, 63.1),
            0.0,
        )
        self.assertAlmostEqual(
            electricity.generation_remainder(65.0, 62.5, 1.2),
            1.3,
        )

    def test_bracketed_remainder_rejects_reactor_ramp_timing_skew(self):
        self.assertEqual(
            electricity.bracketed_generation_remainder(
                64.0,
                66.0,
                65.0,
            ),
            0.0,
        )
        self.assertEqual(
            electricity.bracketed_generation_remainder(
                66.0,
                64.0,
                65.0,
            ),
            0.0,
        )

    def test_bracketed_remainder_preserves_proven_small_generator(self):
        self.assertAlmostEqual(
            electricity.bracketed_generation_remainder(
                65.4,
                65.6,
                65.0,
            ),
            0.4,
        )

    def test_bracketed_remainder_falls_back_to_available_endpoint(self):
        self.assertAlmostEqual(
            electricity.bracketed_generation_remainder(
                None,
                65.4,
                65.0,
            ),
            0.4,
        )
        self.assertIsNone(
            electricity.bracketed_generation_remainder(
                None,
                float("nan"),
                65.0,
            )
        )

    def test_first_sample_calibrates_then_estimates_net_and_draw(self):
        self.assertEqual(
            self.update(),
            {"elec.flowState": "calibrating"},
        )

        result = self.update(ut=101.0, amount=98.0)

        self.assertEqual(result["elec.flowState"], "valid")
        self.assertEqual(result["elec.netEcPerSec"], -2.0)
        self.assertEqual(result["elec.drawEcPerSec"], 7.0)

    def test_duplicate_cached_amounts_do_not_attenuate_valid_rate(self):
        self.update(ut=100.0, amount=100.0)
        first = self.update(ut=100.5, amount=99.0)
        duplicate = self.update(ut=100.75, amount=99.0)
        second = self.update(ut=101.0, amount=98.0)

        self.assertEqual(first["elec.netEcPerSec"], -2.0)
        self.assertEqual(duplicate["elec.netEcPerSec"], -2.0)
        self.assertEqual(second["elec.netEcPerSec"], -2.0)

    def test_stationary_charge_becomes_valid_after_confirmation_window(self):
        self.update(ut=100.0, amount=100.0, generation=0.0)
        early = self.update(ut=100.5, amount=100.0, generation=0.0)
        confirmed = self.update(ut=101.0, amount=100.0, generation=0.0)

        self.assertEqual(early, {"elec.flowState": "calibrating"})
        self.assertEqual(confirmed["elec.flowState"], "valid")
        self.assertEqual(confirmed["elec.netEcPerSec"], 0.0)
        self.assertEqual(confirmed["elec.drawEcPerSec"], 0.0)

    def test_smoothing_dampens_a_step_change(self):
        estimator = electricity.ElectricityFlowEstimator(smoothing_alpha=0.4)
        estimator.update(flight_payload(ut=100.0, amount=100.0))
        estimator.update(flight_payload(ut=101.0, amount=99.0))

        result = estimator.update(flight_payload(ut=102.0, amount=96.0))

        self.assertAlmostEqual(result["elec.netEcPerSec"], -1.8)
        self.assertAlmostEqual(result["elec.drawEcPerSec"], 6.8)

    def test_positive_net_flow_clamps_draw_to_zero(self):
        self.update(ut=100.0, amount=100.0, generation=1.0)

        result = self.update(ut=101.0, amount=103.0, generation=1.0)

        self.assertEqual(result["elec.netEcPerSec"], 3.0)
        self.assertEqual(result["elec.drawEcPerSec"], 0.0)

    def test_missing_or_invalid_generation_omits_draw_but_keeps_net(self):
        for generation in (None, float("nan"), -1.0):
            with self.subTest(generation=generation):
                estimator = electricity.ElectricityFlowEstimator()
                estimator.update(
                    flight_payload(
                        ut=100.0, amount=100.0, generation=generation
                    )
                )
                result = estimator.update(
                    flight_payload(
                        ut=101.0, amount=99.0, generation=generation
                    )
                )

                self.assertEqual(result["elec.flowState"], "valid")
                self.assertEqual(result["elec.netEcPerSec"], -1.0)
                self.assertNotIn("elec.drawEcPerSec", result)

    def test_full_or_empty_stationary_charge_is_saturated(self):
        for amount in (0.0, 200.0):
            with self.subTest(amount=amount):
                estimator = electricity.ElectricityFlowEstimator()
                estimator.update(flight_payload(ut=100.0, amount=amount))

                confirmed = estimator.update(
                    flight_payload(ut=101.0, amount=amount)
                )
                duplicate = estimator.update(
                    flight_payload(ut=101.25, amount=amount)
                )
                later = estimator.update(
                    flight_payload(ut=102.5, amount=amount)
                )

                expected = {"elec.flowState": "saturated"}
                self.assertEqual(confirmed, expected)
                self.assertEqual(duplicate, expected)
                self.assertEqual(later, expected)

    def test_saturation_clears_when_charge_moves_away_from_boundary(self):
        estimator = electricity.ElectricityFlowEstimator(smoothing_alpha=1.0)
        estimator.update(flight_payload(ut=100.0, amount=200.0))
        estimator.update(flight_payload(ut=101.0, amount=200.0))
        estimator.update(flight_payload(ut=101.25, amount=200.0))

        result = estimator.update(flight_payload(ut=101.5, amount=199.0))

        self.assertEqual(result["elec.flowState"], "valid")
        self.assertEqual(result["elec.netEcPerSec"], -4.0)
        self.assertEqual(result["elec.drawEcPerSec"], 9.0)

    def test_identity_change_resets_calibration_with_name_fallback(self):
        self.update(ut=100.0, amount=100.0, guid="")
        valid = self.update(ut=101.0, amount=99.0, guid="")
        changed = self.update(
            ut=102.0, amount=50.0, guid="", name="Other Ship"
        )

        self.assertEqual(valid["elec.flowState"], "valid")
        self.assertEqual(changed, {"elec.flowState": "calibrating"})

    def test_capacity_change_resets_calibration(self):
        self.update(ut=100.0, amount=100.0)
        self.update(ut=101.0, amount=99.0)

        changed = self.update(ut=102.0, amount=99.0, capacity=300.0)

        self.assertEqual(changed, {"elec.flowState": "calibrating"})

    def test_ut_rewind_resets_calibration(self):
        self.update(ut=100.0, amount=100.0)
        self.update(ut=101.0, amount=99.0)

        reverted = self.update(ut=50.0, amount=150.0)

        self.assertEqual(reverted, {"elec.flowState": "calibrating"})

    def test_non_flight_resets_state(self):
        self.update(ut=100.0, amount=100.0)
        self.update(ut=101.0, amount=99.0)
        inactive = self.estimator.update({"context.mode": "editor_vab"})
        restarted = self.update(ut=102.0, amount=98.0)

        self.assertEqual(inactive, {"elec.flowState": "unavailable"})
        self.assertEqual(restarted, {"elec.flowState": "calibrating"})

    def test_invalid_inputs_are_unavailable_and_reset_state(self):
        invalid_payloads = (
            flight_payload(ut=float("nan")),
            flight_payload(amount=float("inf")),
            flight_payload(capacity=0.0),
            flight_payload(amount=-1.0),
            flight_payload(amount=201.0),
            flight_payload(guid="", name=""),
        )
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                estimator = electricity.ElectricityFlowEstimator()
                self.assertEqual(
                    estimator.update(payload),
                    {"elec.flowState": "unavailable"},
                )

    def test_no_emitted_numeric_value_is_non_finite(self):
        self.update(ut=100.0, amount=100.0, generation=float("inf"))
        result = self.update(
            ut=101.0, amount=99.0, generation=float("inf")
        )

        for value in result.values():
            if isinstance(value, float):
                self.assertTrue(math.isfinite(value))


if __name__ == "__main__":
    unittest.main()
