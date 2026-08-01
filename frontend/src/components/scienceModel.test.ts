import { describe, expect, it } from "vitest";
import { flightTelemetryFixture } from "../telemetry/fixtures";
import type { TelemetrySnapshot } from "../telemetry/types";
import { formatLabDuration, selectScience } from "./scienceModel";

describe("selectScience", () => {
  it("formats the reference lab with a Kerbin-calendar decay ETA", () => {
    const model = selectScience(flightTelemetryFixture);
    const lab = model.labs[0];

    expect(lab.statusLabel).toBe("RESEARCHING");
    expect(lab.guidance).toBe("full in 9d 4h");
    expect(lab.dataFraction).toBeCloseTo(1_455.199 / 1_500);
    expect(lab.scienceFraction).toBeCloseTo(2.484 / 500);
    expect(lab.crewLabel).toBe("3 crew · 3 scientists");
  });

  it("gives a science-cap block precedence and suppresses effective rate", () => {
    const model = selectScience({
      ...flightTelemetryFixture,
      "sci.krpc.labs": [{
        ...(flightTelemetryFixture["sci.krpc.labs"]?.[0]!),
        scienceStored: 500,
        sciencePerDay: 0,
        state: "science-full",
        etaKind: "full",
        etaSeconds: 0,
      }],
    });

    expect(model.labs[0].statusLabel).toBe("SCIENCE FULL");
    expect(model.labs[0].guidance).toBe("transmit science to resume");
    expect(model.labs[0].tone).toBe("danger");
    expect(model.labs[0].sciencePerDay).toBe(0);
  });

  it("distinguishes an older service from a capable vessel with no labs", () => {
    const legacy = selectScience({ "context.mode": "flight" });
    const noLabs = selectScience({
      "context.mode": "flight",
      "sci.krpc.labTelemetryAvailable": true,
      "sci.krpc.labs": [],
    });

    expect(legacy.labTelemetryAvailable).toBe(false);
    expect(noLabs.labTelemetryAvailable).toBe(true);
    expect(noLabs.labs).toEqual([]);
  });

  it("clamps malformed capacity fractions without discarding the lab", () => {
    const snapshot: TelemetrySnapshot = {
      "context.mode": "flight",
      "sci.krpc.labTelemetryAvailable": true,
      "sci.krpc.labs": [{
        id: "lab",
        title: "Lab",
        dataStored: 900,
        dataCapacity: 750,
        scienceStored: -2,
        scienceCapacity: 500,
        state: "stopped",
        etaKind: "stopped",
      }],
    };
    const lab = selectScience(snapshot).labs[0];

    expect(lab.dataFraction).toBe(1);
    expect(lab.scienceFraction).toBe(0);
  });

  it("uses the converter calendar day length", () => {
    expect(formatLabDuration(209_860.3, 21_600)).toBe("9d 4h");
    expect(formatLabDuration(209_860.3, 86_400)).toBe("2d 10h");
  });
});
