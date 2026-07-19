import { describe, expect, it } from "vitest";
import {
  ascensionSnapshotsEqual,
  clockSnapshotsEqual,
  consumablesSnapshotsEqual,
  editorSnapshotsEqual,
  electricitySnapshotsEqual,
  headerSnapshotsEqual,
  heatSnapshotsEqual,
  notesSnapshotsEqual,
  scienceSnapshotsEqual,
  stagingSnapshotsEqual,
  targetSnapshotsEqual,
} from "./subscriptions";
import { editorTelemetryFixture, flightTelemetryFixture } from "./fixtures";

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
    const noteChange = {
      ...flightTelemetryFixture,
      "notes.message": "Updated",
    };

    expect(consumablesSnapshotsEqual(flightTelemetryFixture, resourceChange)).toBe(false);
    expect(stagingSnapshotsEqual(flightTelemetryFixture, resourceChange)).toBe(true);
    expect(stagingSnapshotsEqual(flightTelemetryFixture, stageChange)).toBe(false);
    expect(notesSnapshotsEqual(flightTelemetryFixture, noteChange)).toBe(false);
    expect(ascensionSnapshotsEqual(flightTelemetryFixture, {
      ...flightTelemetryFixture,
      "n.heading": 92,
    })).toBe(false);
    expect(heatSnapshotsEqual(flightTelemetryFixture, {
      ...flightTelemetryFixture,
      "heat.netKw": -12,
    })).toBe(false);
    expect(targetSnapshotsEqual(flightTelemetryFixture, {
      ...flightTelemetryFixture,
      "dock.ax": 0.2,
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
});
