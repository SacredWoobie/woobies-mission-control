import type { ConnectionStatus } from "../telemetry/client";
import type { TelemetrySnapshot } from "../telemetry/types";

export type AnnunciatorTier = "caution" | "warning";
export type ObservationState = "active" | "clear" | "unknown";

export interface AnnunciatorObservation {
  instanceId: string;
  state: ObservationState;
  tier?: AnnunciatorTier;
  message?: string;
}

export type RuleEvaluation =
  | { kind: "not-applicable" }
  | { kind: "source-unknown" }
  | {
    kind: "known";
    complete: boolean;
    observations: AnnunciatorObservation[];
  };

export interface AnnunciatorRule {
  ruleId: string;
  sourceId: string;
  subsystem: string;
  defaultTier: AnnunciatorTier;
  latchSubDwell?: boolean;
  activationDwellMs?: number;
  evaluate(snapshot: TelemetrySnapshot, context: RuleEvaluationContext): RuleEvaluation;
}

export interface RuleEvaluationContext {
  previousState(instanceId: string): "active" | "clear" | undefined;
}

export interface AnnunciatorPolicy {
  activationDwellMs: number;
  clearDwellMs: number;
  unknownDwellMs: number;
  feedStaleDwellMs: number;
  initialConnectGraceMs: number;
  missionTimeResetSeconds: number;
  clearedRetention: number;
}

export const DEFAULT_ANNUNCIATOR_POLICY: AnnunciatorPolicy = {
  activationDwellMs: 1_500,
  clearDwellMs: 3_000,
  unknownDwellMs: 5_000,
  feedStaleDwellMs: 5_000,
  initialConnectGraceMs: 10_000,
  missionTimeResetSeconds: 5,
  clearedRetention: 200,
};

export interface AnnunciatorEpisode {
  id: number;
  ruleId: string;
  instanceId: string;
  sourceId: string;
  subsystem: string;
  tier: AnnunciatorTier;
  message: string;
  onsetMissionTime?: number;
  clearedAtMissionTime?: number;
  onsetAtMs: number;
  clearedAtMs: number | null;
  seen: boolean;
  isBlip: boolean;
}

interface CandidateState {
  onsetAtMs: number;
  onsetMissionTime?: number;
  tier: AnnunciatorTier;
  message: string;
}

interface ConditionTrack {
  phase: "idle" | "candidate" | "active" | "clearing";
  phaseSinceMs: number;
  lastDecisiveState?: "active" | "clear";
  pausedAtMs?: number;
  candidate?: CandidateState;
  episodeId?: number;
}

interface SourceTrack {
  unknownSinceMs?: number;
}

interface FeedWatchdogState {
  startedAtMs?: number;
  lastSnapshotAtMs?: number;
}

export interface AnnunciatorState {
  sequence: number;
  vesselIdentity?: string;
  lastMissionTime?: number;
  episodes: AnnunciatorEpisode[];
  tracks: Record<string, ConditionTrack>;
  sources: Record<string, SourceTrack>;
  feed: FeedWatchdogState;
}

export interface AnnunciatorSummary {
  lamp: "dark" | "unacknowledged";
  tier?: AnnunciatorTier;
  tokens: string[];
  active: AnnunciatorEpisode[];
  cleared: AnnunciatorEpisode[];
}

interface ConditionDefinition {
  ruleId: string;
  instanceId: string;
  sourceId: string;
  subsystem: string;
  defaultTier: AnnunciatorTier;
  activationDwellMs: number;
  clearDwellMs: number;
  latchSubDwell: boolean;
}

interface EvaluationContext {
  nowMs: number;
  missionTime?: number;
}

const FEED_RULE_ID = "feed-integrity";
const SOURCE_INTEGRITY_RULE_ID = "source-integrity";

function nonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function tierRank(tier: AnnunciatorTier) {
  return tier === "warning" ? 2 : 1;
}

function conditionKey(ruleId: string, instanceId: string) {
  return `${ruleId}\u0000${instanceId}`;
}

function cloneState(state: AnnunciatorState): AnnunciatorState {
  return {
    ...state,
    episodes: state.episodes.map((episode) => ({ ...episode })),
    tracks: Object.fromEntries(Object.entries(state.tracks).map(([key, track]) => [
      key,
      {
        ...track,
        candidate: track.candidate ? { ...track.candidate } : undefined,
      },
    ])),
    sources: Object.fromEntries(Object.entries(state.sources).map(([key, source]) => [key, { ...source }])),
    feed: { ...state.feed },
  };
}

export function createAnnunciatorState(): AnnunciatorState {
  return {
    sequence: 0,
    episodes: [],
    tracks: {},
    sources: {},
    feed: {},
  };
}

function currentEpisode(state: AnnunciatorState, track: ConditionTrack) {
  return track.episodeId === undefined
    ? undefined
    : state.episodes.find((episode) => episode.id === track.episodeId);
}

function appendEpisode(
  state: AnnunciatorState,
  definition: ConditionDefinition,
  candidate: CandidateState,
  context: EvaluationContext,
  isBlip: boolean,
) {
  state.sequence += 1;
  const episode: AnnunciatorEpisode = {
    id: state.sequence,
    ruleId: definition.ruleId,
    instanceId: definition.instanceId,
    sourceId: definition.sourceId,
    subsystem: definition.subsystem,
    tier: candidate.tier,
    message: candidate.message,
    onsetMissionTime: candidate.onsetMissionTime,
    clearedAtMissionTime: isBlip ? context.missionTime : undefined,
    onsetAtMs: candidate.onsetAtMs,
    clearedAtMs: isBlip ? context.nowMs : null,
    seen: isBlip,
    isBlip,
  };
  state.episodes.push(episode);
  return episode;
}

function pauseTrack(track: ConditionTrack, nowMs: number) {
  if (track.pausedAtMs === undefined) track.pausedAtMs = nowMs;
}

function resumeTrack(track: ConditionTrack, nowMs: number) {
  if (track.pausedAtMs === undefined) return;
  track.phaseSinceMs += Math.max(0, nowMs - track.pausedAtMs);
  track.pausedAtMs = undefined;
}

function openCandidate(
  state: AnnunciatorState,
  track: ConditionTrack,
  definition: ConditionDefinition,
  observation: AnnunciatorObservation,
  context: EvaluationContext,
) {
  const candidate: CandidateState = {
    onsetAtMs: context.nowMs,
    onsetMissionTime: context.missionTime,
    tier: observation.tier ?? definition.defaultTier,
    message: observation.message ?? definition.subsystem,
  };
  track.phase = "candidate";
  track.phaseSinceMs = context.nowMs;
  track.candidate = candidate;
  if (definition.latchSubDwell || definition.activationDwellMs === 0) {
    const episode = appendEpisode(state, definition, candidate, context, false);
    track.phase = "active";
    track.episodeId = episode.id;
  }
}

function promoteCandidate(
  state: AnnunciatorState,
  track: ConditionTrack,
  definition: ConditionDefinition,
  context: EvaluationContext,
) {
  if (!track.candidate) return;
  const episode = appendEpisode(state, definition, track.candidate, context, false);
  track.phase = "active";
  track.episodeId = episode.id;
}

function updateEpisode(
  state: AnnunciatorState,
  track: ConditionTrack,
  definition: ConditionDefinition,
  observation: AnnunciatorObservation,
) {
  const episode = currentEpisode(state, track);
  if (!episode) return;
  const nextTier = observation.tier ?? definition.defaultTier;
  if (tierRank(nextTier) > tierRank(episode.tier)) {
    episode.tier = nextTier;
    episode.seen = false;
  }
  if (observation.message) episode.message = observation.message;
}

function applyActive(
  state: AnnunciatorState,
  track: ConditionTrack,
  definition: ConditionDefinition,
  observation: AnnunciatorObservation,
  context: EvaluationContext,
) {
  resumeTrack(track, context.nowMs);
  if (track.phase === "idle") {
    openCandidate(state, track, definition, observation, context);
    return;
  }
  if (track.phase === "candidate") {
    if (track.candidate) {
      const nextTier = observation.tier ?? definition.defaultTier;
      if (tierRank(nextTier) > tierRank(track.candidate.tier)) track.candidate.tier = nextTier;
      if (observation.message) track.candidate.message = observation.message;
    }
    if (context.nowMs - track.phaseSinceMs >= definition.activationDwellMs) {
      promoteCandidate(state, track, definition, context);
    }
    return;
  }
  if (track.phase === "clearing") {
    track.phase = "active";
    track.phaseSinceMs = context.nowMs;
  }
  updateEpisode(state, track, definition, observation);
}

function applyClear(
  state: AnnunciatorState,
  track: ConditionTrack,
  definition: ConditionDefinition,
  context: EvaluationContext,
) {
  resumeTrack(track, context.nowMs);
  if (track.phase === "idle") return;
  if (track.phase === "candidate") {
    if (context.nowMs - track.phaseSinceMs < definition.activationDwellMs) {
      if (track.candidate) appendEpisode(state, definition, track.candidate, context, true);
      track.phase = "idle";
      track.phaseSinceMs = context.nowMs;
      track.candidate = undefined;
      return;
    }
    promoteCandidate(state, track, definition, context);
  }
  if (track.phase === "active") {
    if (definition.clearDwellMs === 0) {
      const episode = currentEpisode(state, track);
      if (episode) {
        episode.clearedAtMs = context.nowMs;
        episode.clearedAtMissionTime = context.missionTime;
      }
      track.phase = "idle";
      track.phaseSinceMs = context.nowMs;
      track.episodeId = undefined;
      track.candidate = undefined;
      return;
    }
    track.phase = "clearing";
    track.phaseSinceMs = context.nowMs;
    return;
  }
  if (track.phase === "clearing" && context.nowMs - track.phaseSinceMs >= definition.clearDwellMs) {
    const episode = currentEpisode(state, track);
    if (episode) {
      episode.clearedAtMs = context.nowMs;
      episode.clearedAtMissionTime = context.missionTime;
    }
    track.phase = "idle";
    track.phaseSinceMs = context.nowMs;
    track.episodeId = undefined;
    track.candidate = undefined;
  }
}

function applyObservation(
  state: AnnunciatorState,
  definition: ConditionDefinition,
  observation: AnnunciatorObservation,
  context: EvaluationContext,
) {
  const key = conditionKey(definition.ruleId, definition.instanceId);
  const track = state.tracks[key] ?? {
    phase: "idle" as const,
    phaseSinceMs: context.nowMs,
  };
  state.tracks[key] = track;
  if (observation.state === "unknown") {
    pauseTrack(track, context.nowMs);
    return;
  }
  if (observation.state === "active") {
    track.lastDecisiveState = "active";
    applyActive(state, track, definition, observation, context);
    return;
  }
  track.lastDecisiveState = "clear";
  applyClear(state, track, definition, context);
}

function integrityDefinition(sourceId: string, policy: AnnunciatorPolicy): ConditionDefinition {
  const source = sourceId.toUpperCase();
  return {
    ruleId: SOURCE_INTEGRITY_RULE_ID,
    instanceId: sourceId,
    sourceId,
    subsystem: `${source} FEED`,
    defaultTier: "caution",
    activationDwellMs: 0,
    clearDwellMs: policy.clearDwellMs,
    latchSubDwell: false,
  };
}

function sourceMessage(sourceId: string) {
  return `${sourceId.toUpperCase()} telemetry is incomplete or unavailable.`;
}

function trackedInstancesForRule(state: AnnunciatorState, ruleId: string) {
  const prefix = `${ruleId}\u0000`;
  return Object.keys(state.tracks)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
}

function pruneEpisodes(state: AnnunciatorState, retention: number) {
  const active = state.episodes.filter((episode) => episode.clearedAtMs === null);
  const cleared = state.episodes
    .filter((episode) => episode.clearedAtMs !== null)
    .sort((left, right) => (right.clearedAtMs ?? 0) - (left.clearedAtMs ?? 0))
    .slice(0, Math.max(0, retention));
  const retainedIds = new Set([...active, ...cleared].map((episode) => episode.id));
  state.episodes = state.episodes.filter((episode) => retainedIds.has(episode.id));
}

export function reconcileAnnunciatorLifecycle(
  state: AnnunciatorState,
  input: {
    flightActive: boolean;
    vesselIdentity?: string;
    missionTime?: number;
  },
  policy: AnnunciatorPolicy = DEFAULT_ANNUNCIATOR_POLICY,
) {
  if (!input.flightActive) return createAnnunciatorState();
  const vesselChanged = Boolean(
    state.vesselIdentity
    && input.vesselIdentity
    && state.vesselIdentity !== input.vesselIdentity,
  );
  const missionReverted = (
    state.lastMissionTime !== undefined
    && input.missionTime !== undefined
    && input.missionTime < state.lastMissionTime - nonNegative(policy.missionTimeResetSeconds)
  );
  const next = vesselChanged || missionReverted ? createAnnunciatorState() : cloneState(state);
  next.vesselIdentity = input.vesselIdentity ?? next.vesselIdentity;
  next.lastMissionTime = input.missionTime ?? next.lastMissionTime;
  return next;
}

export function evaluateAnnunciatorSnapshot(
  state: AnnunciatorState,
  rules: AnnunciatorRule[],
  snapshot: TelemetrySnapshot,
  input: {
    nowMs: number;
    missionTime?: number;
    vesselIdentity?: string;
  },
  policy: AnnunciatorPolicy = DEFAULT_ANNUNCIATOR_POLICY,
) {
  const context = { nowMs: input.nowMs, missionTime: input.missionTime };
  const next = reconcileAnnunciatorLifecycle(state, {
    flightActive: true,
    vesselIdentity: input.vesselIdentity,
    missionTime: input.missionTime,
  }, policy);
  next.feed.startedAtMs ??= input.nowMs;
  next.feed.lastSnapshotAtMs = input.nowMs;

  const sourceUnknown = new Map<string, boolean>();
  const sourceApplicable = new Set<string>();

  rules.forEach((rule) => {
    const definitionBase = {
      ruleId: rule.ruleId,
      sourceId: rule.sourceId,
      subsystem: rule.subsystem,
      defaultTier: rule.defaultTier,
      activationDwellMs: nonNegative(rule.activationDwellMs ?? policy.activationDwellMs),
      clearDwellMs: nonNegative(policy.clearDwellMs),
      latchSubDwell: rule.latchSubDwell ?? false,
    };
    const evaluation = rule.evaluate(snapshot, {
      previousState(instanceId) {
        return next.tracks[conditionKey(rule.ruleId, instanceId)]?.lastDecisiveState;
      },
    });
    const tracked = trackedInstancesForRule(next, rule.ruleId);
    if (evaluation.kind === "source-unknown") {
      sourceApplicable.add(rule.sourceId);
      sourceUnknown.set(rule.sourceId, true);
      tracked.forEach((instanceId) => applyObservation(next, {
        ...definitionBase,
        instanceId,
      }, { instanceId, state: "unknown" }, context));
      return;
    }
    if (evaluation.kind === "not-applicable") {
      tracked.forEach((instanceId) => applyObservation(next, {
        ...definitionBase,
        instanceId,
      }, { instanceId, state: "clear" }, context));
      return;
    }

    sourceApplicable.add(rule.sourceId);
    const observations = new Map(evaluation.observations.map((observation) => [observation.instanceId, observation]));
    observations.forEach((observation, instanceId) => {
      if (observation.state === "unknown") sourceUnknown.set(rule.sourceId, true);
      applyObservation(next, { ...definitionBase, instanceId }, observation, context);
    });
    tracked.filter((instanceId) => !observations.has(instanceId)).forEach((instanceId) => {
      const stateForMissing = evaluation.complete ? "clear" : "unknown";
      if (stateForMissing === "unknown") sourceUnknown.set(rule.sourceId, true);
      applyObservation(next, {
        ...definitionBase,
        instanceId,
      }, { instanceId, state: stateForMissing }, context);
    });
  });

  const sourceIds = new Set([
    ...Object.keys(next.sources),
    ...rules.map((rule) => rule.sourceId),
  ]);
  sourceIds.forEach((sourceId) => {
    const source = next.sources[sourceId] ?? {};
    next.sources[sourceId] = source;
    const unknown = sourceApplicable.has(sourceId) && sourceUnknown.get(sourceId) === true;
    if (unknown) {
      source.unknownSinceMs ??= input.nowMs;
    } else {
      source.unknownSinceMs = undefined;
    }
    const integrityActive = source.unknownSinceMs !== undefined
      && input.nowMs - source.unknownSinceMs >= nonNegative(policy.unknownDwellMs);
    applyObservation(next, integrityDefinition(sourceId, policy), {
      instanceId: sourceId,
      state: integrityActive ? "active" : "clear",
      message: sourceMessage(sourceId),
    }, context);
  });

  pruneEpisodes(next, policy.clearedRetention);
  return next;
}

function feedDefinition(): ConditionDefinition {
  return {
    ruleId: FEED_RULE_ID,
    instanceId: "datalink",
    sourceId: "datalink",
    subsystem: "DATALINK",
    defaultTier: "caution",
    activationDwellMs: 0,
    clearDwellMs: 0,
    latchSubDwell: false,
  };
}

function discardFeedCondition(state: AnnunciatorState) {
  const key = conditionKey(FEED_RULE_ID, "datalink");
  const episodeId = state.tracks[key]?.episodeId;
  if (episodeId !== undefined) {
    state.episodes = state.episodes.filter((episode) => episode.id !== episodeId);
  }
  delete state.tracks[key];
}

export function tickAnnunciatorWatchdog(
  state: AnnunciatorState,
  input: {
    nowMs: number;
    missionTime?: number;
    connectionState: ConnectionStatus;
    flightActive: boolean;
  },
  policy: AnnunciatorPolicy = DEFAULT_ANNUNCIATOR_POLICY,
) {
  if (!input.flightActive) return createAnnunciatorState();
  const next = cloneState(state);
  const context = { nowMs: input.nowMs, missionTime: input.missionTime };
  next.lastMissionTime = input.missionTime ?? next.lastMissionTime;

  if (input.connectionState === "offline") {
    next.feed = {};
    discardFeedCondition(next);
    return next;
  }

  next.feed.startedAtMs ??= input.nowMs;
  const reference = next.feed.lastSnapshotAtMs ?? next.feed.startedAtMs;
  const dwell = next.feed.lastSnapshotAtMs === undefined
    ? nonNegative(policy.initialConnectGraceMs)
    : nonNegative(policy.feedStaleDwellMs);
  const stale = input.nowMs - reference >= dwell;
  applyObservation(next, feedDefinition(), {
    instanceId: "datalink",
    state: stale ? "active" : "clear",
    message: next.feed.lastSnapshotAtMs === undefined
      ? "No Flight telemetry arrived before the connection grace period expired."
      : "The Flight telemetry feed stopped updating.",
  }, context);
  pruneEpisodes(next, policy.clearedRetention);
  return next;
}

export function acknowledgeAnnunciator(state: AnnunciatorState) {
  const next = cloneState(state);
  next.episodes.forEach((episode) => {
    if (!episode.seen) episode.seen = true;
  });
  return next;
}

export function acknowledgeAnnunciatorSubsystem(state: AnnunciatorState, subsystem: string) {
  const next = cloneState(state);
  next.episodes.forEach((episode) => {
    if (!episode.seen && episode.subsystem === subsystem) episode.seen = true;
  });
  return next;
}

export function summarizeAnnunciator(state: AnnunciatorState): AnnunciatorSummary {
  const active = state.episodes
    .filter((episode) => episode.clearedAtMs === null)
    .sort((left, right) => tierRank(right.tier) - tierRank(left.tier) || left.onsetAtMs - right.onsetAtMs);
  const cleared = state.episodes
    .filter((episode) => episode.clearedAtMs !== null)
    .sort((left, right) => (right.clearedAtMs ?? 0) - (left.clearedAtMs ?? 0));
  const unacknowledged = state.episodes.filter((episode) => (
    !episode.seen
    && episode.ruleId !== SOURCE_INTEGRITY_RULE_ID
    && episode.ruleId !== FEED_RULE_ID
  ));
  const tier = unacknowledged.some((episode) => episode.tier === "warning")
    ? "warning"
    : unacknowledged.length > 0 ? "caution" : undefined;
  const tokens = [...new Set(
    [...unacknowledged]
      .sort((left, right) => tierRank(right.tier) - tierRank(left.tier) || left.onsetAtMs - right.onsetAtMs)
      .map((episode) => episode.subsystem),
  )];
  return {
    lamp: unacknowledged.length > 0 ? "unacknowledged" : "dark",
    tier,
    tokens,
    active,
    cleared,
  };
}
