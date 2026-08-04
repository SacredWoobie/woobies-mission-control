"""Estimate vessel ElectricCharge flow for production telemetry.

The production collector publishes vessel ElectricCharge totals on a slower
cadence than the dashboard feed.  This extension therefore treats repeated
amounts as cached observations instead of immediately interpreting every
repeat as zero flow.
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping


ELECTRIC_CHARGE = "ElectricCharge"
STATIONARY_CONFIRM_SECONDS = 1.0
SMOOTHING_ALPHA = 0.4
AMOUNT_EPSILON = 1.0e-6
CURVED_SOLAR_MODULE_NAME = "ModuleCurvedSolarPanel"
_DISPLAY_NUMBER = re.compile(
    r"^\s*([-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+))\s*(%|(?:e(?:lectric)?c?)?\s*/\s*s)?\s*$",
    re.IGNORECASE,
)


def _finite_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def _display_number(value):
    """Parse one finite number from a part-module display field."""
    if isinstance(value, bool):
        return None, False
    if isinstance(value, (int, float)):
        number = float(value)
        return (number, False) if math.isfinite(number) else (None, False)
    if not isinstance(value, str):
        return None, False
    match = _DISPLAY_NUMBER.fullmatch(value)
    if match is None:
        return None, False
    try:
        number = float(match.group(1).replace(",", "."))
    except ValueError:
        return None, False
    if not math.isfinite(number):
        return None, False
    return number, match.group(2) == "%"


def _normalized_field_name(value):
    return re.sub(r"[^a-z0-9]", "", str(value).casefold())


def curved_solar_reading(fields):
    """Return ``(energy_flow, sun_exposure)`` for a curved-panel module.

    Generic kRPC module fields use localized PAW labels. English field names
    are preferred, with the module's stable two-field order as a localization
    fallback. Text states such as blocked, broken, or retracted represent zero
    output rather than a collector failure.
    """
    if not isinstance(fields, Mapping) or len(fields) != 2:
        return None

    items = list(fields.items())
    by_name = {
        _normalized_field_name(name): value for name, value in items
    }
    exposure_value = by_name.get("sunexposure")
    flow_value = by_name.get("energyflow")
    if exposure_value is None or flow_value is None:
        exposure_value = items[0][1]
        flow_value = items[1][1]

    exposure, is_percent = _display_number(exposure_value)
    flow, _ = _display_number(flow_value)
    if exposure is None:
        exposure = 0.0
    elif is_percent:
        exposure /= 100.0
    if flow is None:
        flow = 0.0
    if not 0.0 <= exposure <= 1.0 or flow < 0.0:
        return None
    return flow, exposure


def curved_solar_readings(parts):
    """Read all ``ModuleCurvedSolarPanel`` modules from a kRPC Parts proxy."""
    readings = []
    for module in parts.modules_with_name(CURVED_SOLAR_MODULE_NAME):
        reading = curved_solar_reading(module.fields)
        if reading is None:
            raise ValueError("invalid ModuleCurvedSolarPanel display fields")
        readings.append(reading)
    return readings


def solar_summary(readings):
    """Return ``(count, total_flow, average_exposure)`` for solar readings."""
    total_flow = 0.0
    total_exposure = 0.0
    count = 0
    for energy_flow, sun_exposure in readings:
        energy_flow = _finite_number(energy_flow)
        sun_exposure = _finite_number(sun_exposure)
        if (
            energy_flow is None
            or energy_flow < 0.0
            or sun_exposure is None
            or not 0.0 <= sun_exposure <= 1.0
        ):
            raise ValueError("invalid solar-panel reading")
        count += 1
        total_flow += energy_flow
        total_exposure += sun_exposure
    average_exposure = total_exposure / count if count else 0.0
    return count, total_flow, average_exposure


def _vessel_identity(payload):
    guid = payload.get("v.guid")
    if isinstance(guid, str) and guid.strip():
        return ("guid", guid.strip())
    name = payload.get("v.name")
    if isinstance(name, str) and name.strip():
        return ("name", name.strip())
    return None


def generation_remainder(total, *itemized):
    """Return only physically valid unitemized generation.

    The service and per-source calls are sampled sequentially, so their totals
    can briefly disagree. A negative remainder is reconciliation noise, not a
    consuming generator family.
    """
    total = _finite_number(total)
    if total is None or total < 0.0:
        return None
    remainder = total
    for value in itemized:
        value = _finite_number(value)
        if value is not None and value > 0.0:
            remainder -= value
    return max(0.0, remainder)


class ElectricityFlowEstimator:
    """Estimate net EC flow from successive vessel-total observations."""

    def __init__(
        self,
        *,
        smoothing_alpha=SMOOTHING_ALPHA,
        stationary_confirm_seconds=STATIONARY_CONFIRM_SECONDS,
    ):
        if not 0.0 < smoothing_alpha <= 1.0:
            raise ValueError("smoothing_alpha must be in (0, 1].")
        if stationary_confirm_seconds <= 0.0:
            raise ValueError("stationary_confirm_seconds must be positive.")
        self.smoothing_alpha = float(smoothing_alpha)
        self.stationary_confirm_seconds = float(stationary_confirm_seconds)
        self.reset()

    def reset(self):
        self.identity = None
        self.capacity = None
        self.anchor_ut = None
        self.anchor_amount = None
        self.last_seen_ut = None
        self.smoothed_rate = None
        self.saturated_boundary = None

    def _result(self, state, generation=None):
        result = {"elec.flowState": state}
        if state != "valid" or self.smoothed_rate is None:
            return result

        net_rate = self.smoothed_rate
        if not math.isfinite(net_rate):
            self.reset()
            return {"elec.flowState": "unavailable"}
        result["elec.netEcPerSec"] = net_rate

        if generation is not None and generation >= 0.0:
            draw_rate = max(0.0, generation - net_rate)
            if math.isfinite(draw_rate):
                result["elec.drawEcPerSec"] = draw_rate
        return result

    def _start_calibration(self, identity, capacity, universal_time, amount):
        self.identity = identity
        self.capacity = capacity
        self.anchor_ut = universal_time
        self.anchor_amount = amount
        self.last_seen_ut = universal_time
        self.smoothed_rate = None
        self.saturated_boundary = None
        return {"elec.flowState": "calibrating"}

    def update(self, payload):
        """Return additive electricity fields for one telemetry payload."""
        if payload.get("context.mode") != "flight":
            self.reset()
            return {"elec.flowState": "unavailable"}

        identity = _vessel_identity(payload)
        universal_time = _finite_number(payload.get("t.universalTime"))
        amount = _finite_number(
            payload.get(f"r.resource[{ELECTRIC_CHARGE}]")
        )
        capacity = _finite_number(
            payload.get(f"r.resourceMax[{ELECTRIC_CHARGE}]")
        )
        generation = _finite_number(payload.get("elec.totalGenEcPerSec"))
        if generation is not None and generation < 0.0:
            generation = None

        if (
            identity is None
            or universal_time is None
            or amount is None
            or capacity is None
            or capacity <= 0.0
            or amount < 0.0
            or amount > capacity
        ):
            self.reset()
            return {"elec.flowState": "unavailable"}

        if (
            self.identity != identity
            or self.capacity != capacity
            or self.anchor_ut is None
            or self.anchor_amount is None
            or self.last_seen_ut is None
        ):
            return self._start_calibration(
                identity, capacity, universal_time, amount
            )

        if universal_time < self.last_seen_ut:
            self.reset()
            return self._start_calibration(
                identity, capacity, universal_time, amount
            )

        self.last_seen_ut = universal_time
        at_empty = amount <= AMOUNT_EPSILON
        at_full = capacity - amount <= AMOUNT_EPSILON
        boundary = "empty" if at_empty else "full" if at_full else None

        if self.saturated_boundary is not None:
            if (
                boundary == self.saturated_boundary
                and abs(amount - self.anchor_amount) <= AMOUNT_EPSILON
            ):
                # Keep the boundary state stable between resource collector
                # updates. Refreshing the anchor lets flow estimation resume
                # promptly as soon as stored charge moves away from the limit.
                self.anchor_ut = universal_time
                self.anchor_amount = amount
                return {"elec.flowState": "saturated"}
            self.saturated_boundary = None

        elapsed = universal_time - self.anchor_ut
        amount_delta = amount - self.anchor_amount

        # A paused game or a duplicate sample at the same UT provides no new
        # information. Preserve a prior valid estimate, if one exists.
        if elapsed <= 0.0:
            state = "valid" if self.smoothed_rate is not None else "calibrating"
            return self._result(state, generation)

        if abs(amount_delta) <= AMOUNT_EPSILON:
            # Resource totals are cached between collector polls. Do not feed
            # each duplicate frame into the smoother as a zero. A full UT
            # second with no change is enough evidence to accept stationarity.
            if elapsed < self.stationary_confirm_seconds:
                state = (
                    "valid" if self.smoothed_rate is not None else "calibrating"
                )
                return self._result(state, generation)
            raw_rate = 0.0
        else:
            raw_rate = amount_delta / elapsed

        if not math.isfinite(raw_rate):
            self.reset()
            return {"elec.flowState": "unavailable"}

        self.anchor_ut = universal_time
        self.anchor_amount = amount
        if self.smoothed_rate is None:
            self.smoothed_rate = raw_rate
        else:
            alpha = self.smoothing_alpha
            self.smoothed_rate = (
                alpha * raw_rate + (1.0 - alpha) * self.smoothed_rate
            )

        if raw_rate == 0.0 and (at_empty or at_full):
            # At a boundary, an unchanged vessel total cannot distinguish true
            # zero flow from unmet demand or generation clipped by storage.
            self.saturated_boundary = boundary
            return {"elec.flowState": "saturated"}
        return self._result("valid", generation)
