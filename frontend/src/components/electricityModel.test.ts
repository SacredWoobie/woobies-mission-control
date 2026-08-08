import { describe, expect, it } from "vitest";
import { flightTelemetryFixture } from "../telemetry/fixtures";
import type { TelemetrySnapshot } from "../telemetry/types";
import { selectElectricity } from "./electricityModel";

describe("selectElectricity", () => {
  it("uses an automatic multi-source layout and gives reactor condition precedence", () => {
    const model = selectElectricity({
      ...flightTelemetryFixture,
      "elec.netEcPerSec": -0.9,
      "elec.drawEcPerSec": 49.5,
    });

    expect(model.tier).toBe(3);
    expect(model.sources.map((source) => source.kind)).toEqual([
      "reactor",
      "rtg",
      "solar",
      "other",
    ]);
    expect(model.status).toEqual({
      label: "DEGRADED",
      detail: "1 of 2 online",
      tone: "warn",
    });
    expect(model.etaKind).toBe("empty");
  });

  it("collapses a single solar family into the hero and exposure status", () => {
    const snapshot: TelemetrySnapshot = {
      "context.mode": "flight",
      "r.resource[ElectricCharge]": 1_820,
      "r.resourceMax[ElectricCharge]": 2_000,
      "elec.totalGenEcPerSec": 2.4,
      "elec.netEcPerSec": 1.6,
      "elec.drawEcPerSec": 0.8,
      "elec.flowState": "valid",
      "elec.reactors": [],
      "solar.count": 6,
      "solar.outputEcPerSec": 2.4,
      "solar.efficiency": 0.94,
      "rtg.count": 0,
    };
    const model = selectElectricity(snapshot);

    expect(model.tier).toBe(2);
    expect(model.primarySource?.kind).toBe("solar");
    expect(model.status.label).toBe("SUNLIT");
    expect(model.etaKind).toBe("full");
    expect(model.etaSeconds).toBeCloseTo(112.5);
  });

  it("reports reactor shutdown as neutral ahead of non-reactor source status", () => {
    const model = selectElectricity({
      "context.mode": "flight",
      "elec.reactors": [
        {
          name: "Fission reactor",
          on: false,
          ecPerSec: 0,
          ecMax: 5,
          coreTemp: 300,
          nominalTemp: 900,
          integrity: 100,
        },
      ],
      "solar.count": 2,
      "solar.outputEcPerSec": 0,
      "solar.efficiency": 0,
      "rtg.count": 1,
      "rtg.outputEcPerSec": 0.5,
      "elec.totalGenEcPerSec": 0.5,
      "elec.netEcPerSec": -0.9,
      "elec.flowState": "valid",
      "r.resource[ElectricCharge]": 441,
      "r.resourceMax[ElectricCharge]": 2_000,
    });

    expect(model.status).toEqual({
      label: "SHUTDOWN",
      detail: "0 of 1 online",
      tone: "unknown",
    });
  });

  it("does not turn a negative reconciliation remainder into an Other source", () => {
    const model = selectElectricity({
      "context.mode": "flight",
      "elec.reactors": [{
        name: "Fission reactor",
        on: true,
        ecPerSec: 62.5,
        ecMax: 62.5,
        coreTemp: 850,
        nominalTemp: 850,
        integrity: 100,
      }],
      "elec.totalGenEcPerSec": 62.5,
      "elec.otherEcPerSec": -0.6,
      "elec.netEcPerSec": 0,
      "elec.flowState": "valid",
      "r.resource[ElectricCharge]": 8_655,
      "r.resourceMax[ElectricCharge]": 8_655,
    });

    expect(model.sources.map((source) => source.kind)).toEqual(["reactor"]);
    expect(model.tier).toBe(2);
    expect(model.primarySource?.kind).toBe("reactor");
  });

  it("reserves the reactor danger tone for thermal or integrity alerts", () => {
    const model = selectElectricity({
      "context.mode": "flight",
      "elec.reactors": [
        {
          name: "Fission reactor",
          on: true,
          ecPerSec: 5,
          ecMax: 5,
          coreTemp: 1_100,
          nominalTemp: 900,
          integrity: 84,
        },
      ],
      "elec.totalGenEcPerSec": 5,
      "elec.netEcPerSec": 0,
      "elec.flowState": "valid",
      "r.resource[ElectricCharge]": 1_000,
      "r.resourceMax[ElectricCharge]": 2_000,
    });

    expect(model.status).toEqual({
      label: "REACTOR ALERT",
      detail: "1 above temperature band · 1 below 90% integrity",
      tone: "danger",
    });
  });

  it("inverts to stored-charge depletion when no generation hardware is installed", () => {
    const model = selectElectricity({
      "context.mode": "flight",
      "r.resource[ElectricCharge]": 640,
      "r.resourceMax[ElectricCharge]": 2_000,
      "elec.netEcPerSec": -0.35,
      "elec.drawEcPerSec": 0.35,
      "elec.flowState": "valid",
      "elec.reactors": [],
      "solar.count": 0,
      "rtg.count": 0,
    });

    expect(model.tier).toBe(1);
    expect(model.generationEcPerSec).toBe(0);
    expect(model.status.label).toBe("NONE");
    expect(model.etaKind).toBe("empty");
    expect(model.etaSeconds).toBeCloseTo(1_828.57, 1);
  });

  it("accepts normalized source telemetry", () => {
    const model = selectElectricity({
      "context.mode": "flight",
      "elec.sources": [
        {
          kind: "fuel-cell",
          count: 1,
          activeCount: 1,
          outputEcPerSec: 1.5,
          runtimeSeconds: 117_780,
          limitingResource: "LiquidFuel",
        },
      ],
      "elec.totalGenEcPerSec": 1.5,
      "elec.netEcPerSec": 0.4,
      "elec.flowState": "valid",
      "r.resource[ElectricCharge]": 1_760,
      "r.resourceMax[ElectricCharge]": 2_000,
    });

    expect(model.tier).toBe(2);
    expect(model.primarySource?.kind).toBe("fuel-cell");
    expect(model.status.label).toBe("RUNNING");
    expect(model.status.detail).toBe("limited by Liquid Fuel");
  });

  it("does not invent timing while flow telemetry is calibrating or saturated", () => {
    const calibrating = selectElectricity({
      "context.mode": "flight",
      "elec.flowState": "calibrating",
      "r.resource[ElectricCharge]": 100,
      "r.resourceMax[ElectricCharge]": 200,
    });
    const full = selectElectricity({
      "context.mode": "flight",
      "elec.flowState": "saturated",
      "r.resource[ElectricCharge]": 200,
      "r.resourceMax[ElectricCharge]": 200,
    });

    expect(calibrating.etaKind).toBe("calibrating");
    expect(calibrating.etaSeconds).toBeUndefined();
    expect(full.etaKind).toBe("full");
    expect(full.etaSeconds).toBeUndefined();
  });
});
