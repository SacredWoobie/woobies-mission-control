import { describe, expect, it } from "vitest";
import type { TelemetrySnapshot } from "../telemetry/types";
import {
  acknowledgeAnnunciator,
  acknowledgeAnnunciatorSubsystem,
  createAnnunciatorState,
  evaluateAnnunciatorSnapshot,
  reconcileAnnunciatorLifecycle,
  summarizeAnnunciator,
  tickAnnunciatorWatchdog,
  type AnnunciatorPolicy,
  type AnnunciatorRule,
  type RuleEvaluation,
} from "./engine";

const snapshot: TelemetrySnapshot = { "context.mode": "flight" };
const policy: AnnunciatorPolicy = {
  activationDwellMs: 100,
  clearDwellMs: 200,
  unknownDwellMs: 300,
  feedStaleDwellMs: 400,
  initialConnectGraceMs: 500,
  missionTimeResetSeconds: 5,
  clearedRetention: 200,
};

function rule(evaluate: () => RuleEvaluation, overrides: Partial<AnnunciatorRule> = {}): AnnunciatorRule {
  return {
    ruleId: "reactor-temperature",
    sourceId: "systemheat",
    subsystem: "REACTOR",
    defaultTier: "caution",
    evaluate,
    ...overrides,
  };
}

function evaluateAt(
  state: ReturnType<typeof createAnnunciatorState>,
  rules: AnnunciatorRule[],
  nowMs: number,
  missionTime = nowMs / 1_000,
) {
  return evaluateAnnunciatorSnapshot(state, rules, snapshot, {
    nowMs,
    missionTime,
    vesselIdentity: "vessel-a",
  }, policy);
}

describe("annunciator episode engine", () => {
  it("turns a sub-dwell activation into a seen diagnostic blip", () => {
    let evaluation: RuleEvaluation = {
      kind: "known",
      complete: true,
      observations: [{ instanceId: "part-1", state: "active", message: "Reactor temperature high." }],
    };
    const rules = [rule(() => evaluation)];
    let state = evaluateAt(createAnnunciatorState(), rules, 0);
    expect(state.episodes).toEqual([]);

    evaluation = {
      kind: "known",
      complete: true,
      observations: [{ instanceId: "part-1", state: "clear" }],
    };
    state = evaluateAt(state, rules, 50);

    expect(state.episodes).toMatchObject([{
      seen: true,
      isBlip: true,
      onsetAtMs: 0,
      clearedAtMs: 50,
    }]);
    expect(summarizeAnnunciator(state)).toMatchObject({ lamp: "dark", tokens: [] });
  });

  it("opens after activation dwell, clears after the longer clear dwell, and latches unseen", () => {
    let stateName: "active" | "clear" = "active";
    const rules = [rule(() => ({
      kind: "known",
      complete: true,
      observations: [{ instanceId: "part-1", state: stateName, message: "Reactor temperature high." }],
    }))];
    let state = evaluateAt(createAnnunciatorState(), rules, 0);
    state = evaluateAt(state, rules, 100);
    expect(summarizeAnnunciator(state)).toMatchObject({ lamp: "unacknowledged", tier: "caution", tokens: ["REACTOR"] });

    stateName = "clear";
    state = evaluateAt(state, rules, 150);
    state = evaluateAt(state, rules, 349);
    expect(state.episodes[0].clearedAtMs).toBeNull();
    state = evaluateAt(state, rules, 350);
    expect(state.episodes[0].clearedAtMs).toBe(350);
    expect(summarizeAnnunciator(state).lamp).toBe("unacknowledged");

    state = acknowledgeAnnunciator(state);
    expect(summarizeAnnunciator(state)).toMatchObject({ lamp: "dark", tokens: [] });
  });

  it("latches opted-in sub-dwell events and makes escalation unseen again", () => {
    let tier: "caution" | "warning" = "caution";
    const rules = [rule(() => ({
      kind: "known",
      complete: true,
      observations: [{ instanceId: "part-1", state: "active", tier }],
    }), { latchSubDwell: true })];
    let state = evaluateAt(createAnnunciatorState(), rules, 0);
    expect(state.episodes[0]).toMatchObject({ isBlip: false, seen: false, tier: "caution" });
    state = acknowledgeAnnunciator(state);
    expect(summarizeAnnunciator(state).lamp).toBe("dark");

    tier = "warning";
    state = evaluateAt(state, rules, 10);
    expect(state.episodes[0]).toMatchObject({ seen: false, tier: "warning" });
    expect(summarizeAnnunciator(state)).toMatchObject({ lamp: "unacknowledged", tier: "warning" });
  });

  it("keeps an acknowledged condition quiet until it clears and recurs", () => {
    let stateName: "active" | "clear" = "active";
    const rules = [rule(() => ({
      kind: "known",
      complete: true,
      observations: [{ instanceId: "active-vessel", state: stateName }],
    }), { activationDwellMs: 0, ruleId: "comms-link-lost", sourceId: "comms", subsystem: "COMMS" })];
    let state = evaluateAt(createAnnunciatorState(), rules, 0);
    state = acknowledgeAnnunciatorSubsystem(state, "COMMS");
    state = evaluateAt(state, rules, 50);
    expect(summarizeAnnunciator(state).lamp).toBe("dark");

    stateName = "clear";
    state = evaluateAt(state, rules, 100);
    state = evaluateAt(state, rules, 300);
    stateName = "active";
    state = evaluateAt(state, rules, 301);
    expect(state.episodes).toHaveLength(2);
    expect(state.episodes[1]).toMatchObject({ seen: false, subsystem: "COMMS" });
    expect(summarizeAnnunciator(state)).toMatchObject({ lamp: "unacknowledged", tokens: ["COMMS"] });
  });

  it("holds omitted instances in incomplete frames and opens one source-integrity caution", () => {
    let evaluation: RuleEvaluation = {
      kind: "known",
      complete: true,
      observations: [
        { instanceId: "part-1", state: "active" },
        { instanceId: "part-2", state: "clear" },
      ],
    };
    const rules = [rule(() => evaluation, { latchSubDwell: true })];
    let state = evaluateAt(createAnnunciatorState(), rules, 0);
    evaluation = { kind: "known", complete: false, observations: [] };
    state = evaluateAt(state, rules, 100);
    state = evaluateAt(state, rules, 399);
    expect(state.episodes).toHaveLength(1);
    state = evaluateAt(state, rules, 400);

    expect(state.episodes).toHaveLength(2);
    expect(state.episodes[1]).toMatchObject({
      ruleId: "source-integrity",
      instanceId: "systemheat",
      subsystem: "SYSTEMHEAT FEED",
      tier: "caution",
    });
    expect(state.episodes[0].clearedAtMs).toBeNull();
  });

  it("raises source integrity without a prior instance and pauses condition dwell while unknown", () => {
    let evaluation: RuleEvaluation = {
      kind: "known",
      complete: true,
      observations: [{ instanceId: "part-1", state: "active" }],
    };
    const rules = [rule(() => evaluation)];
    let state = evaluateAt(createAnnunciatorState(), rules, 0);
    evaluation = { kind: "source-unknown" };
    state = evaluateAt(state, rules, 50);
    state = evaluateAt(state, rules, 350);
    expect(state.episodes).toMatchObject([{
      ruleId: "source-integrity",
      instanceId: "systemheat",
    }]);

    evaluation = {
      kind: "known",
      complete: true,
      observations: [{ instanceId: "part-1", state: "active" }],
    };
    state = evaluateAt(state, rules, 400);
    expect(state.episodes.some((episode) => episode.ruleId === "reactor-temperature")).toBe(false);
    state = evaluateAt(state, rules, 450);
    expect(state.episodes.some((episode) => episode.ruleId === "reactor-temperature")).toBe(true);

    evaluation = { kind: "source-unknown" };
    state = evaluateAt(createAnnunciatorState(), rules, 0);
    state = evaluateAt(state, rules, 300);
    expect(state.episodes[0]).toMatchObject({
      ruleId: "source-integrity",
      subsystem: "SYSTEMHEAT FEED",
    });
    expect(summarizeAnnunciator(state)).toMatchObject({ lamp: "dark", tokens: [] });
  });

  it("clears a physically missing instance only from a complete authoritative frame", () => {
    let evaluation: RuleEvaluation = {
      kind: "known",
      complete: true,
      observations: [{ instanceId: "part-1", state: "active" }],
    };
    const rules = [rule(() => evaluation, { latchSubDwell: true })];
    let state = evaluateAt(createAnnunciatorState(), rules, 0);
    evaluation = { kind: "known", complete: false, observations: [] };
    state = evaluateAt(state, rules, 500);
    expect(state.episodes[0].clearedAtMs).toBeNull();

    evaluation = { kind: "known", complete: true, observations: [] };
    state = evaluateAt(state, rules, 600);
    state = evaluateAt(state, rules, 800);
    expect(state.episodes[0].clearedAtMs).toBe(800);
  });

  it("deduplicates new-condition tokens and lets one subsystem acknowledge independently", () => {
    const rules = [
      rule(() => ({
        kind: "known",
        complete: true,
        observations: [
          { instanceId: "reactor-1", state: "active", tier: "caution" },
          { instanceId: "reactor-2", state: "active", tier: "warning" },
        ],
      }), { activationDwellMs: 0 }),
      rule(() => ({
        kind: "known",
        complete: true,
        observations: [{ instanceId: "loop-1", state: "active" }],
      }), {
        ruleId: "heat-loop",
        subsystem: "HEAT",
        activationDwellMs: 0,
      }),
    ];
    let state = evaluateAt(createAnnunciatorState(), rules, 0);
    expect(summarizeAnnunciator(state)).toMatchObject({
      lamp: "unacknowledged",
      tier: "warning",
      tokens: ["REACTOR", "HEAT"],
    });
    state = acknowledgeAnnunciatorSubsystem(state, "REACTOR");
    expect(summarizeAnnunciator(state)).toMatchObject({ lamp: "unacknowledged", tokens: ["HEAT"] });
    expect(state.episodes.filter((episode) => episode.subsystem === "REACTOR").every((episode) => episode.seen)).toBe(true);
    expect(state.episodes.find((episode) => episode.subsystem === "HEAT")?.seen).toBe(false);
    state = acknowledgeAnnunciatorSubsystem(state, "HEAT");
    expect(summarizeAnnunciator(state)).toMatchObject({ lamp: "dark", tokens: [] });
  });

  it("retains all active episodes and only the newest cleared history", () => {
    const shortPolicy = { ...policy, activationDwellMs: 0, clearDwellMs: 0, clearedRetention: 2 };
    let evaluation: RuleEvaluation = { kind: "known", complete: true, observations: [] };
    const rules = [rule(() => evaluation)];
    let state = createAnnunciatorState();
    for (let index = 0; index < 4; index += 1) {
      evaluation = { kind: "known", complete: true, observations: [{ instanceId: `part-${index}`, state: "active" }] };
      state = evaluateAnnunciatorSnapshot(state, rules, snapshot, { nowMs: index * 10, vesselIdentity: "vessel-a" }, shortPolicy);
      evaluation = { kind: "known", complete: true, observations: [] };
      state = evaluateAnnunciatorSnapshot(state, rules, snapshot, { nowMs: index * 10 + 1, vesselIdentity: "vessel-a" }, shortPolicy);
    }
    expect(state.episodes.map((episode) => episode.instanceId)).toEqual(["part-2", "part-3"]);
  });
});

describe("annunciator lifecycle and watchdog", () => {
  it("uses an initial grace period, raises on a stale feed, and clears on resume", () => {
    let state = createAnnunciatorState();
    state = tickAnnunciatorWatchdog(state, { nowMs: 0, connectionState: "connecting", flightActive: true }, policy);
    state = tickAnnunciatorWatchdog(state, { nowMs: 499, connectionState: "connecting", flightActive: true }, policy);
    expect(state.episodes).toEqual([]);
    state = tickAnnunciatorWatchdog(state, { nowMs: 500, connectionState: "connecting", flightActive: true }, policy);
    expect(summarizeAnnunciator(state)).toMatchObject({
      active: [expect.objectContaining({ subsystem: "DATALINK" })],
      lamp: "dark",
      tokens: [],
    });

    state = evaluateAt(state, [], 550);
    state = tickAnnunciatorWatchdog(state, { nowMs: 550, connectionState: "linked", flightActive: true }, policy);
    expect(state.episodes[0].clearedAtMs).toBe(550);
  });

  it("raises from the monotonic timer while retrying after snapshots stop", () => {
    let state = evaluateAt(createAnnunciatorState(), [], 100);
    state = tickAnnunciatorWatchdog(state, { nowMs: 499, connectionState: "retrying", flightActive: true }, policy);
    expect(state.episodes).toEqual([]);
    state = tickAnnunciatorWatchdog(state, { nowMs: 500, connectionState: "retrying", flightActive: true }, policy);
    expect(state.episodes[0]).toMatchObject({ ruleId: "feed-integrity", clearedAtMs: null });
  });

  it("does not annunciate a deliberate disconnect and resets on Flight exit", () => {
    let state = tickAnnunciatorWatchdog(createAnnunciatorState(), {
      nowMs: 0,
      connectionState: "connecting",
      flightActive: true,
    }, policy);
    state = tickAnnunciatorWatchdog(state, {
      nowMs: 500,
      connectionState: "connecting",
      flightActive: true,
    }, policy);
    state = tickAnnunciatorWatchdog(state, {
      nowMs: 501,
      connectionState: "offline",
      flightActive: true,
    }, policy);
    expect(summarizeAnnunciator(state)).toMatchObject({ lamp: "dark", tokens: [] });
    state = tickAnnunciatorWatchdog(state, {
      nowMs: 600,
      connectionState: "offline",
      flightActive: false,
    }, policy);
    expect(state).toEqual(createAnnunciatorState());
  });

  it("resets on confirmed vessel change and a meaningful backward mission-time jump", () => {
    const activeRule = rule(() => ({
      kind: "known",
      complete: true,
      observations: [{ instanceId: "part-1", state: "active" }],
    }), { activationDwellMs: 0 });
    let state = evaluateAt(createAnnunciatorState(), [activeRule], 0, 100);
    state = reconcileAnnunciatorLifecycle(state, {
      flightActive: true,
      vesselIdentity: "vessel-b",
      missionTime: 101,
    }, policy);
    expect(state.episodes).toEqual([]);

    state = evaluateAt(createAnnunciatorState(), [activeRule], 0, 100);
    state = reconcileAnnunciatorLifecycle(state, {
      flightActive: true,
      vesselIdentity: "vessel-a",
      missionTime: 94,
    }, policy);
    expect(state.episodes).toEqual([]);
  });

  it("applies a rule lifecycle grace only to a fresh Flight or vessel lifecycle", () => {
    const commsRule = rule(() => ({
      kind: "known",
      complete: true,
      observations: [{ instanceId: "active-vessel", state: "active", message: "No connection." }],
    }), {
      activationDwellMs: 100,
      lifecycleGraceMs: 500,
      ruleId: "comms-link-lost",
      sourceId: "comms",
      subsystem: "COMMS",
    });
    let state = evaluateAnnunciatorSnapshot(
      createAnnunciatorState(),
      [commsRule],
      snapshot,
      { nowMs: 0, vesselIdentity: "vessel-a" },
      policy,
    );
    state = evaluateAnnunciatorSnapshot(state, [commsRule], snapshot, {
      nowMs: 499,
      vesselIdentity: "vessel-a",
    }, policy);
    expect(state.episodes).toEqual([]);

    state = evaluateAnnunciatorSnapshot(state, [commsRule], snapshot, {
      nowMs: 500,
      vesselIdentity: "vessel-a",
    }, policy);
    state = evaluateAnnunciatorSnapshot(state, [commsRule], snapshot, {
      nowMs: 599,
      vesselIdentity: "vessel-a",
    }, policy);
    expect(state.episodes).toEqual([]);
    state = evaluateAnnunciatorSnapshot(state, [commsRule], snapshot, {
      nowMs: 600,
      vesselIdentity: "vessel-a",
    }, policy);
    expect(state.episodes).toHaveLength(1);

    state = evaluateAnnunciatorSnapshot(state, [commsRule], snapshot, {
      nowMs: 700,
      vesselIdentity: "vessel-b",
    }, policy);
    state = evaluateAnnunciatorSnapshot(state, [commsRule], snapshot, {
      nowMs: 1_199,
      vesselIdentity: "vessel-b",
    }, policy);
    expect(state.episodes).toEqual([]);
    state = evaluateAnnunciatorSnapshot(state, [commsRule], snapshot, {
      nowMs: 1_200,
      vesselIdentity: "vessel-b",
    }, policy);
    state = evaluateAnnunciatorSnapshot(state, [commsRule], snapshot, {
      nowMs: 1_300,
      vesselIdentity: "vessel-b",
    }, policy);
    expect(state.episodes).toHaveLength(1);
  });

  it("retains the ordinary activation dwell after the lifecycle grace expires", () => {
    let disconnected = false;
    const commsRule = rule(() => ({
      kind: "known",
      complete: true,
      observations: [{
        instanceId: "active-vessel",
        state: disconnected ? "active" : "clear",
        message: "No connection.",
      }],
    }), {
      activationDwellMs: 100,
      lifecycleGraceMs: 500,
      ruleId: "comms-link-lost",
      sourceId: "comms",
      subsystem: "COMMS",
    });
    let state = evaluateAnnunciatorSnapshot(
      createAnnunciatorState(),
      [commsRule],
      snapshot,
      { nowMs: 0, vesselIdentity: "vessel-a" },
      policy,
    );
    state = evaluateAnnunciatorSnapshot(state, [commsRule], snapshot, {
      nowMs: 500,
      vesselIdentity: "vessel-a",
    }, policy);
    disconnected = true;
    state = evaluateAnnunciatorSnapshot(state, [commsRule], snapshot, {
      nowMs: 1_000,
      vesselIdentity: "vessel-a",
    }, policy);
    state = evaluateAnnunciatorSnapshot(state, [commsRule], snapshot, {
      nowMs: 1_099,
      vesselIdentity: "vessel-a",
    }, policy);
    expect(state.episodes).toEqual([]);
    state = evaluateAnnunciatorSnapshot(state, [commsRule], snapshot, {
      nowMs: 1_100,
      vesselIdentity: "vessel-a",
    }, policy);
    expect(state.episodes).toHaveLength(1);
  });
});
