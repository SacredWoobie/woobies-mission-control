import { isFiniteNumber } from "../formatting/numbers";
import type { ScienceLabState, ScienceLabTelemetry, TelemetrySnapshot } from "../telemetry/types";

export type ScienceTone = "ok" | "warn" | "danger" | "unknown";

export interface ScienceLabViewModel extends ScienceLabTelemetry {
  dataFraction?: number;
  scienceFraction?: number;
  crewLabel: string;
  statusLabel: string;
  activityLabel: string;
  guidance: string;
  tone: ScienceTone;
}

export interface ScienceViewModel {
  recoverable?: number;
  transmit?: number;
  experimentCount: number;
  experiments: NonNullable<TelemetrySnapshot["sci.krpc.experiments"]>;
  banked?: number;
  locationPrimary: string;
  locationDetail: string;
  labTelemetryAvailable: boolean;
  labs: ScienceLabViewModel[];
  labDaySeconds: number;
}

function finite(value: unknown) {
  return isFiniteNumber(value) ? value : undefined;
}

function fraction(current: number | undefined, capacity: number | undefined) {
  return isFiniteNumber(current) && isFiniteNumber(capacity) && capacity > 0
    ? Math.max(0, Math.min(1, current / capacity))
    : undefined;
}

function cleanLocation(value: unknown) {
  return typeof value === "string" && value.trim() && value !== "null" ? value.trim() : "";
}

export function formatLabDuration(seconds: number | undefined, daySeconds: number) {
  if (!isFiniteNumber(seconds) || seconds < 0 || !isFiniteNumber(daySeconds) || daySeconds <= 0) return "";
  const rounded = Math.floor(seconds);
  const days = Math.floor(rounded / daySeconds);
  const remainder = rounded - days * daySeconds;
  const hours = Math.floor(remainder / 3_600);
  const minutes = Math.floor((remainder % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m`;
}

function statePresentation(
  state: ScienceLabState,
  lab: ScienceLabTelemetry,
  daySeconds: number,
): Pick<ScienceLabViewModel, "statusLabel" | "activityLabel" | "guidance" | "tone"> {
  switch (state) {
    case "researching": {
      const duration = lab.etaKind === "finite" || lab.etaKind === "depleted"
        ? formatLabDuration(lab.etaSeconds, daySeconds)
        : "";
      return {
        statusLabel: "RESEARCHING",
        activityLabel: "research active",
        guidance: duration
          ? `${lab.etaKind === "depleted" ? "data spent" : "full"} in ${duration}`
          : "rate available",
        tone: lab.etaKind === "depleted" ? "warn" : "ok",
      };
    }
    case "science-full":
      return { statusLabel: "SCIENCE FULL", activityLabel: "research stalled", guidance: "transmit science to resume", tone: "danger" };
    case "no-data":
      return { statusLabel: "NO DATA", activityLabel: "research stalled", guidance: "load experiment data to resume", tone: "warn" };
    case "no-scientist":
      return { statusLabel: "NO SCIENTIST", activityLabel: "research stalled", guidance: "assign a scientist to resume", tone: "warn" };
    case "insufficient-crew":
      return { statusLabel: "CREW REQUIRED", activityLabel: "research stalled", guidance: "add required crew to resume", tone: "warn" };
    case "stopped":
      return { statusLabel: "STOPPED", activityLabel: "research stopped", guidance: "start research to resume", tone: "unknown" };
    case "stalled":
      return { statusLabel: "STALLED", activityLabel: "research stalled", guidance: "check lab resources", tone: "warn" };
    default:
      return { statusLabel: "UNAVAILABLE", activityLabel: "research unavailable", guidance: "lab converter unavailable", tone: "unknown" };
  }
}

function normalizeLab(lab: ScienceLabTelemetry, daySeconds: number): ScienceLabViewModel {
  const crewCount = finite(lab.crewCount) ?? 0;
  const scientistCount = finite(lab.scientistCount) ?? 0;
  const state = lab.state ?? "unavailable";
  const presentation = statePresentation(state, lab, daySeconds);
  return {
    ...lab,
    id: lab.id?.trim() || lab.title?.trim() || "science-lab",
    title: lab.title?.trim() || "Science lab",
    dataStored: finite(lab.dataStored),
    dataCapacity: finite(lab.dataCapacity),
    scienceStored: finite(lab.scienceStored),
    scienceCapacity: finite(lab.scienceCapacity),
    calculatedSciencePerDay: finite(lab.calculatedSciencePerDay),
    sciencePerDay: finite(lab.sciencePerDay),
    scienceMultiplier: finite(lab.scienceMultiplier),
    crewCount,
    scientistCount,
    crewRequired: finite(lab.crewRequired),
    scientistFactor: finite(lab.scientistFactor),
    lastTimeFactor: finite(lab.lastTimeFactor),
    etaSeconds: finite(lab.etaSeconds),
    state,
    dataFraction: fraction(finite(lab.dataStored), finite(lab.dataCapacity)),
    scienceFraction: fraction(finite(lab.scienceStored), finite(lab.scienceCapacity)),
    crewLabel: `${crewCount} crew · ${scientistCount} scientist${scientistCount === 1 ? "" : "s"}`,
    ...presentation,
  };
}

export function selectScience(snapshot: TelemetrySnapshot): ScienceViewModel {
  const experiments = Array.isArray(snapshot["sci.krpc.experiments"])
    ? snapshot["sci.krpc.experiments"]
    : [];
  const body = cleanLocation(snapshot["v.body"]);
  const biome = cleanLocation(snapshot["v.biome"]);
  const situation = cleanLocation(snapshot["v.situationString"]);
  const daySeconds = finite(snapshot["sci.krpc.labDaySeconds"]) ?? 21_600;
  const labs = Array.isArray(snapshot["sci.krpc.labs"])
    ? snapshot["sci.krpc.labs"]
      .map((lab) => normalizeLab(lab, daySeconds))
      .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id))
    : [];
  return {
    recoverable: finite(snapshot["sci.krpc.total"]),
    transmit: finite(snapshot["sci.krpc.transmitTotal"]),
    experimentCount: finite(snapshot["sci.krpc.count"]) ?? experiments.length,
    experiments,
    banked: finite(snapshot["career.science"]),
    locationPrimary: [body, biome].filter(Boolean).join(" · "),
    locationDetail: situation,
    labTelemetryAvailable: snapshot["sci.krpc.labTelemetryAvailable"] === true,
    labs,
    labDaySeconds: daySeconds,
  };
}
