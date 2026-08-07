import { describe, expect, it } from "vitest";
import {
  ascensionSnapshotsEqual,
  clockSnapshotsEqual,
  consumablesSnapshotsEqual,
  editorSnapshotsEqual,
  editorSummarySnapshotsEqual,
  electricitySnapshotsEqual,
  flightAvailabilitySnapshotsEqual,
  headerSnapshotsEqual,
  heatSnapshotsEqual,
  notesSnapshotsEqual,
  overviewSnapshotsEqual,
  scienceSnapshotsEqual,
  stagingSnapshotsEqual,
  targetSnapshotsEqual,
} from "./subscriptions";
import { editorTelemetryFixture, flightTelemetryFixture, inactiveTelemetryFixture } from "./fixtures";

describe("panel telemetry subscriptions", () => {
  it("ignore unrelated 4 Hz fields while detecting panel-owned changes", () => {
    const unrelated = { ...flightTelemetryFixture, "o.ut": 12345, "nav.heading": 90 };

    expect(headerSnapshotsEqual(flightTelemetryFixture, unrelated)).toBe(true);
    expect(consumablesSnapshotsEqual(flightTelemetryFixture, unrelated)).toBe(true);
    expect(stagingSnapshotsEqual(flightTelemetryFixture, unrelated)).toBe(true);
    expect(notesSnapshotsEqual(flightTelemetryFixture, unrelated)).toBe(true);
    expect(clockSnapshotsEqual(flightTelemetryFixture, unrelated)).toBe(true);
    expect(ascensionSnapshotsEqual(flightTelemetryFixture, unrelated)).toBe(true);
    expect(heatSnapshotsEqual(flightTelemetryFixture, unrelated)).toBe(true);
    expect(electricitySnapshotsEqual(flightTelemetryFixture, unrelated)).toBe(true);
    expect(scienceSnapshotsEqual(flightTelemetryFixture, unrelated)).toBe(true);
    expect(targetSnapshotsEqual(flightTelemetryFixture, unrelated)).toBe(true);
  });

  it("invalidates only the subscription whose values changed", () => {
    const resourceChange = {
      ...flightTelemetryFixture,
      "r.resource[LiquidFuel]": 89,
    };
    const stageChange = {
      ...flightTelemetryFixture,
      "stage.totalDvAtmo": 1490,
    };
    const vesselIdentityChange = {
      ...flightTelemetryFixture,
      "v.name": "Odyssey II",
    };
    const noteChange = {
      ...flightTelemetryFixture,
      "notes.message": "Updated",
    };

    expect(consumablesSnapshotsEqual(flightTelemetryFixture, resourceChange)).toBe(false);
    expect(stagingSnapshotsEqual(flightTelemetryFixture, resourceChange)).toBe(true);
    expect(stagingSnapshotsEqual(flightTelemetryFixture, stageChange)).toBe(false);
    expect(clockSnapshotsEqual(flightTelemetryFixture, vesselIdentityChange)).toBe(false);
    expect(notesSnapshotsEqual(flightTelemetryFixture, noteChange)).toBe(false);
    expect(ascensionSnapshotsEqual(flightTelemetryFixture, {
      ...flightTelemetryFixture,
      "n.heading": 92,
    })).toBe(false);
    expect(ascensionSnapshotsEqual(flightTelemetryFixture, {
      ...flightTelemetryFixture,
      "tar.name": "Kerbin",
      "tar.o.relativeVelocity": 12,
    })).toBe(false);
    expect(ascensionSnapshotsEqual(flightTelemetryFixture, {
      ...flightTelemetryFixture,
      "v.situationString": "Escaping",
    })).toBe(false);
    expect(heatSnapshotsEqual(flightTelemetryFixture, {
      ...flightTelemetryFixture,
      "heat.netKw": -12,
    })).toBe(false);
    expect(targetSnapshotsEqual(flightTelemetryFixture, {
      ...flightTelemetryFixture,
      "dock.ax": 0.2,
    })).toBe(false);
    expect(scienceSnapshotsEqual(flightTelemetryFixture, {
      ...flightTelemetryFixture,
      "sci.krpc.labs": [{
        ...(flightTelemetryFixture["sci.krpc.labs"]?.[0]!),
        scienceStored: 3.1,
      }],
    })).toBe(false);
    expect(scienceSnapshotsEqual(flightTelemetryFixture, {
      ...flightTelemetryFixture,
      "sci.alarmProviders": { kac: false, stock: true },
    })).toBe(false);
  });

  it("hands ElectricCharge updates from Consumables to Electricity", () => {
    const chargeChange = {
      ...flightTelemetryFixture,
      "r.resource[ElectricCharge]": 800,
    };
    expect(consumablesSnapshotsEqual(flightTelemetryFixture, chargeChange)).toBe(true);
    expect(electricitySnapshotsEqual(flightTelemetryFixture, chargeChange)).toBe(false);
    expect(electricitySnapshotsEqual(flightTelemetryFixture, {
      ...flightTelemetryFixture,
      "elec.netEcPerSec": -2,
    })).toBe(false);
  });

  it("tracks editor control values independently from staging simulation values", () => {
    expect(editorSnapshotsEqual(editorTelemetryFixture, {
      ...editorTelemetryFixture,
      "stage.totalDvAtmo": 1400,
    })).toBe(true);
    expect(editorSnapshotsEqual(editorTelemetryFixture, {
      ...editorTelemetryFixture,
      "editor.altitude": 10_000,
    })).toBe(false);
  });

  it("delivers editor revision and analysis provenance changes to both analysis panels", () => {
    const nextRevision = {
      ...editorTelemetryFixture,
      "editor.revision": 8,
    };
    const nextAnalysis = {
      ...editorTelemetryFixture,
      "editor.analysisRevision": 8,
    };

    expect(stagingSnapshotsEqual(editorTelemetryFixture, nextRevision)).toBe(false);
    expect(editorSummarySnapshotsEqual(editorTelemetryFixture, nextRevision)).toBe(false);
    expect(stagingSnapshotsEqual(editorTelemetryFixture, nextAnalysis)).toBe(false);
    expect(editorSummarySnapshotsEqual(editorTelemetryFixture, nextAnalysis)).toBe(false);
  });

  it("invalidates mission-plan subscriptions when the active vessel identity changes", () => {
    const switchedVessel = {
      ...flightTelemetryFixture,
      "v.name": "Duna Lander",
      "v.guid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "v.persistentId": "9100",
      "v.rootPartPersistentId": "2100",
      "v.partPersistentIds": ["2100", "2101"],
    };

    expect(headerSnapshotsEqual(flightTelemetryFixture, switchedVessel)).toBe(false);
    expect(notesSnapshotsEqual(flightTelemetryFixture, switchedVessel)).toBe(false);
    expect(flightAvailabilitySnapshotsEqual(flightTelemetryFixture, switchedVessel)).toBe(false);
  });

  it("updates Mission Control when transfer-window rows or progress change", () => {
    expect(overviewSnapshotsEqual(inactiveTelemetryFixture, {
      ...inactiveTelemetryFixture,
      "mj.transfer.windows.results": [
        ...(inactiveTelemetryFixture["mj.transfer.windows.results"] ?? []),
        { destination: "Sarnus", departureUT: 12_000_000 },
      ],
    })).toBe(false);
    expect(overviewSnapshotsEqual(inactiveTelemetryFixture, {
      ...inactiveTelemetryFixture,
      "mj.transfer.windows.progress": 47,
    })).toBe(false);
    expect(overviewSnapshotsEqual(inactiveTelemetryFixture, {
      ...inactiveTelemetryFixture,
      "mj.transfer.grid.costs": [1, 2, 3],
    })).toBe(true);
  });
});
