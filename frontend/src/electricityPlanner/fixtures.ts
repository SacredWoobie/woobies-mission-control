import type { TelemetrySnapshot } from "../telemetry/types";

const kerbinBody = {
  bodyName: "Kerbin",
  starName: "Kerbol",
  gravitationalParameter: 3.5316e12,
  radius: 600_000,
  rotationPeriod: 21_600,
  atmosphereDepth: 70_000,
  sphereOfInfluence: 84_159_286,
  solarDistance: 13_599_840_256,
  solarEfficiency: 0.962,
  authoritative: true,
} as const;

// The planner scales solar references by the selected body's efficiency. Keep
// these references tied to the 2.10 / 1.05 EC/s Kerbin presentation values.
const solarReferenceRate = (effectiveRate: number) => effectiveRate / kerbinBody.solarEfficiency;

export const representativeElectricityFixture: TelemetrySnapshot = {
  "context.mode": "editor",
  "game.saveFolder": "Planner fixture save",
  "editor.body": "Kerbin",
  "editor.craftPersistentId": "craft-1",
  "editor.rootPartPersistentId": "root-1",
  "editor.elec.status": "ready",
  "editor.elec.backend": "dynamic_battery_storage",
  "editor.elec.backendVersion": "2.0.0",
  "editor.elec.revision": 1,
  "editor.elec.fingerprint": "fixture-craft-1-r1",
  "editor.elec.saveFolder": "Planner fixture save",
  "editor.elec.craftPersistentId": "craft-1",
  "editor.elec.rootPartPersistentId": "root-1",
  "editor.elec.currentEc": 1200,
  "editor.elec.maxEc": 1200,
  "editor.elec.bodies": [kerbinBody],
  "editor.elec.components": [
    { stableId: "1001:ModuleDeployableSolarPanel", partId: "1001", partTitle: "OX-4L 1×6 Photovoltaic Panel ×5", moduleName: "ModuleDeployableSolarPanel", category: "SOLAR", role: "producer", referenceEcPerSec: solarReferenceRate(2.1), defaultIncluded: true, continuous: false, solarScaled: true, valueKnown: true },
    { stableId: "1002:ModuleDeployableSolarPanel", partId: "1002", partTitle: "OX-STAT Photovoltaic Panel ×3", moduleName: "ModuleDeployableSolarPanel", category: "SOLAR", role: "producer", referenceEcPerSec: solarReferenceRate(1.05), defaultIncluded: true, continuous: false, solarScaled: true, valueKnown: true },
    { stableId: "1003:ModuleGenerator", partId: "1003", partTitle: "PB-NUK Radioisotope Generator", moduleName: "ModuleGenerator", category: "RTG", role: "producer", referenceEcPerSec: 0.75, defaultIncluded: true, continuous: true, solarScaled: false, valueKnown: true },
    { stableId: "1004:ModuleResourceConverter", partId: "1004", partTitle: "Fuel Cell Array", moduleName: "ModuleResourceConverter", category: "CELL", role: "producer", referenceEcPerSec: 6, defaultIncluded: false, continuous: false, solarScaled: false, valueKnown: true },
    { stableId: "1005:ModuleEnginesFX", partId: "1005", partTitle: "IX-6315 Ion Engine ×2", moduleName: "ModuleEnginesFX", category: "PROPULSION", role: "consumer", referenceEcPerSec: 8.74, defaultIncluded: false, continuous: false, solarScaled: false, valueKnown: true },
    { stableId: "1006:ModuleDataTransmitter", partId: "1006", partTitle: "Communotron HG-55 (transmitting)", moduleName: "ModuleDataTransmitter", category: "COMMS", role: "consumer", referenceEcPerSec: 0.83, defaultIncluded: false, continuous: false, solarScaled: false, valueKnown: true },
    { stableId: "1007:ModuleResourceConverter", partId: "1007", partTitle: "Convert-O-Tron 125", moduleName: "ModuleResourceConverter", category: "ISRU", role: "consumer", referenceEcPerSec: 0.6, defaultIncluded: true, continuous: false, solarScaled: false, valueKnown: true },
    { stableId: "1008:ModuleReactionWheel", partId: "1008", partTitle: "Advanced Reaction Wheel, Large", moduleName: "ModuleReactionWheel", category: "RCS", role: "consumer", referenceEcPerSec: 0.45, defaultIncluded: true, continuous: false, solarScaled: false, valueKnown: true },
    { stableId: "1009:ModuleLight", partId: "1009", partTitle: "Illuminator Mk1 ×4", moduleName: "ModuleLight", category: "LIGHT", role: "consumer", referenceEcPerSec: 0.18, defaultIncluded: true, continuous: false, solarScaled: false, valueKnown: true },
    { stableId: "1010:ModuleCommand", partId: "1010", partTitle: "HECS2 Probe Core", moduleName: "ModuleCommand", category: "AVIONICS", role: "consumer", referenceEcPerSec: 0.05, defaultIncluded: true, continuous: true, solarScaled: false, valueKnown: true },
    { stableId: "1011:ModuleCommand", partId: "1011", partTitle: "Mk1-3 Command Pod", moduleName: "ModuleCommand", category: "AVIONICS", role: "consumer", referenceEcPerSec: 0.03, defaultIncluded: true, continuous: true, solarScaled: false, valueKnown: true },
  ],
};

export const denseElectricityFixture: TelemetrySnapshot = {
  ...representativeElectricityFixture,
  "editor.elec.revision": 2,
  "editor.elec.components": Array.from({ length: 48 }, (_, index) => ({
    stableId: `component-${index}`,
    partId: String(index),
    partTitle: `Dense component ${index}`,
    moduleName: index % 2 ? "ModuleGenerator" : "ModuleCommand",
    category: index % 2 ? "Generation" : "Avionics",
    role: index % 2 ? "producer" as const : "consumer" as const,
    referenceEcPerSec: 0.1 + index / 100,
    defaultIncluded: true,
    continuous: index % 2 === 0,
    solarScaled: false,
    valueKnown: true,
  })),
};

export const missingElectricityFixture: TelemetrySnapshot = {
  "context.mode": "editor",
  "editor.body": "Kerbin",
  "editor.elec.status": "warming",
  "editor.elec.pending": true,
  "editor.elec.components": [{ stableId: "unknown", partId: "1", partTitle: "Unknown module", moduleName: "Unknown", category: "Other", role: "consumer", defaultIncluded: true, continuous: true, solarScaled: false, valueKnown: false }],
};

export const degradedElectricityFixture: TelemetrySnapshot = {
  ...representativeElectricityFixture,
  "editor.elec.status": "degraded",
  "editor.elec.degradedReason": "Dynamic Battery Storage reflection was unavailable; stock module fallback is incomplete.",
  "editor.elec.retained": true,
};
