"""Deterministic WebSocket feed for dashboard scene and reconnect testing."""

import argparse
import asyncio
import contextlib
import json

import websockets


DENSE_STAGES = [
    {"index": 0, "ksp": 0, "dvAtmo": 500, "dvVac": 650,
     "twr": 0.80, "twrAtmo": 0.80, "twrVac": 1.00, "burn": 42},
    {"index": 2, "ksp": 2, "dvAtmo": 640, "dvVac": 780,
     "twr": 0.95, "twrAtmo": 0.95, "twrVac": 1.15, "burn": 51},
    {"index": 3, "ksp": 3, "dvAtmo": 820, "dvVac": 980,
     "twr": 1.08, "twrAtmo": 1.08, "twrVac": 1.32, "burn": 58},
    {"index": 5, "ksp": 5, "dvAtmo": 1000, "dvVac": 1200,
     "twr": 1.25, "twrAtmo": 1.25, "twrVac": 1.55, "burn": 75},
    {"index": 6, "ksp": 6, "dvAtmo": 720, "dvVac": 890,
     "twr": 1.42, "twrAtmo": 1.42, "twrVac": 1.68, "burn": 48},
    {"index": 7, "ksp": 7, "dvAtmo": 240, "dvVac": 300,
     "twr": 1.58, "twrAtmo": 1.58, "twrVac": 1.88, "burn": 20},
    {"index": 8, "ksp": 8, "dvAtmo": 360, "dvVac": 440,
     "twr": 1.76, "twrAtmo": 1.76, "twrVac": 2.08, "burn": 29},
    {"index": 9, "ksp": 9, "dvAtmo": 180, "dvVac": 230,
     "twr": 2.10, "twrAtmo": 2.10, "twrVac": 2.45, "burn": 12},
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
        "v.thrust": 680000,
        "v.availableThrust": 1000000,
        "res.names": [
            "LiquidFuel", "Oxidizer", "ElectricCharge", "EnrichedUranium",
            "LqdDeuterium", "Ore", "DepletedFuel",
        ],
        "res.status": "known",
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
        "r.resource[EnrichedUranium]": 82,
        "r.resourceMax[EnrichedUranium]": 100,
        "r.resourceCurrent[EnrichedUranium]": 0,
        "r.resourceCurrentMax[EnrichedUranium]": 0,
        "r.resource[LqdDeuterium]": 1989,
        "r.resourceMax[LqdDeuterium]": 2000,
        "r.resourceCurrent[LqdDeuterium]": 500,
        "r.resourceCurrentMax[LqdDeuterium]": 1000,
        "r.resource[Ore]": 1800,
        "r.resourceMax[Ore]": 3000,
        "r.resourceCurrent[Ore]": 0,
        "r.resourceCurrentMax[Ore]": 0,
        "r.resource[DepletedFuel]": 14,
        "r.resourceMax[DepletedFuel]": 140,
        "r.resourceCurrent[DepletedFuel]": 0,
        "r.resourceCurrentMax[DepletedFuel]": 0,
        "res.stageKnown": True,
        "stage.available": True,
        "stage.complete": True,
        "stage.pending": False,
        "stage.currentKsp": 9,
        "stage.count": 10,
        "stage.unpoweredCount": 2,
        "stage.stages": DENSE_STAGES,
        "stage.totalDvAtmo": 4460,
        "stage.totalDvVac": 5470,
        "stage.totalBurnSeconds": 335,
        "heat.backend": "system_heat",
        "heat.systemHeatStatus": "known",
        "heat.generatedKw": 481.6,
        "heat.removedKw": 456.6,
        "heat.netKw": 25,
        "heat.loops": [
            {
                "id": "1", "tempK": 771, "nominalTempK": 800,
                "genKw": 215, "remKw": 155, "netKw": 60,
                "radiatorState": "online",
                "radiatorControlAvailable": False,
                "producers": [
                    {"name": "Reactor", "role": "producer", "fluxKw": 120},
                    {"name": "Drill", "role": "producer", "count": 2,
                     "fluxKw": 95},
                ],
                "radiators": [
                    {"name": "Radiator", "role": "radiator", "count": 4,
                     "fluxKw": -155},
                ],
                "timeToCriticalSeconds": 260,
            },
            {
                "id": "0", "tempK": 612.4, "nominalTempK": 800,
                "genKw": 166.6, "remKw": 201.6, "netKw": -35,
                "radiatorState": "deploying",
                "radiatorControlAvailable": False,
                "producers": [
                    {"name": "MX-2C Hyperion Fission Reactor",
                     "role": "producer", "fluxKw": 92.4},
                    {"name": "ISRU Converter", "role": "producer",
                     "fluxKw": 74.2},
                ],
                "radiators": [
                    {"name": "Graphene Heat Radiator", "role": "radiator",
                     "count": 4, "fluxKw": -201.6},
                ],
            },
            {
                "id": "2", "tempK": 340, "nominalTempK": 1200,
                "genKw": 100, "remKw": 100, "netKw": 0,
                "radiatorState": "broken",
                "radiatorControlAvailable": False,
                "producers": [
                    {"name": "Cryogenic Fuel Plant", "role": "producer",
                     "fluxKw": 60},
                    {"name": "Deuterium Pump", "role": "producer",
                     "fluxKw": 40},
                ],
                "radiators": [
                    {"name": "Large Folding Radiator", "role": "radiator",
                     "count": 2, "fluxKw": -100},
                ],
            },
        ],
        "damage.status": "known",
        "damage.source": "vessel_damage",
        "damage.parts": [
            {"kind": "antenna", "name": "RFL-100 Giant Dish Reflector",
             "tag": "", "module": "ModuleDeployableReflector",
             "condition": "damaged", "count": 24},
            {"kind": "radiator",
             "name": "XR-175 High Temperature Heat Radiator", "tag": "",
             "module": "ModuleDeployableRadiator",
             "condition": "damaged", "count": 12},
        ],
        "damage.checkedKinds": [],
        "damage.incompleteKinds": [],
        "damage.unsupportedKinds": [],
        "damage.checkedCount": 36,
        "damage.checkedModuleCount": 36,
        "damage.readErrorCount": 0,
        "damage.detectors": ["ModuleDeployablePart.deployState"],
        "damage.damagedCount": 36,
        "damage.lossStatus": "known",
        "damage.lossEvents": [
            {"eventId": "fixture-cleared-fin", "partId": 42020,
             "name": "AV-R8 Winglet", "partName": "winglet3",
             "kind": "wing", "state": "cleared",
             "occurrenceUt": 12335, "occurrenceMet": 112,
             "clearedUt": 12358,
             "clearReason": "intentional_separation",
             "cause": "joint_break"},
        ],
        "elec.reactors": [
            {"index": 0, "partId": 42011,
             "name": "MX-2C Hyperion Fission Reactor", "family": "fission",
             "hasIntegrity": True, "on": True, "status": "Online",
             "ecPerSec": 36.4, "ecMax": 40, "coreTemp": 905,
             "nominalTemp": 900, "integrity": 98.7, "fuel": "12y 184d",
             "fuelKind": "life", "throttle": 91},
            {"index": 1, "partId": 42012,
             "name": "MX-1B Hermes Fission Reactor", "family": "fission",
             "hasIntegrity": True, "on": False, "status": "Offline",
             "ecPerSec": 0, "ecMax": 18, "coreTemp": 411,
             "nominalTemp": 850, "integrity": 100, "fuel": "24y 12d",
             "fuelKind": "life", "throttle": 0},
            {"index": 2, "partId": 42013,
             "name": "FX-2 Fusion Reactor", "family": "fusion",
             "hasIntegrity": False, "on": True, "status": "Online",
             "ecPerSec": 22.6, "ecMax": 24, "coreTemp": 862,
             "nominalTemp": 875, "fuel": "0.000011 u/s",
             "fuelKind": "rate", "fuelRate": "LqdDeuterium 0.000011 u/s",
             "fuelLimitingResource": "LqdDeuterium", "throttle": 94,
             "chargeState": "running"},
        ],
        "elec.reactorsStatus": "known",
        "elec.totalGenEcPerSec": 71.2,
        "elec.otherEcPerSec": 1.2,
        "elec.netEcPerSec": 28.8,
        "elec.drawEcPerSec": 42.4,
        "elec.flowState": "valid",
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
        "sci.krpc.labTelemetryAvailable": True,
        "sci.krpc.labDaySeconds": 21600,
        "sci.krpc.labCount": 1,
        "sci.alarmProviders": {"kac": True, "stock": True},
        "sci.krpc.failedLabCount": 0,
        "sci.krpc.malformedLabCount": 0,
        "sci.krpc.labs": [{
            "id": "42001:1",
            "title": "PX-L2 'Fate' Deep-Space Laboratory Module",
            "dataStored": 1455.199,
            "dataCapacity": 1500,
            "scienceStored": 2.484,
            "scienceCapacity": 500,
            "calculatedSciencePerDay": 53.042,
            "sciencePerDay": 53.042,
            "scienceMultiplier": 5,
            "crewCount": 3,
            "scientistCount": 3,
            "crewRequired": 1,
            "scientistFactor": 6.75,
            "converterAvailable": True,
            "researchEnabled": True,
            "operational": True,
            "converterStatus": "Researching",
            "lastTimeFactor": 1,
            "state": "researching",
            "etaKind": "finite",
            "etaSeconds": 209860.3,
        }],
        "career.science": 384.7,
        "tar.name": "Mock Odyssey Station Docking Port",
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
        "identity.available": True,
        "game.saveFolder": "WMC Fixture Save",
        "editor.craftName": "Mock dual-condition craft",
        "editor.craftPersistentId": "9001",
        "editor.rootPartPersistentId": "1001",
        "editor.partPersistentIds": ["1001", "1002", "1003"],
        "editor.facility": "VAB",
        "editor.body": "Kerbin",
        "editor.bodies": ["Kerbin", "Mun", "Minmus", "Duna"],
        "editor.altitude": 0,
        "editor.mach": 0,
        "editor.revision": 7,
        "editor.analysisRevision": 7,
        "editor.stable": True,
        "editor.summaryAvailable": True,
        "editor.partCount": 31,
        "editor.crewCapacity": 3,
        "editor.stageCount": 10,
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
        "stage.currentKsp": 9,
        "stage.count": 10,
        "stage.unpoweredCount": 2,
        "stage.stages": DENSE_STAGES,
        "stage.totalDvAtmo": 4460,
        "stage.totalDvVac": 5470,
        "stage.totalBurnSeconds": 335,
        "editor.elec.status": "ready",
        "editor.elec.backend": "stock",
        "editor.elec.backendVersion": "stock",
        "editor.elec.degradedReason": "",
        "editor.elec.revision": 7,
        "editor.elec.fingerprint": "mock-editor-electricity-7",
        "editor.elec.craftPersistentId": "9001",
        "editor.elec.rootPartPersistentId": "1001",
        "editor.elec.currentEc": 1200,
        "editor.elec.maxEc": 1200,
        "editor.elec.components": [{
            "stableId": "1001:ModuleCommand", "partId": 1001,
            "partTitle": "Probe Core", "moduleName": "ModuleCommand",
            "category": "command", "role": "consumer",
            "referenceEcPerSec": 0.03, "defaultIncluded": True,
            "continuous": True, "solarScaled": False, "valueKnown": True,
        }],
        "editor.elec.bodies": [{
            "bodyName": "Kerbin", "starName": "Kerbol", "mu": 3.5316e12,
            "radius": 600000, "rotationPeriod": 21600, "atmosDepth": 70000,
            "SOI": 84159286, "maxStarDistance": 13599840256,
            "luminosityScale": 1, "authoritative": True,
        }],
        "editor.elec.pending": False,
        "editor.elec.retained": False,
        **NOTES,
    },
    "inactive": {
        "context.mode": "inactive",
        "flight.active": False,
        "v.name": "",
        "t.universalTime": 9_493_824,
        "mj.transfer.available": True,
        "mj.transfer.compatibilityReady": True,
        "mj.transfer.windows.requestId": "mock-transfer-windows",
        "mj.transfer.windows.state": "completed",
        "mj.transfer.windows.origin": "Kerbin",
        "mj.transfer.windows.completedCount": 9,
        "mj.transfer.windows.totalCount": 9,
        "mj.transfer.windows.progress": 100,
        "mj.transfer.windows.refreshedAtUT": 9_493_700,
        "mj.transfer.windows.results": [
            {"destination": "Moho", "departureUT": 9_533_824, "arrivalUT": 9_933_824, "transferTime": 400_000},
            {"destination": "Duna", "departureUT": 9_553_824, "arrivalUT": 10_153_824, "transferTime": 600_000},
            {"destination": "Dres", "departureUT": 9_573_824, "arrivalUT": 10_373_824, "transferTime": 800_000},
            {"destination": "Neidon", "departureUT": 9_613_824, "arrivalUT": 12_613_824, "transferTime": 3_000_000},
            {"destination": "Urlum", "departureUT": 9_653_824, "arrivalUT": 12_053_824, "transferTime": 2_400_000},
            {"destination": "Eve", "departureUT": 9_733_824, "arrivalUT": 10_133_824, "transferTime": 400_000},
            {"destination": "Jool", "departureUT": 10_093_824, "arrivalUT": 11_293_824, "transferTime": 1_200_000},
            {"destination": "Plock", "departureUT": 10_393_824, "arrivalUT": 13_993_824, "transferTime": 3_600_000},
            {"destination": "Sarnus", "departureUT": 10_693_824, "arrivalUT": 13_493_824, "transferTime": 2_800_000},
        ],
        "overview.scene": "Tracking Station",
        "overview.gameMode": "Career",
        "overview.readOnly": False,
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
            {
                "objectId": "201", "title": "Explore Duna", "type": "Exploration",
                "deadline": 13_200_000,
                "synopsis": "Carry the space program's exploration campaign to Duna and return useful flight data.",
                "description": "Reach the Duna system, establish a stable orbit, and transmit or recover scientific observations gathered there.",
                "notes": "Any active vessel may satisfy these objectives unless an objective says otherwise.",
                "parameters": [
                    {"title": "Enter Duna's sphere of influence", "status": "complete"},
                    {"title": "Orbit Duna", "status": "incomplete"},
                    {"title": "Transmit or recover science from Duna", "status": "incomplete"},
                ],
                "fundsCompletion": 185_000,
                "reputationCompletion": 22,
                "scienceCompletion": 8,
            },
            {
                "objectId": "202",
                "title": "Position a satellite in polar orbit",
                "type": "Satellite", "deadline": 10_800_000,
                "synopsis": "Place a new unmanned satellite into the requested polar orbit.",
                "parameters": [
                    {"title": "Launch a new unmanned probe", "status": "complete"},
                    {"title": "Maintain the specified inclination and altitude", "status": "incomplete"},
                    {"title": "Keep the probe powered and controllable", "status": "incomplete", "optional": True},
                ],
                "fundsCompletion": 92_500,
                "reputationCompletion": 12,
            },
            {
                "objectId": "203",
                "title": "Gather temperature data from Minmus",
                "type": "Science", "deadline": 11_400_000,
                "synopsis": "Collect temperature readings from the requested Minmus survey sites.",
                "parameters": [
                    {"title": "Take a temperature scan in the Minmus Highlands", "status": "complete"},
                    {"title": "Take a temperature scan in the Greater Flats", "status": "incomplete"},
                ],
                "fundsCompletion": 68_000,
                "reputationCompletion": 7,
                "scienceCompletion": 14,
            },
        ],
        "overview.vessels": [
            {"objectId": "101", "guid": "mock-odyssey-guid", "name": "Odyssey", "type": "Ship", "situation": "Orbiting", "body": "Kerbin", "met": 134.2, "crewCount": 3, "crewNames": ["Jebediah Kerman", "Bill Kerman", "Bob Kerman"], "recoverable": False, "mission": True, "apoapsisAltitude": 122_480, "periapsisAltitude": 118_920, "inclination": 0.12, "period": 2_080.4, "eccentricity": 0.0008},
            {"objectId": "102", "name": "Mun Surveyor", "type": "Probe", "situation": "Orbiting", "body": "Mun", "met": 282_844, "crewCount": 0, "mission": True},
            {"objectId": "103", "guid": "mock-duna-relay-guid", "name": "Duna Relay 1", "type": "Relay", "situation": "Orbiting", "body": "Duna", "met": 2_488_000, "crewCount": 0, "crewNames": [], "recoverable": False, "mission": True, "apoapsisAltitude": 2_880_420, "periapsisAltitude": 2_879_610, "inclination": 0.04, "period": 18_152.6, "eccentricity": 0.0001},
            {"objectId": "104", "name": "Kerbin Gateway", "type": "Station", "situation": "Orbiting", "body": "Kerbin", "met": 1_282_000, "crewCount": 6, "mission": True},
            {"objectId": "105", "name": "Minmus Hopper", "type": "Lander", "situation": "Landed", "body": "Minmus", "met": 92_300, "crewCount": 2, "mission": True},
            {"objectId": "106", "name": "Duna Pathfinder", "type": "Rover", "situation": "Landed", "body": "Duna", "met": 3_104_000, "crewCount": 0, "mission": True},
            {"objectId": "107", "guid": "mock-ksc-plane-guid", "name": "KSC Survey Plane", "type": "Plane", "situation": "Landed", "body": "Kerbin", "met": 8_420, "crewCount": 1, "crewNames": ["Valentina Kerman"], "recoverable": True, "mission": True},
            {"objectId": "108", "name": "Minmus Research Base", "type": "Base", "situation": "Landed", "body": "Minmus", "met": 846_000, "crewCount": 4, "mission": True},
            {"objectId": "109", "name": "Kerbin Orbital Tug", "type": "Ship", "situation": "Orbiting", "body": "Kerbin", "met": 184_200, "crewCount": 2, "mission": True},
            {"objectId": "110", "name": "Moho Scanner", "type": "Probe", "situation": "Orbiting", "body": "Moho", "met": 4_824_000, "crewCount": 0, "mission": True},
            {"objectId": "111", "name": "Ike Relay 2", "type": "Relay", "situation": "Orbiting", "body": "Ike", "met": 2_812_000, "crewCount": 0, "mission": True},
            {"objectId": "112", "name": "Mun Polar Rover", "type": "Rover", "situation": "Landed", "body": "Mun", "met": 382_000, "crewCount": 0, "mission": True},
            {"objectId": "113", "name": "Spent Kerbodyne Stage", "type": "Debris", "situation": "Sub Orbital", "body": "Kerbin", "met": 1_240, "crewCount": 0, "mission": False},
        ],
        "overview.vesselsTruncated": False,
        "overview.vesselTerminationAvailable": True,
        "overview.rosterAvailable": True,
        "overview.roster": [
            {"name": "Jebediah Kerman", "assignment": "Odyssey", "status": "Assigned", "type": "Crew", "trait": "Pilot", "experience": 18.2, "level": 3, "veteran": True, "flightCount": 8},
            {"name": "Bill Kerman", "status": "Available", "type": "Crew", "trait": "Engineer", "experience": 9.5, "level": 2, "veteran": True, "flightCount": 5},
            {"name": "Bob Kerman", "status": "Available", "type": "Crew", "trait": "Scientist", "experience": 12.1, "level": 2, "veteran": True, "flightCount": 6},
            {"name": "Valentina Kerman", "status": "Dead", "type": "Crew", "trait": "Pilot", "experience": 22, "level": 4, "veteran": True, "flightCount": 11},
            {"name": "Linus Kerman", "status": "Available", "type": "Crew", "trait": "Scientist", "experience": 4.2, "level": 1, "veteran": False, "flightCount": 2},
            {"name": "Wernher Kerman", "status": "Available", "type": "Crew", "trait": "Engineer", "experience": 7.1, "level": 2, "veteran": False, "flightCount": 4},
            {"name": "Gene Kerman", "assignment": "Kerbin Gateway", "status": "Assigned", "type": "Crew", "trait": "Pilot", "experience": 15.8, "level": 3, "veteran": False, "flightCount": 7},
            {"name": "Mortimer Kerman", "status": "Available", "type": "Crew", "trait": "Engineer", "experience": 2.5, "level": 1, "veteran": False, "flightCount": 1},
            {"name": "Walt Kerman", "status": "Available", "type": "Crew", "trait": "Scientist", "experience": 6.4, "level": 2, "veteran": False, "flightCount": 3},
            {"name": "Gus Kerman", "status": "Available", "type": "Crew", "trait": "Engineer", "experience": 11.2, "level": 2, "veteran": False, "flightCount": 5},
            {"name": "Ed Kerman", "assignment": "Minmus Hopper", "status": "Assigned", "type": "Crew", "trait": "Pilot", "experience": 8.7, "level": 2, "veteran": False, "flightCount": 4},
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


async def receive_commands(
    socket,
    editor_conditions,
    editor_recalculation,
    note_state,
    recalculation_seconds,
):
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
            if recalculation_seconds > 0:
                editor_recalculation["pending_until"] = (
                    asyncio.get_running_loop().time() + recalculation_seconds
                )
            else:
                editor_recalculation["analysis_revision"] = (
                    editor_conditions["revision"]
                )
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
        editor_recalculation = {
            "analysis_revision": editor_conditions["revision"],
            "pending_until": 0.0,
        }
        note_state = {
            "pinned": NOTE,
            "selected": NOTE,
            "selection_mode": "active",
            "favorite": True,
        }
        receiver = asyncio.create_task(
            receive_commands(
                socket,
                editor_conditions,
                editor_recalculation,
                note_state,
                args.editor_recalculation_seconds,
            )
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
                    pending = (
                        editor_recalculation["analysis_revision"]
                        != editor_conditions["revision"]
                        and asyncio.get_running_loop().time()
                        < editor_recalculation["pending_until"]
                    )
                    if not pending:
                        editor_recalculation["analysis_revision"] = (
                            editor_conditions["revision"]
                        )
                    payload.update({
                        "editor.body": editor_conditions["body"],
                        "editor.altitude": editor_conditions["altitude"],
                        "editor.mach": editor_conditions["mach"],
                        "editor.revision": editor_conditions["revision"],
                        "editor.analysisRevision": (
                            editor_recalculation["analysis_revision"]
                        ),
                        "editor.stable": not pending,
                        "stage.pending": pending,
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
        f"drop_every={args.drop_every or 'off'} "
        f"editor_recalculation={args.editor_recalculation_seconds or 'off'}",
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
    parser.add_argument(
        "--editor-recalculation-seconds",
        type=float,
        default=0.0,
        help=(
            "Retain the previous editor analysis for this many seconds after "
            "each editor.conditions command."
        ),
    )
    return parser.parse_args()


if __name__ == "__main__":
    try:
        asyncio.run(run(parse_args()))
    except KeyboardInterrupt:
        print("\n[mock-telemetry] stopped", flush=True)
