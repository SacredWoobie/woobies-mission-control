import { describe, expect, it } from "vitest";
import type { TelemetrySnapshot } from "../telemetry/types";
import {
  createAnnunciatorState,
  DEFAULT_ANNUNCIATOR_POLICY,
  evaluateAnnunciatorSnapshot,
  type RuleEvaluationContext,
} from "./engine";
import {
  ACTIVE_FLIGHT_ANNUNCIATOR_RULES,
  COMMS_LINK_RULE,
  ELECTRIC_CHARGE_RULE,
  FLIGHT_ANNUNCIATOR_CONDITION_TABLE,
  PART_DAMAGE_RULE,
  REACTOR_INTEGRITY_RULE,
  REACTOR_TEMPERATURE_RULE,
  SYSTEM_HEAT_RULE,
} from "./rules";

const clearContext: RuleEvaluationContext = { previousState: () => "clear" };
const activeContext: RuleEvaluationContext = { previousState: () => "active" };

function evaluate(
  rule: typeof SYSTEM_HEAT_RULE,
  snapshot: Partial<TelemetrySnapshot>,
  context = clearContext,
) {
  return rule.evaluate({ "context.mode": "flight", ...snapshot }, context);
}

describe("Flight annunciator rule catalog", () => {
  it("registers only conditions with explicit identity and completeness contracts", () => {
    const activeContracts = FLIGHT_ANNUNCIATOR_CONDITION_TABLE.filter((entry) => entry.registration === "active");
    const blockedContracts = FLIGHT_ANNUNCIATOR_CONDITION_TABLE.filter((entry) => entry.registration === "blocked");

    expect(activeContracts.map((entry) => entry.ruleId)).toEqual(
      ACTIVE_FLIGHT_ANNUNCIATOR_RULES.map((rule) => rule.ruleId),
    );
    expect(blockedContracts.map((entry) => entry.ruleId)).toEqual([
      "stock-part-heat",
      "propellant-low",
      "reactor-offline",
      "science-lab-attention",
    ]);
    expect(blockedContracts.every((entry) => Boolean(entry.blocker))).toBe(true);
  });

  it("evaluates System Heat severity with trip/reset hysteresis and source integrity", () => {
    const base = {
      "heat.backend": "system_heat" as const,
      "heat.systemHeatStatus": "known" as const,
    };
    expect(evaluate(SYSTEM_HEAT_RULE, { "heat.systemHeatStatus": "unknown" })).toEqual({ kind: "source-unknown" });
    expect(evaluate(SYSTEM_HEAT_RULE, { "heat.systemHeatStatus": "not_applicable" })).toEqual({ kind: "not-applicable" });
    expect(evaluate(SYSTEM_HEAT_RULE, { ...base, "heat.loops": undefined })).toEqual({ kind: "source-unknown" });

    const caution = evaluate(SYSTEM_HEAT_RULE, {
      ...base,
      "heat.loops": [{ id: "1", tempK: 480, nominalTempK: 800, netKw: 10 }],
    });
    const neutralFromClear = evaluate(SYSTEM_HEAT_RULE, {
      ...base,
      "heat.loops": [{ id: "1", tempK: 464, nominalTempK: 800, netKw: 10 }],
    });
    const neutralFromActive = evaluate(SYSTEM_HEAT_RULE, {
      ...base,
      "heat.loops": [{ id: "1", tempK: 464, nominalTempK: 800, netKw: 10 }],
    }, activeContext);
    const warning = evaluate(SYSTEM_HEAT_RULE, {
      ...base,
      "heat.loops": [{ id: "1", tempK: 730, nominalTempK: 800, netKw: 10 }],
    });

    expect(caution).toMatchObject({ kind: "known", observations: [{ instanceId: "loop-1", state: "active", tier: "caution" }] });
    expect(neutralFromClear).toMatchObject({ kind: "known", observations: [{ state: "clear" }] });
    expect(neutralFromActive).toMatchObject({ kind: "known", observations: [{ state: "active" }] });
    expect(warning).toMatchObject({ kind: "known", observations: [{ state: "active", tier: "warning" }] });
  });

  it("treats no-radiator heat generation and short time-to-critical as warnings", () => {
    const base = {
      "heat.backend": "system_heat" as const,
      "heat.systemHeatStatus": "known" as const,
    };
    const result = evaluate(SYSTEM_HEAT_RULE, {
      ...base,
      "heat.loops": [
        { id: "2", tempK: 300, nominalTempK: 1_000, genKw: 20, hasRadiators: false },
        { id: "3", tempK: 500, nominalTempK: 1_000, netKw: 5, timeToCriticalSeconds: 299 },
      ],
    });
    expect(result).toMatchObject({
      kind: "known",
      observations: [
        { instanceId: "loop-2", tier: "warning" },
        { instanceId: "loop-3", tier: "warning" },
      ],
    });
  });

  it("requires persistent reactor part IDs and applies temperature/integrity hysteresis", () => {
    const base = {
      "elec.reactorsStatus": "known" as const,
      "elec.reactors": [
        { partId: 101, name: "Reactor A", on: true, coreTemp: 901, nominalTemp: 850, integrity: 89, hasIntegrity: true },
        { name: "Legacy reactor", on: true, coreTemp: 900, nominalTemp: 850, integrity: 80, hasIntegrity: true },
        { partId: 303, name: "Fusion reactor", family: "fusion" as const, on: true, coreTemp: 1_600, nominalTemp: 1_600, hasIntegrity: false },
      ],
    };
    const temperature = evaluate(REACTOR_TEMPERATURE_RULE, base);
    const integrity = evaluate(REACTOR_INTEGRITY_RULE, base);

    expect(temperature).toMatchObject({
      kind: "known",
      complete: true,
      observations: [
        { instanceId: "part-101", state: "active", tier: "warning" },
        { instanceId: "unidentified-1", state: "unknown" },
        { instanceId: "part-303", state: "clear" },
      ],
    });
    expect(integrity).toMatchObject({
      kind: "known",
      observations: [
        { instanceId: "part-101", state: "active" },
        { instanceId: "unidentified-1", state: "unknown" },
      ],
    });

    const neutral = evaluate(REACTOR_TEMPERATURE_RULE, {
      "elec.reactorsStatus": "known",
      "elec.reactors": [{ partId: 101, name: "Reactor A", on: true, coreTemp: 870, nominalTemp: 850 }],
    }, activeContext);
    expect(neutral).toMatchObject({ kind: "known", observations: [{ state: "active" }] });
  });

  it("uses vessel ElectricCharge bands and holds the neutral hysteresis band", () => {
    const at = (current: number, context = clearContext) => evaluate(ELECTRIC_CHARGE_RULE, {
      "res.status": "known",
      "res.names": ["ElectricCharge"],
      "r.resource[ElectricCharge]": current,
      "r.resourceMax[ElectricCharge]": 100,
    }, context);

    expect(at(40)).toMatchObject({ kind: "known", observations: [{ state: "active", tier: "caution" }] });
    expect(at(15)).toMatchObject({ kind: "known", observations: [{ state: "active", tier: "warning" }] });
    expect(at(43)).toMatchObject({ kind: "known", observations: [{ state: "clear" }] });
    expect(at(43, activeContext)).toMatchObject({ kind: "known", observations: [{ state: "active" }] });
    expect(at(45, activeContext)).toMatchObject({ kind: "known", observations: [{ state: "clear" }] });
    expect(evaluate(ELECTRIC_CHARGE_RULE, { "res.status": "incomplete" })).toEqual({ kind: "source-unknown" });
  });

  it("feeds prior decisive state back into rules without closure state", () => {
    const snapshotAt = (charge: number): TelemetrySnapshot => ({
      "context.mode": "flight",
      "res.status": "known",
      "res.names": ["ElectricCharge"],
      "r.resource[ElectricCharge]": charge,
      "r.resourceMax[ElectricCharge]": 100,
    });
    const immediateClear = { ...DEFAULT_ANNUNCIATOR_POLICY, clearDwellMs: 0 };
    let state = evaluateAnnunciatorSnapshot(
      createAnnunciatorState(),
      [ELECTRIC_CHARGE_RULE],
      snapshotAt(40),
      { nowMs: 0, vesselIdentity: "vessel-a" },
      immediateClear,
    );
    state = evaluateAnnunciatorSnapshot(
      state,
      [ELECTRIC_CHARGE_RULE],
      snapshotAt(43),
      { nowMs: 100, vesselIdentity: "vessel-a" },
      immediateClear,
    );
    expect(state.episodes[0].clearedAtMs).toBeNull();
    state = evaluateAnnunciatorSnapshot(
      state,
      [ELECTRIC_CHARGE_RULE],
      snapshotAt(45),
      { nowMs: 200, vesselIdentity: "vessel-a" },
      immediateClear,
    );
    expect(state.episodes[0].clearedAtMs).toBe(200);
  });

  it("keeps RemoteTech authoritative and falls back to stock CommNet", () => {
    expect(evaluate(COMMS_LINK_RULE, {
      "rt.available": true,
      "rt.hasConnection": false,
      "comm.krpc.canCommunicate": true,
    })).toMatchObject({ kind: "known", observations: [{ state: "active" }] });
    expect(evaluate(COMMS_LINK_RULE, {
      "rt.available": false,
      "comm.krpc.canCommunicate": true,
    })).toMatchObject({ kind: "known", observations: [{ state: "clear" }] });
    expect(evaluate(COMMS_LINK_RULE, { "rt.available": true })).toEqual({ kind: "source-unknown" });
    expect(evaluate(COMMS_LINK_RULE, {})).toEqual({ kind: "source-unknown" });
  });

  it("raises immediate grouped damage warnings only from complete authoritative scans", () => {
    expect(evaluate(PART_DAMAGE_RULE, { "damage.status": "unknown" })).toEqual({ kind: "source-unknown" });
    expect(evaluate(PART_DAMAGE_RULE, { "damage.status": "incomplete", "damage.parts": [] })).toEqual({ kind: "source-unknown" });
    expect(evaluate(PART_DAMAGE_RULE, { "damage.status": "known", "damage.parts": [] })).toEqual({
      kind: "known",
      complete: true,
      observations: [],
    });
    expect(evaluate(PART_DAMAGE_RULE, {
      "damage.status": "known",
      "damage.parts": [null] as never,
    })).toMatchObject({
      kind: "known",
      complete: true,
      observations: [{ state: "unknown" }],
    });
    expect(evaluate(PART_DAMAGE_RULE, {
      "damage.status": "known",
      "damage.parts": [
        { kind: "radiator", name: "Large Folding Radiator", tag: "Port loop", count: 2 },
        { kind: "solar_panel", name: "OX-4L", count: 1 },
      ],
    })).toMatchObject({
      kind: "known",
      complete: true,
      observations: [
        { state: "active", tier: "warning", message: "2 damaged radiators: Large Folding Radiator (Port loop)." },
        { state: "active", tier: "warning", message: "1 damaged solar panel: OX-4L." },
      ],
    });
  });
});
