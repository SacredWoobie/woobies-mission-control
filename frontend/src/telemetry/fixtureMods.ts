import type {
  DashboardCapabilityEvidence,
  DashboardFeatureCapability,
  DashboardFeatureId,
  TelemetrySnapshot,
} from "./types";

export type FixtureOptionalModId =
  | "notes"
  | "kac"
  | "remote_tech"
  | "mechjeb"
  | "system_heat"
  | "dynamic_battery_storage";

export const FIXTURE_OPTIONAL_MODS: readonly {
  id: FixtureOptionalModId;
  label: string;
}[] = [
  { id: "notes", label: "Notes" },
  { id: "kac", label: "Kerbal Alarm Clock" },
  { id: "remote_tech", label: "RemoteTech" },
  { id: "mechjeb", label: "MechJeb" },
  { id: "system_heat", label: "System Heat" },
  { id: "dynamic_battery_storage", label: "Dynamic Battery Storage" },
];

export function allFixtureOptionalMods(): Set<FixtureOptionalModId> {
  return new Set(FIXTURE_OPTIONAL_MODS.map(({ id }) => id));
}

function evidence(
  id: string,
  status: DashboardCapabilityEvidence["status"],
  source: DashboardCapabilityEvidence["source"],
  version?: string,
): DashboardCapabilityEvidence {
  return version ? { id, status, source, version } : { id, status, source };
}

function capability(
  status: DashboardFeatureCapability["status"],
  reason: DashboardFeatureCapability["reason"],
  entries: DashboardCapabilityEvidence[],
): DashboardFeatureCapability {
  return { status, reason, evidence: entries };
}

function notesUnavailable(snapshot: TelemetrySnapshot): TelemetrySnapshot {
  return {
    ...snapshot,
    "notes.available": false,
    "notes.activeFound": false,
    "notes.message": "Notes is disabled in the development fixture.",
    "notes.active": null,
    "notes.selected": null,
    "notes.selectedPath": "",
    "notes.selectionMode": "active",
    "notes.pinned": null,
    "notes.pinnedPath": "",
    "notes.catalog": [],
    "notes.catalogTruncated": false,
  };
}

function kacUnavailable(snapshot: TelemetrySnapshot): TelemetrySnapshot {
  return {
    ...snapshot,
    "sci.alarmProviders": { kac: false, stock: true },
    "overview.alarmProviders": { stock: "available", kac: "unavailable" },
    "overview.alarms": (snapshot["overview.alarms"] ?? []).filter((alarm) => alarm.source?.toLowerCase() !== "kac"),
  };
}

function remoteTechUnavailable(snapshot: TelemetrySnapshot): TelemetrySnapshot {
  return {
    ...snapshot,
    "rt.available": false,
    "rt.hasConnection": undefined,
    "rt.signalDelay": undefined,
  };
}

function mechJebUnavailable(snapshot: TelemetrySnapshot): TelemetrySnapshot {
  const staging = snapshot["context.mode"] === "inactive" ? {} : {
    "stage.available": false,
    "stage.complete": false,
    "stage.pending": false,
    "stage.count": 0,
    "stage.unpoweredCount": 0,
    "stage.totalBurnSeconds": 0,
    "stage.stages": [],
    "stage.totalDvAtmo": undefined,
    "stage.totalDvVac": undefined,
  };
  return {
    ...snapshot,
    ...staging,
    "mj.sasActive": undefined,
    "mj.sasMode": undefined,
    "mj.transfer.available": false,
    "mj.transfer.compatibilityReady": false,
    "mj.transfer.windows.requestId": undefined,
    "mj.transfer.windows.state": "idle",
    "mj.transfer.windows.completedCount": 0,
    "mj.transfer.windows.totalCount": 0,
    "mj.transfer.windows.progress": 0,
    "mj.transfer.windows.refreshedAtUT": undefined,
    "mj.transfer.windows.results": [],
  };
}

function systemHeatUnavailable(snapshot: TelemetrySnapshot): TelemetrySnapshot {
  return {
    ...snapshot,
    "heat.backend": "stock",
    "heat.systemHeatStatus": "not_applicable",
    "heat.generatedKw": undefined,
    "heat.removedKw": undefined,
    "heat.netKw": undefined,
    "heat.generatedW": 125.4,
    "heat.removedW": 22,
    "heat.netW": 103.4,
    "heat.loops": [],
    "heat.parts": [
      { name: "Advanced Nose Cone", tempK: 620, maxTempK: 2_400, skinTempK: 920, maxSkinTempK: 1_000, utilization: 92, netW: 125.4 },
      { name: "Liquid Fuel Tank", tempK: 327, maxTempK: 2_000, utilization: 16, netW: -22 },
    ],
    "elec.reactors": [],
    "elec.reactorsStatus": "not_applicable",
    "elec.totalGenEcPerSec": 11,
    "elec.otherEcPerSec": 1.2,
    "elec.netEcPerSec": -31.4,
  };
}

function dynamicBatteryStorageUnavailable(snapshot: TelemetrySnapshot): TelemetrySnapshot {
  if (snapshot["context.mode"] !== "editor") return snapshot;
  return {
    ...snapshot,
    "editor.elec.backend": "stock",
    "editor.elec.backendVersion": "stock",
    "editor.elec.degradedReason": undefined,
  };
}

export function applyFixtureOptionalMods(
  base: TelemetrySnapshot,
  enabled: ReadonlySet<FixtureOptionalModId>,
): TelemetrySnapshot {
  const sourceCapabilities = base["dashboard.capabilities"];
  const features = sourceCapabilities ? { ...sourceCapabilities.features } : undefined;
  let snapshot = { ...base };

  const setFeature = (id: DashboardFeatureId, value: DashboardFeatureCapability) => {
    if (features) features[id] = value;
  };

  if (!enabled.has("notes")) {
    snapshot = notesUnavailable(snapshot);
    setFeature("notes", capability("unavailable", "dependency_missing", [
      evidence("notes", "unavailable", "runtime"),
      evidence("notes", "missing", "root_scan"),
    ]));
  }

  if (!enabled.has("kac")) {
    snapshot = kacUnavailable(snapshot);
    setFeature("science_alarms", capability("fallback", "fallback_active", [
      evidence("kac", "unavailable", "runtime"),
      evidence("stock", "active", "runtime"),
      evidence("kac", "missing", "root_scan"),
    ]));
  }

  if (!enabled.has("remote_tech")) {
    snapshot = remoteTechUnavailable(snapshot);
    setFeature("communications", capability("fallback", "fallback_active", [
      evidence("stock_commnet", "active", "runtime"),
      evidence("remote_tech", "missing", "root_scan"),
    ]));
  }

  if (!enabled.has("mechjeb")) {
    snapshot = mechJebUnavailable(snapshot);
    setFeature("stage_analysis", capability("unavailable", "dependency_missing", [
      evidence("stage_stats", "unavailable", "runtime"),
      evidence("stage_stats", "detected", "root_scan"),
      evidence("mechjeb", "missing", "root_scan"),
    ]));
    setFeature("live_transfer_calculations", capability("unavailable", "dependency_missing", [
      evidence("woobies_mechjeb", "unavailable", "runtime"),
      evidence("woobies_mechjeb", "detected", "root_scan"),
      evidence("mechjeb", "missing", "root_scan"),
    ]));
  }

  if (!enabled.has("system_heat")) {
    snapshot = systemHeatUnavailable(snapshot);
    setFeature("heat_monitoring", capability("fallback", "fallback_active", [
      evidence("stock_thermal", "active", "runtime"),
      evidence("system_heat_service", "detected", "root_scan"),
      evidence("system_heat_mod", "missing", "root_scan"),
    ]));
    setFeature("heat_controls", capability("unavailable", "dependency_missing", [
      evidence("stock_thermal", "active", "runtime"),
      evidence("system_heat_service", "detected", "root_scan"),
      evidence("system_heat_mod", "missing", "root_scan"),
    ]));
  }

  if (!enabled.has("dynamic_battery_storage")) {
    snapshot = dynamicBatteryStorageUnavailable(snapshot);
    setFeature("editor_electricity", capability("fallback", "fallback_active", [
      evidence("stock_electricity", "active", "runtime"),
      evidence("dynamic_battery_storage", "missing", "root_scan"),
    ]));
  }

  return sourceCapabilities && features
    ? { ...snapshot, "dashboard.capabilities": { ...sourceCapabilities, features } }
    : snapshot;
}
