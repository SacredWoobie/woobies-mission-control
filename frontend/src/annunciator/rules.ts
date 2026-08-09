import { isFiniteNumber } from "../formatting/numbers";
import type { DamagePartTelemetry, HeatLoopTelemetry, ReactorTelemetry, TelemetrySnapshot } from "../telemetry/types";
import type {
  AnnunciatorObservation,
  AnnunciatorRule,
  AnnunciatorTier,
  RuleEvaluation,
  RuleEvaluationContext,
} from "./engine";

export interface FlightAnnunciatorConditionContract {
  ruleId: string;
  registration: "active" | "blocked";
  sourceId: string;
  subsystem: string;
  tier: AnnunciatorTier | "caution-to-warning";
  activationDwellMs?: number;
  latchSubDwell: boolean;
  trip: string;
  reset: string;
  identity: string;
  completeness: string;
  rationale: string;
  blocker?: string;
}

const HEAT_CAUTION_TRIP = 0.60;
const HEAT_CAUTION_RESET = 0.55;
const HEAT_WARNING_TRIP = 0.90;
const HEAT_WARNING_RESET = 0.85;
const HEAT_CRITICAL_SECONDS = 300;
const HEAT_CRITICAL_RESET_SECONDS = 360;
const REACTOR_TEMPERATURE_TRIP = 1.05;
const REACTOR_TEMPERATURE_RESET = 1.00;
const REACTOR_INTEGRITY_TRIP = 90;
const REACTOR_INTEGRITY_RESET = 92;
const ELECTRIC_CHARGE_CAUTION_TRIP = 0.40;
const ELECTRIC_CHARGE_CAUTION_RESET = 0.45;
const ELECTRIC_CHARGE_WARNING_TRIP = 0.15;
const COMMS_ACTIVATION_DWELL_MS = 1_500;

function active(
  instanceId: string,
  tier: AnnunciatorTier,
  message: string,
): AnnunciatorObservation {
  return { instanceId, state: "active", tier, message };
}

function clear(instanceId: string): AnnunciatorObservation {
  return { instanceId, state: "clear" };
}

function unknown(instanceId: string): AnnunciatorObservation {
  return { instanceId, state: "unknown" };
}

function highThresholdState(
  value: number,
  trip: number,
  reset: number,
  previous: "active" | "clear" | undefined,
) {
  if (value >= trip) return "active" as const;
  if (value <= reset) return "clear" as const;
  return previous ?? "clear";
}

function lowThresholdState(
  value: number,
  trip: number,
  reset: number,
  previous: "active" | "clear" | undefined,
) {
  if (value <= trip) return "active" as const;
  if (value >= reset) return "clear" as const;
  return previous ?? "clear";
}

function systemHeatEvaluation(
  snapshot: TelemetrySnapshot,
  context: RuleEvaluationContext,
): RuleEvaluation {
  const status = snapshot["heat.systemHeatStatus"];
  if (status === "unknown") return { kind: "source-unknown" };
  if (status === "not_applicable" || snapshot["heat.backend"] === "stock") {
    return { kind: "not-applicable" };
  }
  if (status !== "known" && snapshot["heat.backend"] !== "system_heat") {
    return { kind: "not-applicable" };
  }
  const loops = snapshot["heat.loops"];
  if (!Array.isArray(loops)) return { kind: "source-unknown" };
  if (loops.length === 0) return { kind: "not-applicable" };
  return {
    kind: "known",
    complete: true,
    observations: loops.map((loop, index) => heatLoopObservation(loop, index, context)),
  };
}

function heatLoopObservation(
  loop: HeatLoopTelemetry,
  index: number,
  context: RuleEvaluationContext,
): AnnunciatorObservation {
  const loopId = String(loop.id ?? "").trim();
  const instanceId = loopId ? `loop-${loopId}` : `unidentified-${index}`;
  if (
    !loopId
    || !isFiniteNumber(loop.tempK)
    || !isFiniteNumber(loop.nominalTempK)
    || loop.nominalTempK <= 0
  ) return unknown(instanceId);

  const ratio = loop.tempK / loop.nominalTempK;
  const netFlux = isFiniteNumber(loop.netKw)
    ? loop.netKw
    : isFiniteNumber(loop.genKw) && isFiniteNumber(loop.remKw)
      ? loop.genKw - loop.remKw
      : undefined;
  const generated = isFiniteNumber(loop.genKw) ? loop.genKw : undefined;
  const explicitCritical = typeof loop.stateText === "string" && /critical|runaway/i.test(loop.stateText);
  const noRadiators = loop.hasRadiators === false && (generated ?? netFlux ?? 0) > 0.05;
  const timeCritical = isFiniteNumber(loop.timeToCriticalSeconds)
    && loop.timeToCriticalSeconds >= 0
    && loop.timeToCriticalSeconds <= HEAT_CRITICAL_SECONDS;
  const warming = !isFiniteNumber(netFlux) || netFlux > 0.05;
  const warning = explicitCritical || noRadiators || timeCritical
    || (ratio >= HEAT_WARNING_TRIP && warming);
  if (warning) {
    const reason = noRadiators
      ? "has heat generation but no radiators"
      : timeCritical
        ? `is projected critical in ${Math.round(loop.timeToCriticalSeconds!)} s`
        : `is at ${Math.round(ratio * 100)}% of its nominal limit`;
    return active(instanceId, "warning", `Heat loop ${loopId} ${reason}.`);
  }

  const warningBandHeld = (
    context.previousState(instanceId) === "active"
    && ratio > HEAT_WARNING_RESET
    && warming
    && (
      !isFiniteNumber(loop.timeToCriticalSeconds)
      || loop.timeToCriticalSeconds < HEAT_CRITICAL_RESET_SECONDS
    )
  );
  const cautionState = highThresholdState(
    ratio,
    HEAT_CAUTION_TRIP,
    HEAT_CAUTION_RESET,
    context.previousState(instanceId),
  );
  if (warningBandHeld || (cautionState === "active" && warming)) {
    return active(
      instanceId,
      "caution",
      `Heat loop ${loopId} is elevated at ${Math.round(ratio * 100)}% of its nominal limit.`,
    );
  }
  return clear(instanceId);
}

function reactorSource(snapshot: TelemetrySnapshot) {
  const status = snapshot["elec.reactorsStatus"];
  if (status === "unknown") return { kind: "source-unknown" } as const;
  if (status === "not_applicable") return { kind: "not-applicable" } as const;
  const reactors = snapshot["elec.reactors"];
  if (status === "known" && !Array.isArray(reactors)) return { kind: "source-unknown" } as const;
  if (!Array.isArray(reactors) || reactors.length === 0) return { kind: "not-applicable" } as const;
  return { kind: "known", reactors } as const;
}

function reactorIdentity(reactor: ReactorTelemetry, index: number) {
  return Number.isSafeInteger(reactor.partId) && reactor.partId! >= 0
    ? `part-${reactor.partId}`
    : `unidentified-${index}`;
}

function reactorTemperatureEvaluation(
  snapshot: TelemetrySnapshot,
  context: RuleEvaluationContext,
): RuleEvaluation {
  const source = reactorSource(snapshot);
  if (source.kind !== "known") return source;
  return {
    kind: "known",
    complete: true,
    observations: source.reactors.map((reactor, index) => {
      const instanceId = reactorIdentity(reactor, index);
      if (
        instanceId.startsWith("unidentified-")
        || !isFiniteNumber(reactor.coreTemp)
        || !isFiniteNumber(reactor.nominalTemp)
        || reactor.nominalTemp <= 0
      ) return unknown(instanceId);
      const ratio = reactor.coreTemp / reactor.nominalTemp;
      const state = highThresholdState(
        ratio,
        REACTOR_TEMPERATURE_TRIP,
        REACTOR_TEMPERATURE_RESET,
        context.previousState(instanceId),
      );
      return state === "active"
        ? active(
          instanceId,
          "warning",
          `${reactor.name} core temperature is ${Math.round(ratio * 100)}% of nominal.`,
        )
        : clear(instanceId);
    }),
  };
}

function reactorIntegrityEvaluation(
  snapshot: TelemetrySnapshot,
  context: RuleEvaluationContext,
): RuleEvaluation {
  const source = reactorSource(snapshot);
  if (source.kind !== "known") return source;
  return {
    kind: "known",
    complete: true,
    observations: source.reactors.flatMap((reactor, index) => {
      if (reactor.hasIntegrity === false) return [];
      const instanceId = reactorIdentity(reactor, index);
      if (instanceId.startsWith("unidentified-") || !isFiniteNumber(reactor.integrity)) {
        return [unknown(instanceId)];
      }
      const state = lowThresholdState(
        reactor.integrity,
        REACTOR_INTEGRITY_TRIP,
        REACTOR_INTEGRITY_RESET,
        context.previousState(instanceId),
      );
      return [state === "active"
        ? active(
          instanceId,
          "warning",
          `${reactor.name} core integrity is ${Math.round(reactor.integrity)}%.`,
        )
        : clear(instanceId)];
    }),
  };
}

function electricChargeEvaluation(
  snapshot: TelemetrySnapshot,
  context: RuleEvaluationContext,
): RuleEvaluation {
  const status = snapshot["res.status"];
  if (status === "unknown" || status === "incomplete") return { kind: "source-unknown" };
  const names = snapshot["res.names"];
  if (!Array.isArray(names)) return status === "known" ? { kind: "source-unknown" } : { kind: "not-applicable" };
  const name = names.find((candidate) => candidate.toLocaleLowerCase() === "electriccharge");
  if (!name) return { kind: "not-applicable" };
  const current = snapshot[`r.resource[${name}]`];
  const maximum = snapshot[`r.resourceMax[${name}]`];
  if (!isFiniteNumber(current) || !isFiniteNumber(maximum) || maximum <= 0) {
    return { kind: "source-unknown" };
  }
  const fraction = Math.max(0, Math.min(1, current / maximum));
  const instanceId = "vessel-electric-charge";
  const state = lowThresholdState(
    fraction,
    ELECTRIC_CHARGE_CAUTION_TRIP,
    ELECTRIC_CHARGE_CAUTION_RESET,
    context.previousState(instanceId),
  );
  return {
    kind: "known",
    complete: true,
    observations: [state === "active"
      ? active(
        instanceId,
        fraction <= ELECTRIC_CHARGE_WARNING_TRIP ? "warning" : "caution",
        `Electric charge is at ${Math.round(fraction * 100)}%.`,
      )
      : clear(instanceId)],
  };
}

function commsEvaluation(snapshot: TelemetrySnapshot): RuleEvaluation {
  const instanceId = "active-vessel";
  if (snapshot["rt.available"] === true) {
    if (typeof snapshot["rt.hasConnection"] !== "boolean") return { kind: "source-unknown" };
    return {
      kind: "known",
      complete: true,
      observations: [snapshot["rt.hasConnection"]
        ? clear(instanceId)
        : active(instanceId, "caution", "RemoteTech reports no vessel connection.")],
    };
  }
  if (typeof snapshot["comm.krpc.canCommunicate"] !== "boolean") return { kind: "source-unknown" };
  return {
    kind: "known",
    complete: true,
    observations: [snapshot["comm.krpc.canCommunicate"]
      ? clear(instanceId)
      : active(instanceId, "caution", "CommNet reports no vessel connection.")],
  };
}

const DAMAGE_KIND_LABELS: Record<DamagePartTelemetry["kind"], string> = {
  solar_panel: "solar panel",
  radiator: "radiator",
  antenna: "antenna",
  landing_leg: "landing leg",
  wheel: "wheel",
  reaction_wheel: "reaction wheel",
  engine: "engine",
  tank: "tank",
  wing: "wing",
  sas: "SAS unit",
  rcs: "RCS part",
  command: "command part",
  structural: "structural part",
  other: "part",
};

function damageIdentity(part: DamagePartTelemetry) {
  if (part.condition === "lost" && part.eventId?.trim()) {
    return `loss:${encodeURIComponent(part.eventId.trim())}`;
  }
  return [part.kind, part.name, part.tag ?? "", part.module ?? ""]
    .map((value) => encodeURIComponent(value.trim().toLocaleLowerCase()))
    .join(":");
}

function damageEvaluation(snapshot: TelemetrySnapshot): RuleEvaluation {
  const status = snapshot["damage.status"];
  const lossStatus = snapshot["damage.lossStatus"];
  const attachedKnown = status === "known";
  const lossKnown = lossStatus === "known";
  const lossUnavailable = lossStatus === "unavailable" || lossStatus === undefined;
  if (!attachedKnown && !lossKnown) return { kind: "source-unknown" };
  const parts = snapshot["damage.parts"];
  if (!Array.isArray(parts)) return { kind: "source-unknown" };
  const observations = parts.map((part, index) => {
    if (!part || typeof part !== "object") return unknown(`unidentified-${index}`);
    const condition = part.condition ?? "damaged";
    if ((condition === "damaged" && !attachedKnown) || (condition === "lost" && !lossKnown)) {
      return unknown(`unavailable-${index}`);
    }
    const label = DAMAGE_KIND_LABELS[part.kind];
    if (
      !label
      || (condition !== "damaged" && condition !== "lost")
      || typeof part.name !== "string"
      || !part.name.trim()
      || (part.tag !== undefined && typeof part.tag !== "string")
      || (part.module !== undefined && typeof part.module !== "string")
      || (part.detector !== undefined && typeof part.detector !== "string")
      || (part.partId !== undefined && !Number.isSafeInteger(part.partId))
      || (part.eventId !== undefined && typeof part.eventId !== "string")
      || (condition === "lost" && !part.eventId?.trim())
      || !Number.isSafeInteger(part.count)
      || part.count <= 0
    ) return unknown(`unidentified-${index}`);
    const count = part.count;
    const identity = damageIdentity(part);
    const named = part.tag?.trim() ? `${part.name} (${part.tag.trim()})` : part.name;
    const family = count === 1 ? label : `${label}s`;
    const verb = condition === "lost" ? "lost" : "damaged";
    return active(identity, "warning", `${count} ${verb} ${family}: ${named}.`);
  });
  if (!attachedKnown) observations.push(unknown("attached-scan"));
  if (!lossKnown && !lossUnavailable) observations.push(unknown("loss-ledger"));
  return {
    kind: "known",
    complete: attachedKnown && (lossKnown || lossUnavailable),
    observations,
  };
}

export const SYSTEM_HEAT_RULE: AnnunciatorRule = {
  ruleId: "system-heat-loop",
  sourceId: "systemheat",
  subsystem: "HEAT",
  defaultTier: "caution",
  activationDwellMs: 0,
  latchSubDwell: true,
  evaluate: systemHeatEvaluation,
};

export const REACTOR_TEMPERATURE_RULE: AnnunciatorRule = {
  ruleId: "reactor-core-temperature",
  sourceId: "reactors",
  subsystem: "REACTOR",
  defaultTier: "warning",
  activationDwellMs: 0,
  latchSubDwell: true,
  evaluate: reactorTemperatureEvaluation,
};

export const REACTOR_INTEGRITY_RULE: AnnunciatorRule = {
  ruleId: "reactor-core-integrity",
  sourceId: "reactors",
  subsystem: "REACTOR",
  defaultTier: "warning",
  activationDwellMs: 0,
  latchSubDwell: true,
  evaluate: reactorIntegrityEvaluation,
};

export const ELECTRIC_CHARGE_RULE: AnnunciatorRule = {
  ruleId: "electric-charge-low",
  sourceId: "resources",
  subsystem: "POWER",
  defaultTier: "caution",
  latchSubDwell: true,
  evaluate: electricChargeEvaluation,
};

export const COMMS_LINK_RULE: AnnunciatorRule = {
  ruleId: "comms-link-lost",
  sourceId: "comms",
  subsystem: "COMMS",
  defaultTier: "caution",
  activationDwellMs: COMMS_ACTIVATION_DWELL_MS,
  evaluate: commsEvaluation,
};

export const PART_DAMAGE_RULE: AnnunciatorRule = {
  ruleId: "craft-part-damage",
  sourceId: "damage",
  subsystem: "DAMAGE",
  defaultTier: "warning",
  activationDwellMs: 0,
  latchSubDwell: true,
  evaluate: damageEvaluation,
};

export const ACTIVE_FLIGHT_ANNUNCIATOR_RULES: AnnunciatorRule[] = [
  SYSTEM_HEAT_RULE,
  REACTOR_TEMPERATURE_RULE,
  REACTOR_INTEGRITY_RULE,
  ELECTRIC_CHARGE_RULE,
  COMMS_LINK_RULE,
  PART_DAMAGE_RULE,
];

export const FLIGHT_ANNUNCIATOR_CONDITION_TABLE: FlightAnnunciatorConditionContract[] = [
  {
    ruleId: SYSTEM_HEAT_RULE.ruleId,
    registration: "active",
    sourceId: "systemheat",
    subsystem: "HEAT",
    tier: "caution-to-warning",
    activationDwellMs: 0,
    latchSubDwell: true,
    trip: "Caution at >=60% nominal while warming; warning at >=90%, <=300 s to critical, explicit critical/runaway, or heat generation without radiators.",
    reset: "Caution <=55% or cooling; warning <=85%, >360 s to critical, and no critical/no-radiator state.",
    identity: "System Heat loop ID, scoped to the active persistent vessel and reset on revert.",
    completeness: "heat.systemHeatStatus plus the authoritative complete heat.loops array.",
    rationale: "Matches the existing Heat panel bands while preserving warning escalation and irreversible transient latching.",
  },
  {
    ruleId: REACTOR_TEMPERATURE_RULE.ruleId,
    registration: "active",
    sourceId: "reactors",
    subsystem: "REACTOR",
    tier: "warning",
    activationDwellMs: 0,
    latchSubDwell: true,
    trip: "Core temperature >=105% of nominal.",
    reset: "Core temperature <=100% of nominal.",
    identity: "System Heat reactor partId; unidentified reactors hold and raise REACTORS FEED integrity.",
    completeness: "elec.reactorsStatus=known and the complete elec.reactors array.",
    rationale: "Uses the existing reactor danger threshold and latches potentially irreversible overtemperature.",
  },
  {
    ruleId: REACTOR_INTEGRITY_RULE.ruleId,
    registration: "active",
    sourceId: "reactors",
    subsystem: "REACTOR",
    tier: "warning",
    activationDwellMs: 0,
    latchSubDwell: true,
    trip: "Fission core integrity <=90%.",
    reset: "Core integrity >=92%.",
    identity: "System Heat reactor partId; fusion reactors explicitly omit the non-applicable integrity observation.",
    completeness: "elec.reactorsStatus=known and the complete elec.reactors array.",
    rationale: "Integrity loss is persistent damage and therefore bypasses sub-dwell filtering.",
  },
  {
    ruleId: ELECTRIC_CHARGE_RULE.ruleId,
    registration: "active",
    sourceId: "resources",
    subsystem: "POWER",
    tier: "caution-to-warning",
    latchSubDwell: true,
    trip: "Caution at <=40% vessel ElectricCharge; warning at <=15%.",
    reset: "Clear at >=45%.",
    identity: "Singleton ElectricCharge store scoped to the active persistent vessel.",
    completeness: "res.status=known, ElectricCharge listed in res.names, and finite amount/capacity.",
    rationale: "Reuses the existing resource meter bands; depletion is latched even when a later frame recovers.",
  },
  {
    ruleId: COMMS_LINK_RULE.ruleId,
    registration: "active",
    sourceId: "comms",
    subsystem: "COMMS",
    tier: "caution",
    activationDwellMs: COMMS_ACTIVATION_DWELL_MS,
    latchSubDwell: false,
    trip: "RemoteTech (authoritative when available) or stock CommNet reports no connection for 1.5 s.",
    reset: "Authoritative connection remains restored through global clear dwell.",
    identity: "Singleton active vessel, reset on persistent vessel change or revert.",
    completeness: "RemoteTech availability and connection boolean, otherwise stock canCommunicate boolean, sampled every frame.",
    rationale: "Short handoff drops are diagnostic blips; sustained loss is actionable but not inherently destructive.",
  },
  {
    ruleId: PART_DAMAGE_RULE.ruleId,
    registration: "active",
    sourceId: "damage",
    subsystem: "DAMAGE",
    tier: "warning",
    activationDwellMs: 0,
    latchSubDwell: true,
    trip: "A complete stock kRPC breakable-part scan reports one or more broken parts.",
    reset: "A complete scan no longer contains the grouped broken-part identity for the global clear dwell.",
    identity: "Breakable part kind plus title and optional user tag, grouped for identical parts and scoped to the active vessel.",
    completeness: "damage.status=known and the complete damage.parts array; incomplete scans hold condition state and surface source diagnostics only.",
    rationale: "Physical part damage is immediately actionable and persistent, so it raises warning without activation dwell and remains in history after repair or separation.",
  },
  {
    ruleId: "stock-part-heat",
    registration: "blocked",
    sourceId: "stockheat",
    subsystem: "HEAT",
    tier: "caution-to-warning",
    latchSubDwell: true,
    trip: "Would mirror the stock Heat panel 60%/90% bands.",
    reset: "Would require separate 55%/85% reset bands.",
    identity: "Unavailable: current stock heat rows have name plus transient list index only.",
    completeness: "Unavailable: the collector intentionally truncates to the hottest 12 parts.",
    rationale: "A partial, index-identified list cannot safely clear or correlate episodes.",
    blocker: "Publish persistent part IDs and authoritative completeness before registration.",
  },
  {
    ruleId: "propellant-low",
    registration: "blocked",
    sourceId: "resources",
    subsystem: "FUEL",
    tier: "caution-to-warning",
    latchSubDwell: true,
    trip: "Undecided per required propellant and mission phase.",
    reset: "Undecided.",
    identity: "Resource name scoped to the active persistent vessel.",
    completeness: "res.status provides source integrity, but not mission intent.",
    rationale: "Empty spent-stage propellant and intentionally unused mod resources are normal states.",
    blocker: "Requires authoritative required-resource/mission-phase semantics to avoid nuisance alarms.",
  },
  {
    ruleId: "reactor-offline",
    registration: "blocked",
    sourceId: "reactors",
    subsystem: "REACTOR",
    tier: "caution",
    latchSubDwell: false,
    trip: "Undecided; an offline installed reactor may be deliberate.",
    reset: "Reactor online.",
    identity: "System Heat reactor partId.",
    completeness: "elec.reactorsStatus and complete reactor array are sufficient.",
    rationale: "Telemetry cannot distinguish commanded standby from an unexpected shutdown.",
    blocker: "Requires an expected-running or commanded-state signal.",
  },
  {
    ruleId: "science-lab-attention",
    registration: "blocked",
    sourceId: "science",
    subsystem: "SCIENCE",
    tier: "caution",
    latchSubDwell: false,
    trip: "Candidate states are science-full and stalled.",
    reset: "Researching or an explicitly non-attention state.",
    identity: "Science lab persistent ID is available.",
    completeness: "Lab count/failure/malformed counts are available, but the source is cached for five seconds.",
    rationale: "This is operational attention rather than vessel safety and needs an explicit product-policy decision.",
    blocker: "Confirm that operational science states belong on the master caution system.",
  },
];
