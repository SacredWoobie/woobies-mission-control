import type { TelemetrySnapshot } from "../telemetry/types";

export type ThermalProtectionStatus = "detected" | "not-detected" | "unavailable";

export function thermalProtectionStatus(snapshot: TelemetrySnapshot | null | undefined): ThermalProtectionStatus {
  if (!snapshot) return "unavailable";
  const mode = snapshot["context.mode"];
  const names = mode === "editor" ? snapshot["editor.res.names"] : mode === "flight" ? snapshot["res.names"] : undefined;
  if (!Array.isArray(names)) return "unavailable";
  const protectedResource = names.find((name) => typeof name === "string" && /ablat|heat.?shield/i.test(name));
  if (protectedResource) {
    const maximumKey = mode === "editor" ? `editor.resMax[${protectedResource}]` : `r.resourceMax[${protectedResource}]`;
    const maximum = snapshot[maximumKey];
    if (typeof maximum === "number" && Number.isFinite(maximum) && maximum > 0) return "detected";
  }
  return "not-detected";
}
