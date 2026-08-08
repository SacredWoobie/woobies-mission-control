import types
import unittest

import telemetry_server


class ThrottleTelemetryTests(unittest.TestCase):
    def test_publishes_control_and_limiter_adjusted_thrust(self):
        vessel = types.SimpleNamespace(
            control=types.SimpleNamespace(throttle=0.0),
            thrust=550_716.0,
            available_thrust=550_723.0,
        )

        self.assertEqual(telemetry_server._gather_throttle_state(vessel), {
            "krpc.throttle": 0.0,
            "v.thrust": 550_716.0,
            "v.availableThrust": 550_723.0,
        })

    def test_keeps_control_throttle_when_thrust_is_unavailable(self):
        class Vessel:
            control = types.SimpleNamespace(throttle=0.42)

            @property
            def thrust(self):
                raise RuntimeError("scene transition")

        self.assertEqual(
            telemetry_server._gather_throttle_state(Vessel()),
            {"krpc.throttle": 0.42},
        )


if __name__ == "__main__":
    unittest.main()
