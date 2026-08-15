import { describe, expect, it } from "vitest";
import {
  editorTelemetryFixture,
  flightTelemetryFixture,
  inactiveTelemetryFixture,
} from "./fixtures";
import { allFixtureOptionalMods, applyFixtureOptionalMods } from "./fixtureMods";

describe("development fixture optional mods", () => {
  it("keeps the fully provisioned fixture unchanged when every optional mod is enabled", () => {
    const configured = applyFixtureOptionalMods(flightTelemetryFixture, allFixtureOptionalMods());

    expect(configured).toEqual(flightTelemetryFixture);
    expect(Object.values(configured["dashboard.capabilities"]!.features).every(({ status }) => status === "available")).toBe(true);
  });

  it("models disabled flight mods through stock fallbacks and unavailable services", () => {
    const configured = applyFixtureOptionalMods(flightTelemetryFixture, new Set());
    const features = configured["dashboard.capabilities"]!.features;

    expect(configured["notes.available"]).toBe(false);
    expect(configured["notes.catalog"]).toEqual([]);
    expect(configured["sci.alarmProviders"]).toEqual({ kac: false, stock: true });
    expect(configured["rt.available"]).toBe(false);
    expect(configured["rt.hasConnection"]).toBeUndefined();
    expect(configured["comm.krpc.canCommunicate"]).toBe(true);
    expect(configured["stage.available"]).toBe(false);
    expect(configured["stage.stages"]).toEqual([]);
    expect(configured["mj.transfer.available"]).toBe(false);
    expect(configured["mj.transfer.windows.results"]).toEqual([]);
    expect(configured["heat.backend"]).toBe("stock");
    expect(configured["heat.loops"]).toEqual([]);
    expect(configured["heat.parts"]).toHaveLength(2);
    expect(configured["elec.reactorsStatus"]).toBe("not_applicable");

    expect(features.notes.status).toBe("unavailable");
    expect(features.science_alarms.status).toBe("fallback");
    expect(features.communications.status).toBe("fallback");
    expect(features.stage_analysis.status).toBe("unavailable");
    expect(features.live_transfer_calculations.status).toBe("unavailable");
    expect(features.heat_monitoring.status).toBe("fallback");
    expect(features.heat_controls.status).toBe("unavailable");
    expect(features.science_telemetry.status).toBe("available");
    expect(features.damage_monitoring.status).toBe("available");
  });

  it("switches the editor electricity planner to its stock backend without mutating the base fixture", () => {
    const enabled = allFixtureOptionalMods();
    enabled.delete("dynamic_battery_storage");
    const configured = applyFixtureOptionalMods(editorTelemetryFixture, enabled);

    expect(configured["editor.elec.backend"]).toBe("stock");
    expect(configured["editor.elec.backendVersion"]).toBe("stock");
    expect(configured["editor.elec.components"]).toEqual(editorTelemetryFixture["editor.elec.components"]);
    expect(configured["dashboard.capabilities"]!.features.editor_electricity.status).toBe("fallback");
    expect(editorTelemetryFixture["editor.elec.backend"]).toBe("dynamic_battery_storage");
  });

  it("keeps dashboard-wide capability and alarm state coherent in the inactive scene", () => {
    const enabled = allFixtureOptionalMods();
    enabled.delete("kac");
    const configured = applyFixtureOptionalMods(inactiveTelemetryFixture, enabled);

    expect(configured["dashboard.capabilities"]!.features.science_alarms.status).toBe("fallback");
    expect(configured["overview.alarmProviders"]).toEqual({ stock: "available", kac: "unavailable" });
    expect(configured["overview.alarms"]?.map(({ source }) => source)).toEqual(["Stock"]);
    expect(configured["sci.alarmProviders"]).toEqual({ kac: false, stock: true });
  });
});
