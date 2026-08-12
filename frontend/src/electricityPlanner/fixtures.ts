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
  "editor.elec.craftPersistentId": "craft-1",
  "editor.elec.rootPartPersistentId": "root-1",
  "editor.elec.currentEc": 300,
  "editor.elec.maxEc": 500,
  "editor.elec.bodies": [kerbinBody],
  "editor.elec.components": [
    { stableId: "panel-a", partId: "1", partTitle: "OX-4L", moduleName: "ModuleDeployableSolarPanel", category: "Solar", role: "producer", referenceEcPerSec: 2, defaultIncluded: true, continuous: false, solarScaled: true, valueKnown: true },
    { stableId: "rtg-a", partId: "2", partTitle: "PB-NUK", moduleName: "ModuleGenerator", category: "Radioisotope", role: "producer", referenceEcPerSec: 0.8, defaultIncluded: true, continuous: true, solarScaled: false, valueKnown: true },
    { stableId: "probe-a", partId: "3", partTitle: "OKTO2", moduleName: "ModuleCommand", category: "Command", role: "consumer", referenceEcPerSec: 0.5, defaultIncluded: true, continuous: true, solarScaled: false, valueKnown: true },
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
