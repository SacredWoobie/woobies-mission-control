"""Deterministic WebSocket feed for dashboard scene and reconnect testing."""

import argparse
import asyncio
import contextlib
import json

import websockets


STAGES = [
    {"index": 0, "ksp": 0, "dvAtmo": 500, "dvVac": 650,
     "twr": 0.8, "twrAtmo": 0.8, "twrVac": 1.0, "burn": 42},
    {"index": 2, "ksp": 2, "dvAtmo": 1000, "dvVac": 1200,
     "twr": 1.25, "twrAtmo": 1.25, "twrVac": 1.55, "burn": 75},
]

NOTE = {
    "name": "Mock Flight Log",
    "relativePath": "Mock Flight Log.txt",
    "modified": 1784311200,
    "size": 112,
    "text": "Deterministic live-feed test note.\nScene transitions are nominal.",
    "truncated": False,
}

CHECKLIST = {
    "name": "Mock Checklist",
    "relativePath": "Mock Checklist.txt",
    "modified": 1784311000,
    "size": 84,
    "text": "[x] Establish link\n[ ] Verify orbital insertion\n[ ] Begin rendezvous",
    "truncated": False,
}

NOTES = {
    "notes.available": True,
    "notes.activeFound": True,
    "notes.message": "",
    "notes.active": NOTE,
    "notes.selected": NOTE,
    "notes.selectedPath": NOTE["relativePath"],
    "notes.selectionMode": "active",
    "notes.pinned": NOTE,
    "notes.pinnedPath": NOTE["relativePath"],
    "notes.catalog": [
        {"name": NOTE["name"], "relativePath": NOTE["relativePath"],
         "isActiveLog": True, "isFavorite": False},
        {"name": CHECKLIST["name"], "relativePath": CHECKLIST["relativePath"],
         "isActiveLog": False, "isFavorite": True},
    ],
    "notes.catalogTruncated": False,
}

SCENES = {
    "flight": {
        "context.mode": "flight",
        "flight.active": True,
        "v.name": "Mock Odyssey",
        "v.body": "Kerbin",
        "v.missionTime": 134.2,
        "v.altitude": 82415.6,
        "v.verticalSpeed": 128.4,
        "v.surfaceSpeed": 2215.3,
        "v.orbitalVelocity": 2287.1,
        "v.geeForce": 1.08,
        "v.situationString": "Orbiting",
        "v.biome": "Midlands",
        "t.universalTime": 9493824,
        "n.heading": 91.8,
        "n.pitch": 4.2,
        "n.roll": -1.4,
        "o.ApA": 104238.4,
        "o.PeA": 78614.7,
        "o.timeToAp": 312.8,
        "o.timeToPe": 1084.5,
        "o.inclination": 0.43,
        "o.eccentricity": 0.0187,
        "o.period": 1397.6,
        "krpc.sas": False,
        "krpc.sasMode": "SASMode.stability_assist",
        "mj.sasActive": True,
        "mj.sasMode": "SmartASSAutopilotMode.orbit_prograde",
        "rt.available": True,
        "rt.hasConnection": True,
        "rt.signalDelay": 0.083,
        "comm.krpc.canCommunicate": True,
        "comm.krpc.signalStrength": 0.94,
        "krpc.throttle": 0.68,
        "res.names": ["LiquidFuel", "Oxidizer", "ElectricCharge"],
        "r.resource[LiquidFuel]": 90,
        "r.resourceMax[LiquidFuel]": 100,
        "r.resourceCurrent[LiquidFuel]": 45,
        "r.resourceCurrentMax[LiquidFuel]": 50,
        "r.resource[Oxidizer]": 110,
        "r.resourceMax[Oxidizer]": 120,
        "r.resourceCurrent[Oxidizer]": 55,
        "r.resourceCurrentMax[Oxidizer]": 60,
        "r.resource[ElectricCharge]": 825,
        "r.resourceMax[ElectricCharge]": 1000,
        "r.resourceCurrent[ElectricCharge]": 0,
        "r.resourceCurrentMax[ElectricCharge]": 0.4,
        "res.stageKnown": True,
        "stage.available": True,
        "stage.complete": True,
        "stage.pending": False,
        "stage.currentKsp": 2,
        "stage.stages": STAGES,
        "stage.totalDvAtmo": 1500,
        "stage.totalDvVac": 1850,
        "heat.generatedKw": 284.2,
        "heat.removedKw": 301.6,
        "heat.netKw": -17.4,
        "heat.loops": [
            {"id": "1", "tempK": 612.4, "genKw": 184.2, "remKw": 201.6},
            {"id": "2", "tempK": 428.1, "genKw": 100, "remKw": 100},
        ],
        "elec.reactors": [
            {"name": "MX-2C Hyperion Fission Reactor", "on": True,
             "ecPerSec": 36.4, "ecMax": 40, "coreTemp": 905,
             "nominalTemp": 900, "integrity": 98.7, "fuel": "12y 184d"},
        ],
        "elec.totalGenEcPerSec": 48.6,
        "elec.otherEcPerSec": 1.2,
        "solar.count": 4,
        "solar.outputEcPerSec": 9.8,
        "solar.efficiency": 0.87,
        "rtg.count": 1,
        "rtg.outputEcPerSec": 1.2,
        "sci.krpc.total": 42.7,
        "sci.krpc.transmitTotal": 19.4,
        "sci.krpc.count": 2,
        "sci.krpc.experiments": [
            {"title": "Mystery Goo observation from space near Kerbin",
             "value": 24.2, "transmit": 8.1},
            {"title": "Crew report from space near Kerbin",
             "value": 18.5, "transmit": 11.3},
        ],
        "career.science": 384.7,
        "tar.name": "Mock Odyssey Station",
        "tar.type": "dockingport",
        "tar.distance": 184.6,
        "tar.o.relativeVelocity": 2.3,
        "tar.o.velocity": 2291.4,
        "tar.o.ApA": 105812,
        "tar.o.PeA": 79212,
        "tar.o.inclination": 0.51,
        "dock.x": 0.8,
        "dock.y": -0.4,
        "dock.axial": 184.5,
        "dock.ax": 2.1,
        "dock.ay": -1.3,
        **NOTES,
    },
    "editor": {
        "context.mode": "editor",
        "flight.active": False,
        "editor.craftName": "Mock dual-condition craft",
        "editor.facility": "VAB",
        "editor.body": "Kerbin",
        "editor.bodies": ["Kerbin", "Mun", "Minmus", "Duna"],
        "editor.altitude": 0,
        "editor.mach": 0,
        "editor.revision": 7,
        "editor.stable": True,
        "editor.summaryAvailable": True,
        "editor.partCount": 31,
        "editor.crewCapacity": 3,
        "editor.stageCount": 3,
        "editor.wetMass": 18.742,
        "editor.dryMass": 7.416,
        "editor.resourceMass": 11.326,
        "editor.totalCost": 42580,
        "editor.dryCost": 39740,
        "editor.resourceCost": 2840,
        "editor.res.names": [
            "ElectricCharge", "LiquidFuel", "Oxidizer", "MonoPropellant",
        ],
        "editor.res[ElectricCharge]": 1200,
        "editor.resMax[ElectricCharge]": 1200,
        "editor.res[LiquidFuel]": 810,
        "editor.resMax[LiquidFuel]": 810,
        "editor.res[Oxidizer]": 990,
        "editor.resMax[Oxidizer]": 990,
        "editor.res[MonoPropellant]": 30,
        "editor.resMax[MonoPropellant]": 30,
        "stage.available": True,
        "stage.complete": True,
        "stage.pending": False,
        "stage.currentKsp": 2,
        "stage.stages": STAGES,
        "stage.totalDvAtmo": 1500,
        "stage.totalDvVac": 1850,
        **NOTES,
    },
    "inactive": {
        "context.mode": "inactive",
        "flight.active": False,
        "v.name": "",
        "t.universalTime": 9_493_824,
        "overview.scene": "Tracking Station",
        "overview.gameMode": "Career",
        "overview.readOnly": True,
        "overview.capabilities": {
            "funds": True,
            "science": True,
            "reputation": True,
            "contracts": True,
        },
        "overview.funds": 1_284_650,
        "overview.science": 384.7,
        "overview.reputation": 72.4,
        "overview.contractCounts": {
            "active": 3,
            "offered": 5,
            "completed": 28,
            "failed": 1,
        },
        "overview.contracts": [
            {"title": "Explore Duna", "type": "Exploration", "deadline": 13_200_000},
            {"title": "Position a satellite in polar orbit", "type": "Satellite", "deadline": 10_800_000},
            {"title": "Gather temperature data from Minmus", "type": "Science", "deadline": 11_400_000},
        ],
        "overview.vessels": [
            {"name": "Odyssey", "type": "Ship", "situation": "Orbiting", "body": "Kerbin", "met": 134.2, "crewCount": 3, "mission": True},
            {"name": "Mun Surveyor", "type": "Probe", "situation": "Orbiting", "body": "Mun", "met": 282_844, "crewCount": 0, "mission": True},
            {"name": "Duna Relay 1", "type": "Relay", "situation": "Orbiting", "body": "Duna", "met": 2_488_000, "crewCount": 0, "mission": True},
            {"name": "Kerbin Gateway", "type": "Station", "situation": "Orbiting", "body": "Kerbin", "met": 1_282_000, "crewCount": 6, "mission": True},
            {"name": "Minmus Hopper", "type": "Lander", "situation": "Landed", "body": "Minmus", "met": 92_300, "crewCount": 2, "mission": True},
            {"name": "Duna Pathfinder", "type": "Rover", "situation": "Landed", "body": "Duna", "met": 3_104_000, "crewCount": 0, "mission": True},
            {"name": "KSC Survey Plane", "type": "Plane", "situation": "Flying", "body": "Kerbin", "met": 8_420, "crewCount": 1, "mission": True},
            {"name": "Minmus Research Base", "type": "Base", "situation": "Landed", "body": "Minmus", "met": 846_000, "crewCount": 4, "mission": True},
            {"name": "Kerbin Orbital Tug", "type": "Ship", "situation": "Orbiting", "body": "Kerbin", "met": 184_200, "crewCount": 2, "mission": True},
            {"name": "Moho Scanner", "type": "Probe", "situation": "Orbiting", "body": "Moho", "met": 4_824_000, "crewCount": 0, "mission": True},
            {"name": "Ike Relay 2", "type": "Relay", "situation": "Orbiting", "body": "Ike", "met": 2_812_000, "crewCount": 0, "mission": True},
            {"name": "Mun Polar Rover", "type": "Rover", "situation": "Landed", "body": "Mun", "met": 382_000, "crewCount": 0, "mission": True},
            {"name": "Spent Kerbodyne Stage", "type": "Debris", "situation": "Sub Orbital", "body": "Kerbin", "met": 1_240, "crewCount": 0, "mission": False},
        ],
        "overview.vesselsTruncated": False,
        "overview.rosterAvailable": True,
        "overview.roster": [
            {"name": "Jebediah Kerman", "status": "Assigned", "type": "Crew", "trait": "Pilot", "experience": 18.2, "level": 3, "veteran": True, "flightCount": 8},
            {"name": "Bill Kerman", "status": "Available", "type": "Crew", "trait": "Engineer", "experience": 9.5, "level": 2, "veteran": True, "flightCount": 5},
            {"name": "Bob Kerman", "status": "Available", "type": "Crew", "trait": "Scientist", "experience": 12.1, "level": 2, "veteran": True, "flightCount": 6},
            {"name": "Valentina Kerman", "status": "Dead", "type": "Crew", "trait": "Pilot", "experience": 22, "level": 4, "veteran": True, "flightCount": 11},
            {"name": "Linus Kerman", "status": "Available", "type": "Crew", "trait": "Scientist", "experience": 4.2, "level": 1, "veteran": False, "flightCount": 2},
            {"name": "Wernher Kerman", "status": "Available", "type": "Crew", "trait": "Engineer", "experience": 7.1, "level": 2, "veteran": False, "flightCount": 4},
            {"name": "Gene Kerman", "status": "Assigned", "type": "Crew", "trait": "Pilot", "experience": 15.8, "level": 3, "veteran": False, "flightCount": 7},
            {"name": "Mortimer Kerman", "status": "Available", "type": "Crew", "trait": "Engineer", "experience": 2.5, "level": 1, "veteran": False, "flightCount": 1},
            {"name": "Walt Kerman", "status": "Available", "type": "Crew", "trait": "Scientist", "experience": 6.4, "level": 2, "veteran": False, "flightCount": 3},
            {"name": "Gus Kerman", "status": "Available", "type": "Crew", "trait": "Engineer", "experience": 11.2, "level": 2, "veteran": False, "flightCount": 5},
            {"name": "Ed Kerman", "status": "Assigned", "type": "Crew", "trait": "Pilot", "experience": 8.7, "level": 2, "veteran": False, "flightCount": 4},
            {"name": "Al Kerman", "status": "Available", "type": "Crew", "trait": "Scientist", "experience": 3.8, "level": 1, "veteran": False, "flightCount": 2},
            {"name": "Werner Kerman", "status": "Available", "type": "Crew", "trait": "Engineer", "experience": 5.6, "level": 1, "veteran": False, "flightCount": 3},
        ],
        "overview.alarms": [
            {"title": "Odyssey maneuver", "type": "Maneuver", "time": 9_496_400, "source": "Stock", "vessel": "Odyssey"},
            {"title": "Crew conference", "type": "Raw", "time": 9_505_000, "source": "KAC", "vessel": ""},
            {"title": "Mun Surveyor SOI change", "type": "SOI Change", "time": 9_520_000, "source": "KAC", "vessel": "Mun Surveyor"},
        ],
        "overview.alarmProviders": {"stock": "available", "kac": "available"},
        "overview.refreshSeconds": {
            "economy": 2,
            "alarms": 2,
            "fleet": 5,
            "contracts": 10,
            "roster": 15,
        },
        **NOTES,
    },
}


async def receive_commands(socket, editor_conditions, note_state):
    async for raw in socket:
        try:
            command = json.loads(raw)
        except (TypeError, ValueError, json.JSONDecodeError):
            print(f"[mock-telemetry] ignored invalid command: {raw!r}", flush=True)
            continue
        print(f"[mock-telemetry] command: {json.dumps(command, sort_keys=True)}",
              flush=True)
        if command.get("type") == "editor.conditions":
            for key in ("body", "altitude", "mach"):
                if key in command:
                    editor_conditions[key] = command[key]
            editor_conditions["revision"] += 1
        elif command.get("type") == "notes.pin":
            path = command.get("relativePath")
            note_state["pinned"] = (
                CHECKLIST if path == CHECKLIST["relativePath"]
                else NOTE if path else None
            )
        elif command.get("type") == "notes.select":
            path = command.get("relativePath")
            note_state["selected"] = CHECKLIST if path == CHECKLIST["relativePath"] else NOTE
            note_state["selection_mode"] = "browse" if path else "active"
        elif command.get("type") == "notes.favorite":
            note_state["favorite"] = bool(command.get("favorite"))


async def run(args):
    scene_names = [name.strip().casefold() for name in args.scenes.split(",")]
    invalid = [name for name in scene_names if name not in SCENES]
    if invalid:
        raise ValueError(f"Unknown scene(s): {', '.join(invalid)}")

    async def handler(socket):
        peer = getattr(socket, "remote_address", None)
        print(f"[mock-telemetry] client linked: {peer}", flush=True)
        editor_conditions = {
            "body": SCENES["editor"]["editor.body"],
            "altitude": SCENES["editor"]["editor.altitude"],
            "mach": SCENES["editor"]["editor.mach"],
            "revision": SCENES["editor"]["editor.revision"],
        }
        note_state = {
            "pinned": NOTE,
            "selected": NOTE,
            "selection_mode": "active",
            "favorite": True,
        }
        receiver = asyncio.create_task(
            receive_commands(socket, editor_conditions, note_state)
        )
        frame = 0
        try:
            while True:
                scene = scene_names[frame % len(scene_names)]
                payload = dict(SCENES[scene])
                payload["notes.pinned"] = note_state["pinned"]
                payload["notes.pinnedPath"] = (
                    note_state["pinned"]["relativePath"]
                    if note_state["pinned"] else ""
                )
                payload["notes.selected"] = note_state["selected"]
                payload["notes.selectedPath"] = note_state["selected"]["relativePath"]
                payload["notes.selectionMode"] = note_state["selection_mode"]
                payload["notes.catalog"] = [
                    {"name": NOTE["name"], "relativePath": NOTE["relativePath"],
                     "isActiveLog": True, "isFavorite": False},
                    {"name": CHECKLIST["name"],
                     "relativePath": CHECKLIST["relativePath"],
                     "isActiveLog": False,
                     "isFavorite": note_state["favorite"]},
                ]
                if scene == "editor":
                    payload.update({
                        "editor.body": editor_conditions["body"],
                        "editor.altitude": editor_conditions["altitude"],
                        "editor.mach": editor_conditions["mach"],
                        "editor.revision": editor_conditions["revision"],
                    })
                elif scene == "flight":
                    payload.update({
                        "t.universalTime": SCENES["flight"]["t.universalTime"] + frame,
                        "v.missionTime": SCENES["flight"]["v.missionTime"] + frame,
                        "v.altitude": SCENES["flight"]["v.altitude"] + frame * 128.4,
                        "n.heading": (SCENES["flight"]["n.heading"] + frame * 0.8) % 360,
                    })
                payload["mock.frame"] = frame + 1
                await socket.send(json.dumps(payload))
                print(f"[mock-telemetry] frame {frame + 1}: {scene}", flush=True)
                frame += 1
                if args.drop_every and frame % args.drop_every == 0:
                    print("[mock-telemetry] intentional reconnect test drop", flush=True)
                    await socket.close(code=1012, reason="deterministic reconnect test")
                    break
                await asyncio.sleep(args.interval)
        except websockets.ConnectionClosed:
            pass
        finally:
            receiver.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await receiver
            print(f"[mock-telemetry] client disconnected: {peer}", flush=True)

    print(
        f"[mock-telemetry] ws://{args.host}:{args.port} "
        f"scenes={','.join(scene_names)} interval={args.interval}s "
        f"drop_every={args.drop_every or 'off'}",
        flush=True,
    )
    async with websockets.serve(handler, args.host, args.port):
        await asyncio.Future()


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8091)
    parser.add_argument("--scenes", default="flight,editor,inactive")
    parser.add_argument("--interval", type=float, default=2.0)
    parser.add_argument(
        "--drop-every",
        type=int,
        default=0,
        help="Close each client after N frames to exercise automatic reconnect.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    try:
        asyncio.run(run(parse_args()))
    except KeyboardInterrupt:
        print("\n[mock-telemetry] stopped", flush=True)
