import type { EditorElectricityComponentTelemetry, TelemetrySnapshot } from "../telemetry/types";
import { defaultElectricityScenario, type ElectricityScenario } from "./model";

export type ElectricityPlannerRoleInclusion = "all" | "none";

export interface ElectricityPlannerSession {
  craftKey?: string;
  includedByStableId: Record<string, boolean>;
  scenario: ElectricityScenario;
}

export function plannerCraftKey(snapshot: TelemetrySnapshot): string | undefined {
  const save = snapshot["editor.elec.saveFolder"]?.trim() || snapshot["game.saveFolder"]?.trim();
  const craft = snapshot["editor.elec.craftPersistentId"] ?? snapshot["editor.craftPersistentId"];
  const root = snapshot["editor.elec.rootPartPersistentId"] ?? snapshot["editor.rootPartPersistentId"];
  const identity = craft?.trim() || root?.trim();
  return save && identity ? `${save}:${identity}` : undefined;
}

function defaults(components: readonly EditorElectricityComponentTelemetry[]) {
  return Object.fromEntries(components.map((component) => [component.stableId, component.defaultIncluded]));
}

/** Revisions reconcile by stable component ID; a different craft identity starts a new in-memory session. */
export function reconcileElectricityPlannerSession(
  previous: ElectricityPlannerSession | undefined,
  snapshot: TelemetrySnapshot,
): ElectricityPlannerSession {
  const components = snapshot["editor.elec.components"] ?? [];
  const craftKey = plannerCraftKey(snapshot);
  if (!previous || previous.craftKey !== craftKey) {
    return { craftKey, includedByStableId: defaults(components), scenario: defaultElectricityScenario(snapshot) };
  }
  const current = previous.includedByStableId;
  return {
    ...previous,
    includedByStableId: Object.fromEntries(components.map((component) => [
      component.stableId,
      current[component.stableId] ?? component.defaultIncluded,
    ])),
  };
}

/**
 * Changes only the selected role's current stable IDs. This deliberately leaves
 * the opposite role and scenario untouched so the two ledger controls compose.
 */
export function applyElectricityPlannerRoleInclusion(
  state: ElectricityPlannerSession,
  components: readonly EditorElectricityComponentTelemetry[],
  role: "producer" | "consumer",
  inclusion: ElectricityPlannerRoleInclusion,
): ElectricityPlannerSession {
  const includedByStableId = { ...state.includedByStableId };
  for (const component of components) {
    if (component.role === role) includedByStableId[component.stableId] = inclusion === "all";
  }
  return { ...state, includedByStableId };
}
