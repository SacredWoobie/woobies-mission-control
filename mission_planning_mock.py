"""Stateful Mission Planning behavior for the production dashboard mock."""

from __future__ import annotations

import asyncio
import copy
import math


WINDOW_RESULTS = [
    {
        "destination": destination,
        "departureUT": departure,
        "arrivalUT": departure + duration,
        "transferTime": duration,
    }
    for destination, departure, duration in (
        ("Moho", 9_533_824, 400_000),
        ("Dres", 9_573_824, 800_000),
        ("Neidon", 9_613_824, 3_000_000),
        ("Urlum", 9_653_824, 2_400_000),
        ("Jool", 10_093_824, 1_200_000),
        ("Duna", 9_553_824, 600_000),
        ("Eve", 9_733_824, 400_000),
        ("Plock", 10_393_824, 3_600_000),
        ("Sarnus", 10_693_824, 2_800_000),
    )
]


def _bounded_index(value, count):
    try:
        index = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, min(count - 1, index))


class MissionPlanningMockProfile:
    """Apply dashboard commands and overlay deterministic planner telemetry."""

    def __init__(self):
        self.events = asyncio.Queue()
        self.transfer = {}
        self.grid = {}
        self.evaluation = {}
        self.node = {}
        self.windows_request_id = "mock-transfer-windows"
        self.sections = {
            "resonant": {"revision": 0, "value": None},
            "deltaVLibrary": {"revision": 0, "value": None},
            "deltaVDraft": {"revision": 0, "value": None},
        }

    def overlay(self, payload):
        payload.update({
            "mj.transfer.available": True,
            "mj.transfer.compatibilityReady": True,
            "mj.transfer.detectedVersion": "2.15.3.0",
            "mj.transfer.compatibilityTarget": "2.15.3.0",
            "mj.transfer.windows.requestId": self.windows_request_id,
            "mj.transfer.windows.state": "completed",
            "mj.transfer.windows.origin": "Kerbin",
            "mj.transfer.windows.completedCount": len(WINDOW_RESULTS),
            "mj.transfer.windows.totalCount": len(WINDOW_RESULTS),
            "mj.transfer.windows.progress": 100,
            "mj.transfer.windows.refreshedAtUT": 9_493_700,
            "mj.transfer.windows.results": copy.deepcopy(WINDOW_RESULTS),
        })
        payload.update(self.transfer)
        payload.update(self.grid)
        payload.update(self.evaluation)
        payload.update(self.node)
        return payload

    async def _persistence_event(
        self,
        command,
        *,
        status,
        message="",
    ):
        section = command.get("section")
        state = self.sections[section]
        await self.events.put({
            "type": "mission.planning.persistence.state",
            "requestId": command.get("requestId", ""),
            "section": section,
            "value": copy.deepcopy(state["value"]),
            "revision": state["revision"],
            "status": status,
            "message": message,
        })

    async def _apply_persistence(self, command):
        section = command.get("section")
        if section not in self.sections:
            return True
        kind = command.get("type")
        state = self.sections[section]
        if kind == "mission.planning.persistence.get":
            await self._persistence_event(command, status="ok")
            return True

        base_revision = command.get("baseRevision")
        if base_revision != state["revision"]:
            await self._persistence_event(
                command,
                status="conflict",
                message="The mock section changed after the supplied base revision.",
            )
            return True

        state["value"] = copy.deepcopy(command.get("value"))
        state["revision"] += 1
        await self._persistence_event(
            command,
            status=(
                "merged"
                if kind == "mission.planning.persistence.merge"
                else "updated"
            ),
        )
        return True

    def _start_transfer(self, command):
        request_id = str(command.get("requestId", "mock-transfer"))
        fingerprint = str(command.get("fingerprint", "mock-fingerprint"))
        origin = str(command.get("origin", "Kerbin"))
        destination = str(command.get("destination", "Duna"))
        departure = command.get("earliestDepartureUT", 9_553_824)
        if not isinstance(departure, (int, float)) or not math.isfinite(departure):
            departure = 9_553_824
        departure = max(9_553_824, float(departure) + 120_000)
        duration = 600_000.0
        self.transfer = {
            "mj.transfer.state": "completed",
            "mj.transfer.progress": 100,
            "mj.transfer.requestId": request_id,
            "mj.transfer.fingerprint": fingerprint,
            "mj.transfer.origin": origin,
            "mj.transfer.destination": destination,
            "mj.transfer.originParkingAltitude": float(
                command.get("originParkingAltitude", 100_000)
            ),
            "mj.transfer.optimizePoweredCapture": bool(
                command.get("optimizePoweredCapture", False)
            ),
            "mj.transfer.requestedAtUT": 9_493_824,
            "mj.transfer.departureUT": departure,
            "mj.transfer.arrivalUT": departure + duration,
            "mj.transfer.transferTime": duration,
            "mj.transfer.ejectionDeltaV": 1_048.2,
            "mj.transfer.arrivalVInfinity": 1_460.4,
            "mj.transfer.calculatedTotal": 2_508.6,
        }
        self.grid = {}
        self.evaluation = {}
        self.node = {}

    def _publish_grid(self, command):
        request_id = str(command.get("requestId", ""))
        fingerprint = str(command.get("fingerprint", ""))
        departure = float(self.transfer.get("mj.transfer.departureUT", 9_553_824))
        departure_uts = [
            departure - 100_000,
            departure,
            departure + 100_000,
        ]
        transfer_times = [450_000.0, 600_000.0, 750_000.0]
        costs = [
            1_430.0, 1_260.0, 1_310.0,
            1_190.0, 1_048.2, 1_120.0,
            1_340.0, 1_175.0, 1_240.0,
        ]
        self.grid = {
            "mj.transfer.grid.requestId": request_id,
            "mj.transfer.grid.fingerprint": fingerprint,
            "mj.transfer.grid.dateSamples": 3,
            "mj.transfer.grid.durationSamples": 3,
            "mj.transfer.grid.departureUTs": departure_uts,
            "mj.transfer.grid.transferTimes": transfer_times,
            "mj.transfer.grid.costs": costs,
            "mj.transfer.grid.bestDepartureIndex": 1,
            "mj.transfer.grid.bestTransferTimeIndex": 1,
            "mj.transfer.grid.published": True,
        }

    def _evaluate(self, command):
        departure_uts = self.grid.get("mj.transfer.grid.departureUTs", [])
        transfer_times = self.grid.get("mj.transfer.grid.transferTimes", [])
        costs = self.grid.get("mj.transfer.grid.costs", [])
        if not departure_uts or not transfer_times:
            return
        departure_index = _bounded_index(
            command.get("departureIndex"), len(departure_uts)
        )
        duration_index = _bounded_index(
            command.get("transferTimeIndex"), len(transfer_times)
        )
        departure = departure_uts[departure_index]
        duration = transfer_times[duration_index]
        cost_index = departure_index * len(transfer_times) + duration_index
        ejection = costs[cost_index]
        self.evaluation = {
            "mj.transfer.evaluation.requestId": str(command.get("requestId", "")),
            "mj.transfer.evaluation.fingerprint": str(
                command.get("fingerprint", "")
            ),
            "mj.transfer.evaluation.departureIndex": departure_index,
            "mj.transfer.evaluation.transferTimeIndex": duration_index,
            "mj.transfer.evaluation.departureUT": departure,
            "mj.transfer.evaluation.arrivalUT": departure + duration,
            "mj.transfer.evaluation.transferTime": duration,
            "mj.transfer.evaluation.ejectionDeltaV": ejection,
            "mj.transfer.evaluation.arrivalVInfinity": 1_460.4,
            "mj.transfer.evaluation.rawCost": ejection + 1_460.4,
            "mj.transfer.evaluation.departureVInfinityX": 842.1,
            "mj.transfer.evaluation.departureVInfinityY": -217.4,
            "mj.transfer.evaluation.departureVInfinityZ": 586.8,
        }

    def _preview_node(self, command):
        self.node = {
            "mj.transfer.node.actionId": str(command.get("actionId", "")),
            "mj.transfer.node.fingerprint": str(command.get("fingerprint", "")),
            "mj.transfer.node.vesselGuid": str(
                command.get("expectedVesselGuid", "")
            ),
            "mj.transfer.node.state": "ready",
            "mj.transfer.node.nodeUT": float(
                command.get("departureUT", 9_553_824)
            ),
            "mj.transfer.node.deltaV": float(
                command.get("expectedDeltaV", 1_048.2)
            ),
            "mj.transfer.node.deltaVX": 842.1,
            "mj.transfer.node.deltaVY": -217.4,
            "mj.transfer.node.deltaVZ": 586.8,
            "mj.transfer.node.apoapsisAltitude": 12_400_000,
            "mj.transfer.node.periapsisAltitude": 82_000,
            "mj.transfer.node.inclination": 0.43,
            "mj.transfer.node.eccentricity": 0.71,
            "mj.transfer.node.semiMajorAxis": 6_482_000,
        }

    async def apply_command(self, command):
        """Apply one dashboard command; return whether it was recognized."""
        kind = command.get("type")
        if not isinstance(kind, str):
            return False
        if kind.startswith("mission.planning.persistence."):
            return await self._apply_persistence(command)
        if kind in {"mechjeb.transfer.start", "mechjeb.transfer.start_after"}:
            self._start_transfer(command)
        elif kind == "mechjeb.transfer.cancel":
            self.transfer["mj.transfer.state"] = "cancelled"
        elif kind == "mechjeb.transfer.release":
            self.transfer = {}
            self.grid = {}
            self.evaluation = {}
            self.node = {}
        elif kind == "mechjeb.transfer.windows.refresh":
            self.windows_request_id = str(
                command.get("requestId", self.windows_request_id)
            )
        elif kind == "mechjeb.transfer.grid.request":
            self._publish_grid(command)
        elif kind == "mechjeb.transfer.grid.ack":
            self.grid["mj.transfer.grid.published"] = False
        elif kind == "mechjeb.transfer.evaluate":
            self._evaluate(command)
        elif kind == "mechjeb.transfer.node.preview":
            self._preview_node(command)
        elif kind == "mechjeb.transfer.node.create":
            self.node["mj.transfer.node.state"] = "created"
        else:
            return False
        return True

    async def drain_events(self):
        """Return every queued wire event without blocking."""
        events = []
        while True:
            try:
                events.append(self.events.get_nowait())
            except asyncio.QueueEmpty:
                return events
