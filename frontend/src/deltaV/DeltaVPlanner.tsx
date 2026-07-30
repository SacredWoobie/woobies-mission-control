import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CelestialBodyTelemetry, SceneMode, TelemetrySnapshot } from "../telemetry/types";
import { liveTelemetryStore } from "../telemetry/store";
import { useLiveConnectionStatus, useLiveTelemetrySelector } from "../telemetry/useLiveTelemetry";
import { isKerbinTime, useTimeSystem } from "../timeSystem";
import { DISTANCE_UNITS, distanceFromUnit, distanceToUnit, formatDistance, type DistanceUnit } from "../resonantOrbit/calculations";
import {
  bodiesForSystem,
  bodiesFromTelemetry,
  calculateSerialDeltaVPlan,
  deltaVSystemForCatalogNames,
  formatDeltaV,
  formatTransferDuration,
  minimumParkingAltitude,
  nextRecurringLocalDepartureUT,
  serialTransferTimingsForRoute,
  transferArcsForSerialRoute,
  type ArrivalStrategy,
  type CustomDeltaVStep,
  type DeltaVBody,
  type DeltaVLeg,
  type DeltaVSystem,
  type MissionEndpoint,
  type LiveTransferSolution,
  type TransferArcDescriptor,
} from "./calculations";
import { formatMissionUT, PorkchopPlotModal, type PorkchopCell, type PorkchopEvaluation, type PorkchopGrid } from "./PorkchopPlotModal";
import { DEFAULT_ARRIVAL, useDeltaVDraft, type MissionStopDraft, type SavedDeltaVPlanRecord, type TransferPlanningMode } from "./state";
import { thermalProtectionStatus } from "./thermalProtection";
import { useDialogFocus } from "./useDialogFocus";

function optionalNumberArraysEqual(left?: number[], right?: number[]) {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function catalogBodiesEqual(left: CelestialBodyTelemetry[], right: CelestialBodyTelemetry[]) {
  if (left.length !== right.length) return false;
  return left.every((body, index) => {
    const candidate = right[index];
    return body.name === candidate?.name
      && body.parent === candidate.parent
      && body.semiMajorAxis === candidate.semiMajorAxis
      && body.parentGravitationalParameter === candidate.parentGravitationalParameter
      && body.orbitEpoch === candidate.orbitEpoch
      && body.meanLongitudeAtEpoch === candidate.meanLongitudeAtEpoch
      && body.gravitationalParameter === candidate.gravitationalParameter
      && body.radius === candidate.radius
      && body.rotationPeriod === candidate.rotationPeriod
      && body.atmosphereDepth === candidate.atmosphereDepth
      && body.sphereOfInfluence === candidate.sphereOfInfluence
      && body.surfaceGravity === candidate.surfaceGravity
      && body.solidSurface === candidate.solidSurface
      && optionalNumberArraysEqual(body.atmosphereDensityAltitudes, candidate.atmosphereDensityAltitudes)
      && optionalNumberArraysEqual(body.atmosphereDensities, candidate.atmosphereDensities);
  });
}

function formatCalculatedStay(seconds: number, kerbinTime: boolean) {
  const formatted = formatTransferDuration(seconds, kerbinTime).replace(/ 0h$/, "");
  return seconds > 0 && formatted === "0h" ? "<1h" : formatted;
}

function fingerprintForArc(system: DeltaVSystem, arc: TransferArcDescriptor, earliestDepartureUT?: number) {
  const { id, direction, routeLegId, label, ...request } = arc;
  return JSON.stringify({ system, id, direction, routeLegId, label, ...request, earliestDepartureUT: earliestDepartureUT ?? null });
}

function solutionMatchesArc(solution: LiveTransferSolution | undefined, arc: TransferArcDescriptor, earliestDepartureUT?: number) {
  if (!solution) return false;
  const altitudeMatches = (left: number, right: number) => Math.abs(left - right) < 0.01;
  return (!solution.arcId || solution.arcId === arc.id)
    && solution.origin === arc.origin
    && solution.destination === arc.destination
    && altitudeMatches(solution.originParkingAltitude, arc.originParkingAltitude)
    && altitudeMatches(solution.destinationParkingAltitude, arc.destinationParkingAltitude)
    && (earliestDepartureUT === undefined || solution.departureUT >= earliestDepartureUT);
}

function BodySelect({ bodies, label, onChange, placeholder, value }: { bodies: DeltaVBody[]; label: string; onChange(value: string): void; placeholder?: string; value: string }) {
  const primary = bodies.filter((candidate) => !bodies.some((possibleParent) => possibleParent.name === candidate.parent));
  const descendants = (parent: string, depth = 1, visited = new Set<string>()): Array<{ body: DeltaVBody; depth: number }> => {
    if (visited.has(parent)) return [];
    const nextVisited = new Set(visited).add(parent);
    return bodies.filter((candidate) => candidate.parent === parent).flatMap((child) => [
      { body: child, depth },
      ...descendants(child.name, depth + 1, nextVisited),
    ]);
  };
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>
    {placeholder && <option value="">{placeholder}</option>}
    {primary.map((parent) => {
      return <optgroup key={parent.name} label={`${parent.name} system`}>
        <option value={parent.name}>{parent.name}</option>
        {descendants(parent.name).map(({ body: child, depth }) => <option key={child.name} value={child.name}>{`${"↳ ".repeat(depth)}${child.name}`}</option>)}
      </optgroup>;
    })}
  </select></label>;
}

function EndpointControl({ body, endpoint, label, groupName = label, onChange, surfaceLabel = "Surface" }: { body: DeltaVBody; endpoint: MissionEndpoint; groupName?: string; label: string; onChange(value: MissionEndpoint): void; surfaceLabel?: string }) {
  return <fieldset><legend>{label}</legend><div className="resonant-segments delta-v-endpoint-segments">
    <label><input checked={endpoint === "surface"} disabled={!body.solidSurface} name={`${groupName}-endpoint`} type="radio" onChange={() => onChange("surface")} /><span>{surfaceLabel}</span></label>
    <label><input checked={endpoint === "orbit"} name={`${groupName}-endpoint`} type="radio" onChange={() => onChange("orbit")} /><span>Parking orbit</span></label>
  </div></fieldset>;
}

function ParkingAltitudeInput({ body, label, onChange, unit, value }: { body: DeltaVBody; label: string; onChange(value: number): void; unit: DistanceUnit; value: number }) {
  const minimum = minimumParkingAltitude(body);
  const invalid = !Number.isFinite(value) || value < minimum;
  const helpId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-help`;
  const help = invalid ? `Minimum valid orbit is ${formatDistance(minimum, unit)}` : body.atmosphereDepth > 0 ? `Atmosphere ends at ${formatDistance(body.atmosphereDepth, unit)}` : "Vacuum body";
  return <label className="delta-v-parking-altitude"><span>{label}</span><div className="resonant-input-unit"><input
    aria-describedby={helpId}
    aria-invalid={invalid ? "true" : undefined}
    aria-label={label}
    min={distanceToUnit(minimum, unit)}
    step={1 / DISTANCE_UNITS[unit].factor}
    type="number"
    value={Number(distanceToUnit(value, unit).toFixed(DISTANCE_UNITS[unit].inputDecimals))}
    onChange={(event) => onChange(distanceFromUnit(Number(event.target.value), unit))}
  /><span>{unit}</span></div><small className={invalid ? "delta-v-input-error" : undefined} id={helpId} role={invalid ? "alert" : undefined}>{help}</small></label>;
}

function ArrivalStepControls({ leg, strategy, onChange }: { leg: DeltaVLeg; strategy: ArrivalStrategy; onChange(patch: Partial<ArrivalStrategy>): void }) {
  if (!leg.atmosphereAvailable) return null;
  if (leg.kind === "capture") {
    const canSkipCapture = leg.destinationEndpoint === "surface";
    const captureEnabled = !canSkipCapture || strategy.captureBeforeLanding;
    return <div className="delta-v-leg-options">
      {canSkipCapture && <label><input checked={strategy.captureBeforeLanding} type="checkbox" onChange={(event) => onChange({ captureBeforeLanding: event.target.checked })} /><span>Capture orbit before landing</span></label>}
      {captureEnabled && <label><input checked={strategy.aerocapture} type="checkbox" onChange={(event) => onChange({ aerocapture: event.target.checked })} /><span>Aerobrake capture</span></label>}
    </div>;
  }
  if (leg.kind === "landing") {
    return <div className="delta-v-leg-options delta-v-landing-options">
      <label><input checked={strategy.atmosphericLanding} type="checkbox" onChange={(event) => onChange({ atmosphericLanding: event.target.checked })} /><span>Atmospheric descent + chutes</span></label>
      {strategy.atmosphericLanding && <label className="delta-v-inline-reserve"><span>Assisted landing reserve</span><div className="resonant-input-unit"><input
        aria-label="Arrival assisted landing reserve"
        min="0"
        step="10"
        type="number"
        value={strategy.assistedLandingReserve}
        onChange={(event) => onChange({ assistedLandingReserve: Number(event.target.value) })}
      /><span>m/s</span></div></label>}
    </div>;
  }
  return null;
}

export function DeltaVPlanner({ mode, onCloseSavedPlans, resetRevision, saveTarget, savedPlansOpen, snapshot: suppliedTelemetry, unit }: { mode: SceneMode; onCloseSavedPlans(): void; resetRevision: number; saveTarget?: Element | null; savedPlansOpen: boolean; snapshot?: TelemetrySnapshot | null; unit: DistanceUnit }) {
  const { system: timeSystem } = useTimeSystem();
  const kerbinTime = isKerbinTime(timeSystem);
  const liveBodies = useLiveTelemetrySelector((state): CelestialBodyTelemetry[] => state.snapshot?.["catalog.bodies"] ?? [], catalogBodiesEqual);
  const liveTelemetry = useLiveTelemetrySelector((state) => state.snapshot);
  const connection = useLiveConnectionStatus();
  // Supplied snapshots support deterministic fixtures, but the live dashboard
  // passes a memoized craft/Notes snapshot here for pinning. Once linked, use
  // the complete feed so transfer progress and one-frame porkchop grids cannot
  // be hidden by that snapshot's narrower equality selector.
  const telemetry = connection.status === "linked"
    ? liveTelemetry
    : suppliedTelemetry === undefined ? liveTelemetry : suppliedTelemetry;
  const craftThermalProtection = thermalProtectionStatus(telemetry);
  const system: DeltaVSystem = deltaVSystemForCatalogNames(liveBodies.map((body) => body.name));
  const connectedBodies = useMemo(() => bodiesFromTelemetry(liveBodies), [liveBodies]);
  const bodies = useMemo(() => connectedBodies.length > 0 ? connectedBodies : bodiesForSystem(system), [connectedBodies, system]);
  const liveCatalogActive = connectedBodies.length > 0;
  const {
    activeSavedPlanId,
    customSteps,
    deletePlan,
    editingStopId,
    linkPlansToSave,
    loadPlan,
    marginPercent,
    nextCustomStep,
    nextMissionStop,
    nextStop,
    pinPlan,
    pinnedForTelemetry,
    profileOpen,
    savedPlans,
    savePlan,
    selectedPorkchopEvaluations,
    selectedTransferSolutions,
    setCustomSteps,
    setEditingStopId,
    setMarginPercent,
    setNextStop,
    setProfileOpen,
    setSelectedPorkchopEvaluations,
    setSelectedTransferSolutions,
    setStart,
    setStartLocked,
    setStops,
    setTransferMode,
    start,
    startLocked,
    stops,
    transferMode,
    transferRouteSignature,
  } = useDeltaVDraft();
  const pinned = pinnedForTelemetry(telemetry);
  const origin = bodies.find((candidate) => candidate.name === start.bodyName) ?? bodies.find((candidate) => candidate.name === "Kerbin") ?? bodies[0];
  const planningStops = editingStopId || !nextStop.bodyName ? stops : [...stops, nextStop];
  const resolvedStops = planningStops.map((stop) => ({
    ...stop,
    body: bodies.find((candidate) => candidate.name === stop.bodyName) ?? bodies[0],
  }));
  const nextStopBody = bodies.find((candidate) => candidate.name === nextStop.bodyName);
  const [activeTransferRequestId, setActiveTransferRequestId] = useState("");
  const [activeTransferDirection, setActiveTransferDirection] = useState("segment-1");
  const [activeTransferFingerprint, setActiveTransferFingerprint] = useState("");
  const [activeTransferPurpose, setActiveTransferPurpose] = useState<"quick" | "plot">("quick");
  const [idealSequenceActive, setIdealSequenceActive] = useState(false);
  const [porkchopDirection, setPorkchopDirection] = useState<string | null>(null);
  const [porkchopGrids, setPorkchopGrids] = useState<Partial<Record<string, PorkchopGrid>>>({});
  const requestedGridRequest = useRef("");
  const acknowledgedGridRequest = useRef("");
  const appliedQuickRequest = useRef("");
  const [sendError, setSendError] = useState("");
  const [planName, setPlanName] = useState("");
  const [savedNotice, setSavedNotice] = useState("");
  const [saveError, setSaveError] = useState(false);
  const [loadFromAllSaves, setLoadFromAllSaves] = useState(false);
  const currentSaveFolder = typeof telemetry?.["game.saveFolder"] === "string"
    ? telemetry["game.saveFolder"].trim()
    : "";
  const unlinkedSavedPlans = useMemo(() => savedPlans.filter((record) => !record.saveFolder), [savedPlans]);
  const visibleSavedPlans = useMemo(() => {
    const visible = loadFromAllSaves
      ? savedPlans
      : savedPlans.filter((record) => record.saveFolder === currentSaveFolder);
    return [...visible].sort((left, right) => loadFromAllSaves
      ? left.saveFolder.localeCompare(right.saveFolder)
        || Date.parse(right.updatedAt || "1970-01-01") - Date.parse(left.updatedAt || "1970-01-01")
        || left.name.localeCompare(right.name)
      : Date.parse(right.updatedAt || "1970-01-01") - Date.parse(left.updatedAt || "1970-01-01")
        || left.name.localeCompare(right.name));
  }, [currentSaveFolder, loadFromAllSaves, savedPlans]);
  const savedPlanGroups = useMemo(() => {
    const groups = new Map<string, SavedDeltaVPlanRecord[]>();
    visibleSavedPlans.forEach((record) => {
      const group = groups.get(record.saveFolder) ?? [];
      group.push(record);
      groups.set(record.saveFolder, group);
    });
    return [...groups.entries()];
  }, [visibleSavedPlans]);
  const savedPlansDialogRef = useDialogFocus<HTMLElement>(savedPlansOpen, onCloseSavedPlans);
  const appliedResetRevision = useRef(resetRevision);

  useEffect(() => {
    if (!savedPlansOpen) setLoadFromAllSaves(false);
  }, [savedPlansOpen]);

  useEffect(() => {
    if (!savedNotice) return;
    const noticeTimeout = window.setTimeout(() => {
      setSavedNotice("");
      setSaveError(false);
    }, 7_000);
    return () => window.clearTimeout(noticeTimeout);
  }, [savedNotice]);

  useEffect(() => {
    if (appliedResetRevision.current === resetRevision) return;
    appliedResetRevision.current = resetRevision;
    if (activeTransferRequestId) {
      liveTelemetryStore.send({ type: "mechjeb.transfer.cancel", requestId: activeTransferRequestId });
    }
    setActiveTransferRequestId("");
    setActiveTransferDirection("segment-1");
    setActiveTransferFingerprint("");
    setActiveTransferPurpose("quick");
    setIdealSequenceActive(false);
    setPorkchopDirection(null);
    setPorkchopGrids({});
    requestedGridRequest.current = "";
    acknowledgedGridRequest.current = "";
    appliedQuickRequest.current = "";
    setSendError("");
    setPlanName("");
    setSavedNotice("");
    setSaveError(false);
    transferRouteSignature.current = "";
  }, [resetRevision]);

  const selectStart = (name: string) => {
    const selected = bodies.find((candidate) => candidate.name === name);
    if (!selected) return;
    setStart((current) => ({
      ...current,
      bodyName: name,
      parkingAltitude: selected.defaultParkingAltitude,
      endpoint: selected.solidSurface ? current.endpoint : "orbit",
    }));
  };

  const updateStop = (id: string, update: (current: MissionStopDraft) => MissionStopDraft) => {
    setStops((current) => current.map((stop) => stop.id === id ? update(stop) : stop));
  };
  const selectNextStop = (name: string) => {
    if (!name) {
      setNextStop((current) => ({ ...current, bodyName: "", endpoint: "surface", parkingAltitude: 1_000, arrivalStrategy: { ...DEFAULT_ARRIVAL }, stayDurationDays: 1 }));
      return;
    }
    const selected = bodies.find((candidate) => candidate.name === name);
    if (!selected) return;
    setNextStop((current) => ({
      ...current,
      bodyName: name,
      parkingAltitude: selected.defaultParkingAltitude,
      endpoint: selected.solidSurface ? current.endpoint : "orbit",
    }));
  };

  const resetNextStop = () => {
    const id = `segment-${nextMissionStop.current++}`;
    setNextStop({
      id,
      bodyName: "",
      endpoint: "surface",
      parkingAltitude: 1_000,
      arrivalStrategy: { ...DEFAULT_ARRIVAL },
      stayDurationDays: 1,
    });
    setEditingStopId(null);
  };
  const lockStart = () => {
    setStartLocked(true);
  };
  const addStop = () => {
    if (!nextStop.bodyName) return;
    if (editingStopId) {
      setStops((current) => current.map((stop) => stop.id === editingStopId ? { ...nextStop, id: editingStopId } : stop));
    } else {
      setStops((current) => [...current, nextStop]);
    }
    resetNextStop();
  };
  const editStop = (id: string) => {
    const stop = stops.find((candidate) => candidate.id === id);
    if (!stop) return;
    setNextStop({ ...stop, arrivalStrategy: { ...stop.arrivalStrategy } });
    setEditingStopId(id);
  };
  const cancelStopEdit = () => {
    resetNextStop();
  };
  const removeStop = (id: string) => {
    if (editingStopId === id) resetNextStop();
    setStops((current) => current.filter((stop) => stop.id !== id));
    setSelectedTransferSolutions((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setSelectedPorkchopEvaluations((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const parkingAltitudesValid = (start.endpoint === "surface"
      || Number.isFinite(start.parkingAltitude) && start.parkingAltitude >= minimumParkingAltitude(origin))
    && resolvedStops.every((stop) => stop.endpoint === "surface"
      || Number.isFinite(stop.parkingAltitude) && stop.parkingAltitude >= minimumParkingAltitude(stop.body));
  const serialRoute = useMemo(() => ({
    system,
    catalog: bodies,
    start: { bodyName: origin.name, endpoint: start.endpoint, parkingAltitude: start.parkingAltitude },
    stops: resolvedStops.map(({ body, ...stop }) => ({ ...stop, bodyName: body.name })),
  }), [bodies, origin.name, resolvedStops, start.endpoint, start.parkingAltitude, system]);
  const transferArcs = useMemo(() => parkingAltitudesValid ? transferArcsForSerialRoute(serialRoute) : [], [parkingAltitudesValid, serialRoute]);
  const transferTimings = useMemo(() => parkingAltitudesValid ? serialTransferTimingsForRoute(serialRoute) : [], [parkingAltitudesValid, serialRoute]);
  const secondsPerSelectedDay = kerbinTime ? 6 * 60 * 60 : 24 * 60 * 60;
  const transferSequence = useMemo(() => {
    const earliestDepartures: Partial<Record<string, number>> = {};
    const localTimelines: Partial<Record<string, { departureUT: number; arrivalUT: number; origin: string; destination: string; recurringWindow: boolean }>> = {};
    const resolvedDirections = new Set<string>();
    let endpointAvailableUT: number | undefined;
    let finalEndpointArrivalUT: number | undefined;

    for (const timing of transferTimings) {
      const stop = planningStops.find((candidate) => candidate.id === timing.segmentId);
      const stayDurationSeconds = Math.max(0, stop?.stayDurationDays ?? 1) * secondsPerSelectedDay;
      const arc = transferArcs.find((candidate) => candidate.direction === timing.segmentId);
      if (arc) {
        const earliestDepartureUT = endpointAvailableUT === undefined
          ? undefined
          : endpointAvailableUT + timing.preInterplanetaryTransferTime;
        if (earliestDepartureUT !== undefined) earliestDepartures[timing.segmentId] = earliestDepartureUT;
        const solution = selectedTransferSolutions[timing.segmentId];
        if (solutionMatchesArc(solution, arc, earliestDepartureUT)) {
          resolvedDirections.add(timing.segmentId);
          finalEndpointArrivalUT = solution!.arrivalUT + timing.postInterplanetaryTransferTime;
          endpointAvailableUT = finalEndpointArrivalUT + stayDurationSeconds;
        } else {
          endpointAvailableUT = undefined;
          finalEndpointArrivalUT = undefined;
        }
        continue;
      }

      if (endpointAvailableUT === undefined) {
        finalEndpointArrivalUT = undefined;
        continue;
      }
      const departureUT = nextRecurringLocalDepartureUT(timing, endpointAvailableUT);
      const arrivalUT = departureUT + timing.modeledTransferTime;
      localTimelines[timing.segmentId] = {
        departureUT,
        arrivalUT,
        origin: timing.origin,
        destination: timing.destination,
        recurringWindow: timing.localWindow !== undefined,
      };
      finalEndpointArrivalUT = arrivalUT;
      endpointAvailableUT = arrivalUT + stayDurationSeconds;
    }

    return { earliestDepartures, finalEndpointArrivalUT, localTimelines, resolvedDirections };
  }, [planningStops, secondsPerSelectedDay, selectedTransferSolutions, transferArcs, transferTimings]);
  const earliestDepartureForSegment = (segmentId: string) => transferSequence.earliestDepartures[segmentId];
  // A capture strategy changes which porkchop point MechJeb should optimize, but
  // it does not invalidate an already selected trajectory. Keep the selected
  // dates and v-infinity while the plan recomputes the new capture burn.
  let signatureOrigin = serialRoute.start;
  const routeSegments = serialRoute.stops.map((stop, index) => {
    const signature = {
      id: stop.id,
      origin: signatureOrigin.bodyName,
      destination: stop.bodyName,
      originParkingAltitude: signatureOrigin.parkingAltitude,
      destinationParkingAltitude: stop.parkingAltitude,
      originStayDurationDays: index > 0 ? serialRoute.stops[index - 1].stayDurationDays ?? 1 : 0,
    };
    signatureOrigin = stop;
    return signature;
  });
  const routeSignature = JSON.stringify(routeSegments);

  useEffect(() => {
    const previousSegments: typeof routeSegments = transferRouteSignature.current
      ? JSON.parse(transferRouteSignature.current)
      : [];
    transferRouteSignature.current = routeSignature;
    if (previousSegments.length === 0) return;
    let firstChangedIndex = routeSegments.findIndex((segment, index) => JSON.stringify(segment) !== JSON.stringify(previousSegments[index]));
    if (firstChangedIndex < 0 && routeSegments.length !== previousSegments.length) firstChangedIndex = routeSegments.length;
    if (firstChangedIndex < 0) return;
    setIdealSequenceActive(false);
    const preserved = new Set(routeSegments.slice(0, firstChangedIndex).map((segment) => segment.id));
    setSelectedTransferSolutions((current) => Object.fromEntries(Object.entries(current).filter(([id]) => preserved.has(id))));
    setPorkchopGrids((current) => Object.fromEntries(Object.entries(current).filter(([id]) => preserved.has(id))));
    setSelectedPorkchopEvaluations((current) => Object.fromEntries(Object.entries(current).filter(([id]) => preserved.has(id))));
    setPorkchopDirection((current) => current && preserved.has(current) ? current : null);
    if (!preserved.has(activeTransferDirection)) setActiveTransferRequestId("");
  }, [activeTransferDirection, routeSignature, setSelectedPorkchopEvaluations, setSelectedTransferSolutions, transferRouteSignature]);

  const telemetryRequestId = telemetry?.["mj.transfer.requestId"] ?? "";
  const telemetryFingerprint = telemetry?.["mj.transfer.fingerprint"] ?? "";
  const transferState = telemetry?.["mj.transfer.state"] ?? "idle";
  const matchingResult = Boolean(activeTransferRequestId)
    && telemetryRequestId === activeTransferRequestId
    && telemetryFingerprint === activeTransferFingerprint;
  const liveResultNumbers = [
    telemetry?.["mj.transfer.departureUT"], telemetry?.["mj.transfer.arrivalUT"], telemetry?.["mj.transfer.transferTime"],
    telemetry?.["mj.transfer.ejectionDeltaV"], telemetry?.["mj.transfer.arrivalVInfinity"],
  ];
  const liveResultValid = liveResultNumbers.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const liveManeuverVectorAvailable = telemetry?.["mj.transfer.maneuverVectorSchema"] === 1
    && ["departureVInfinityX", "departureVInfinityY", "departureVInfinityZ"].every((field) => {
      const value = telemetry?.[`mj.transfer.${field}`];
      return typeof value === "number" && Number.isFinite(value);
    });
  const activeArc = transferArcs.find((arc) => arc.direction === activeTransferDirection);
  const activeSolution: LiveTransferSolution | undefined = matchingResult && transferState === "completed" && liveResultValid && activeArc ? {
    ...activeArc,
    arcId: activeArc.id,
    requestId: telemetryRequestId,
    fingerprint: telemetryFingerprint,
    departureUT: Number(telemetry?.["mj.transfer.departureUT"] ?? 0),
    arrivalUT: Number(telemetry?.["mj.transfer.arrivalUT"] ?? 0),
    transferTime: Number(telemetry?.["mj.transfer.transferTime"] ?? 0),
    ejectionDeltaV: Number(telemetry?.["mj.transfer.ejectionDeltaV"] ?? 0),
    arrivalVInfinity: Number(telemetry?.["mj.transfer.arrivalVInfinity"] ?? 0),
    ...(liveManeuverVectorAvailable ? {
      departureVInfinity: [
        Number(telemetry?.["mj.transfer.departureVInfinityX"]),
        Number(telemetry?.["mj.transfer.departureVInfinityY"]),
        Number(telemetry?.["mj.transfer.departureVInfinityZ"]),
      ] as [number, number, number],
      maneuverVectorSchema: 1 as const,
    } : {}),
  } : undefined;
  const liveSolution = activeTransferPurpose === "quick" ? activeSolution : undefined;
  const appliedTransferSolutions = useMemo(() => ({
    ...selectedTransferSolutions,
    ...(liveSolution ? { [activeTransferDirection]: liveSolution } : {}),
  }), [activeTransferDirection, liveSolution, selectedTransferSolutions]);

  useEffect(() => {
    if (!liveSolution || appliedQuickRequest.current === liveSolution.requestId) return;
    appliedQuickRequest.current = liveSolution.requestId;
    setSelectedTransferSolutions((current) => ({ ...current, [activeTransferDirection]: liveSolution }));
    liveTelemetryStore.send({ type: "mechjeb.transfer.release", requestId: liveSolution.requestId });
  }, [activeTransferDirection, liveSolution, setSelectedTransferSolutions]);

  const calculation = useMemo(() => {
    try {
      return { plan: calculateSerialDeltaVPlan({ ...serialRoute, customSteps, marginPercent, selectedTransferSolutions: appliedTransferSolutions }), error: "" };
    } catch (error) {
      return { plan: null, error: error instanceof Error ? error.message : "Unable to calculate this mission budget." };
    }
  }, [appliedTransferSolutions, customSteps, marginPercent, serialRoute]);

  const plan = calculation.plan;
  const committedStopActionsByLegId = useMemo(() => {
    const actions = new Map<string, { stopId: string; stopIndex: number }>();
    if (!plan) return actions;
    const reversedLegs = [...plan.legs].reverse();
    stops.forEach((stop, stopIndex) => {
      const completionLeg = reversedLegs.find((leg) => leg.arrival === stop.id)
        ?? reversedLegs.find((leg) => leg.id === stop.id || leg.id.startsWith(`${stop.id}-`));
      if (completionLeg) actions.set(completionLeg.id, { stopId: stop.id, stopIndex });
    });
    return actions;
  }, [plan, stops]);
  const suggestedPlanName = `${origin.name}${resolvedStops.map((stop) => ` → ${stop.body.name}`).join("")} mission`;
  const updateArrival = (segmentId: string, patch: Partial<ArrivalStrategy>) => {
    if (!editingStopId && segmentId === nextStop.id) {
      setNextStop((current) => ({ ...current, arrivalStrategy: { ...current.arrivalStrategy, ...patch } }));
      return;
    }
    updateStop(segmentId, (current) => ({ ...current, arrivalStrategy: { ...current.arrivalStrategy, ...patch } }));
  };
  const updateStayDuration = (segmentId: string, value: number) => {
    const stayDurationDays = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
    if (!editingStopId && segmentId === nextStop.id) {
      setNextStop((current) => ({ ...current, stayDurationDays }));
      return;
    }
    updateStop(segmentId, (current) => ({ ...current, stayDurationDays }));
  };
  const loadSavedPlan = (id: string) => {
    const record = savedPlans.find((candidate) => candidate.id === id);
    if (!record) return;
    loadPlan(id);
    setPlanName(record.name);
    setSaveError(false);
    setSavedNotice(`Loaded ${record.name}`);
    onCloseSavedPlans();
  };
  const saveCurrentPlan = (asNew = false) => {
    if (!plan) return;
    const name = planName.trim() || suggestedPlanName;
    const localTransferTimeline = Object.fromEntries(
      Object.entries(transferSequence.localTimelines).flatMap(([segmentId, timeline]) => timeline ? [[segmentId, {
        arcId: segmentId,
        direction: segmentId,
        departureUT: timeline.departureUT,
        arrivalUT: timeline.arrivalUT,
        transferTime: timeline.arrivalUT - timeline.departureUT,
        origin: timeline.origin,
        destination: timeline.destination,
      }]] : []),
    );
    const result = savePlan({
      ...plan,
      transferTimeline: { ...localTransferTimeline, ...plan.transferTimeline },
    }, name, { asNew, saveFolder: currentSaveFolder });
    if (result.status === "duplicate") {
      setSaveError(true);
      setSavedNotice(`A saved plan named ${result.name} already exists. Update it or choose another name.`);
      return;
    }
    setPlanName(result.name);
    setSaveError(false);
    setSavedNotice(result.status === "updated" ? `Updated ${result.name}` : `Saved ${result.name}`);
  };
  const addCustomStep = (afterLegId: string) => {
    const id = `custom-${nextCustomStep.current++}`;
    setCustomSteps((current) => [...current, { id, afterLegId, label: "Maneuver adjustment", deltaV: 0 }]);
  };
  const updateCustomStep = (id: string, patch: Partial<CustomDeltaVStep>) => {
    setCustomSteps((current) => current.map((step) => step.id === id ? { ...step, ...patch } : step));
  };
  const removeCustomStep = (id: string) => {
    setCustomSteps((current) => {
      const removed = current.find((step) => step.id === id);
      if (!removed) return current;
      return current.filter((step) => step.id !== id).map((step) => step.afterLegId === id ? { ...step, afterLegId: removed.afterLegId } : step);
    });
  };
  const endpointSummary = (endpoint: MissionEndpoint) => endpoint === "surface" ? "surface" : "parking orbit";
  const profileSummary = `${liveCatalogActive ? "Live KSP catalog" : "Offline fallback"} · ${origin.name} ${endpointSummary(start.endpoint)}${resolvedStops.map((stop) => ` → ${stop.body.name} ${endpointSummary(stop.endpoint)}`).join("")}`;
  const serviceReady = telemetry?.["mj.transfer.available"] === true && telemetry?.["mj.transfer.compatibilityReady"] === true;
  const backendRequestIsActive = Boolean(activeTransferRequestId) && telemetryRequestId === activeTransferRequestId;
  const transferRunning = connection.status === "linked" && Boolean(activeTransferRequestId) && (!backendRequestIsActive || transferState === "starting" || transferState === "running" || transferState === "cancelling");
  const resolvedArcCount = transferSequence.resolvedDirections.size;
  const allIdealArcsResolved = transferArcs.length > 0 && resolvedArcCount === transferArcs.length;
  const advancedPlanIncomplete = transferMode === "advanced"
    && transferArcs.some((arc) => !transferSequence.resolvedDirections.has(arc.direction));
  const activeArcIndex = transferArcs.findIndex((arc) => arc.direction === activeTransferDirection);
  const canCalculateLive = transferMode === "simple" && transferArcs.length > 0 && serviceReady && !transferRunning;
  const startArcTransfer = (arc: TransferArcDescriptor, purpose: "quick" | "plot") => {
    if (!serviceReady || transferRunning) return false;
    const segmentIndex = planningStops.findIndex((stop) => stop.id === arc.direction);
    const previousArc = transferArcs.filter((candidate) => planningStops.findIndex((stop) => stop.id === candidate.direction) < segmentIndex).at(-1);
    const earliestDepartureUT = earliestDepartureForSegment(arc.direction);
    if (previousArc && earliestDepartureUT === undefined) {
      setSendError(`Choose the ${previousArc.label} transfer before calculating this segment.`);
      return false;
    }
    const fingerprint = fingerprintForArc(system, arc, earliestDepartureUT);
    const requestId = globalThis.crypto?.randomUUID?.() ?? `transfer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setSendError("");
    const sent = liveTelemetryStore.send({
      type: "mechjeb.transfer.start",
      requestId,
      fingerprint,
      origin: arc.origin,
      destination: arc.destination,
      originParkingAltitude: arc.originParkingAltitude,
      optimizePoweredCapture: arc.optimizePoweredCapture,
      ...(earliestDepartureUT !== undefined ? { earliestDepartureUT } : {}),
    });
    if (!sent) {
      setSendError("Unable to send the MechJeb request; the dashboard is not linked.");
      return false;
    }
    setActiveTransferRequestId(requestId);
    setActiveTransferDirection(arc.direction);
    setActiveTransferFingerprint(fingerprint);
    setActiveTransferPurpose(purpose);
    if (purpose === "plot") {
      setPorkchopGrids((current) => ({ ...current, [arc.direction]: undefined }));
      requestedGridRequest.current = "";
      acknowledgedGridRequest.current = "";
    }
    return true;
  };
  const startLiveTransfer = () => {
    if (!canCalculateLive) return;
    setSendError("");
    if (allIdealArcsResolved) {
      const arcDirections = new Set(transferArcs.map((arc) => arc.direction));
      setSelectedTransferSolutions((current) => Object.fromEntries(Object.entries(current).filter(([direction]) => !arcDirections.has(direction))));
      setActiveTransferRequestId("");
      appliedQuickRequest.current = "";
    }
    setIdealSequenceActive(true);
  };
  const cancelLiveTransfer = () => {
    setIdealSequenceActive(false);
    if (!activeTransferRequestId) return;
    const requestId = activeTransferRequestId;
    if (!liveTelemetryStore.send({ type: "mechjeb.transfer.cancel", requestId })) {
      setSendError("Unable to send the cancellation request; the dashboard is not linked.");
      return;
    }
    setActiveTransferRequestId("");
  };
  const selectTransferMode = (mode: TransferPlanningMode) => {
    if (mode === transferMode) return;
    setSendError("");
    setIdealSequenceActive(false);
    if (transferRunning) cancelLiveTransfer();
    if (mode === "simple") setPorkchopDirection(null);
    setTransferMode(mode);
  };

  useEffect(() => {
    if (!idealSequenceActive || transferMode !== "simple" || !serviceReady || transferRunning) return;
    if (backendRequestIsActive && transferState === "failed") {
      setIdealSequenceActive(false);
      return;
    }
    if (liveSolution && selectedTransferSolutions[activeTransferDirection]?.requestId !== liveSolution.requestId) return;
    const nextArc = transferArcs.find((arc) => !transferSequence.resolvedDirections.has(arc.direction));
    if (!nextArc) {
      setIdealSequenceActive(false);
      return;
    }
    if (!startArcTransfer(nextArc, "quick")) setIdealSequenceActive(false);
  }, [activeTransferDirection, backendRequestIsActive, idealSequenceActive, liveSolution, selectedTransferSolutions, serviceReady, transferArcs, transferMode, transferRunning, transferSequence.resolvedDirections, transferState]);

  const modalArc = porkchopDirection ? transferArcs.find((arc) => arc.direction === porkchopDirection) : undefined;
  const cachedModalGrid = porkchopDirection ? porkchopGrids[porkchopDirection] : undefined;
  const modalEarliestDepartureUT = modalArc ? earliestDepartureForSegment(modalArc.direction) : undefined;
  const modalSegmentIndex = modalArc ? planningStops.findIndex((stop) => stop.id === modalArc.direction) : -1;
  const modalPreviousArc = transferArcs.filter((arc) => planningStops.findIndex((stop) => stop.id === arc.direction) < modalSegmentIndex).at(-1);
  const modalExpectedFingerprint = modalArc
    ? fingerprintForArc(system, modalArc, modalEarliestDepartureUT)
    : "";
  const modalGrid = cachedModalGrid?.fingerprint === modalExpectedFingerprint ? cachedModalGrid : undefined;
  const modalSelectedEvaluation = modalArc && selectedPorkchopEvaluations[modalArc.direction]?.fingerprint === modalExpectedFingerprint
    ? selectedPorkchopEvaluations[modalArc.direction]
    : undefined;
  const evaluationVectorAvailable = ["departureVInfinityX", "departureVInfinityY", "departureVInfinityZ"].every((field) => {
    const value = telemetry?.[`mj.transfer.evaluation.${field}`];
    return typeof value === "number" && Number.isFinite(value);
  });
  const evaluationMatches = Boolean(modalArc)
    && activeTransferDirection === modalArc?.direction
    && activeTransferFingerprint === modalExpectedFingerprint
    && telemetry?.["mj.transfer.evaluation.requestId"] === activeTransferRequestId
    && telemetry?.["mj.transfer.evaluation.fingerprint"] === activeTransferFingerprint
    && typeof telemetry?.["mj.transfer.evaluation.departureIndex"] === "number"
    && typeof telemetry?.["mj.transfer.evaluation.transferTimeIndex"] === "number"
    && ["departureUT", "arrivalUT", "transferTime", "ejectionDeltaV", "arrivalVInfinity", "rawCost"].every((field) => {
      const value = telemetry?.[`mj.transfer.evaluation.${field}`];
      return typeof value === "number" && Number.isFinite(value) && value >= 0;
    });
  const modalEvaluation: PorkchopEvaluation | undefined = evaluationMatches ? {
    requestId: String(telemetry?.["mj.transfer.evaluation.requestId"]),
    fingerprint: String(telemetry?.["mj.transfer.evaluation.fingerprint"]),
    departureIndex: Number(telemetry?.["mj.transfer.evaluation.departureIndex"]),
    transferTimeIndex: Number(telemetry?.["mj.transfer.evaluation.transferTimeIndex"]),
    departureUT: Number(telemetry?.["mj.transfer.evaluation.departureUT"]),
    arrivalUT: Number(telemetry?.["mj.transfer.evaluation.arrivalUT"]),
    transferTime: Number(telemetry?.["mj.transfer.evaluation.transferTime"]),
    ejectionDeltaV: Number(telemetry?.["mj.transfer.evaluation.ejectionDeltaV"]),
    arrivalVInfinity: Number(telemetry?.["mj.transfer.evaluation.arrivalVInfinity"]),
    rawCost: Number(telemetry?.["mj.transfer.evaluation.rawCost"]),
    ...(evaluationVectorAvailable ? {
      departureVInfinity: [
        Number(telemetry?.["mj.transfer.evaluation.departureVInfinityX"]),
        Number(telemetry?.["mj.transfer.evaluation.departureVInfinityY"]),
        Number(telemetry?.["mj.transfer.evaluation.departureVInfinityZ"]),
      ] as [number, number, number],
      maneuverVectorSchema: 1 as const,
    } : {}),
  } : undefined;

  useEffect(() => {
    if (activeTransferPurpose !== "plot" || porkchopDirection !== activeTransferDirection || activeTransferFingerprint !== modalExpectedFingerprint || transferState !== "completed" || !matchingResult || !activeTransferRequestId) return;
    if (modalGrid?.requestId === activeTransferRequestId) return;
    if (requestedGridRequest.current === activeTransferRequestId) return;
    if (liveTelemetryStore.send({ type: "mechjeb.transfer.grid.request", requestId: activeTransferRequestId, fingerprint: activeTransferFingerprint })) {
      requestedGridRequest.current = activeTransferRequestId;
    }
  }, [activeTransferDirection, activeTransferFingerprint, activeTransferPurpose, activeTransferRequestId, matchingResult, modalExpectedFingerprint, modalGrid?.requestId, porkchopDirection, transferState]);

  useEffect(() => {
    if (!porkchopDirection || porkchopDirection !== activeTransferDirection || activeTransferFingerprint !== modalExpectedFingerprint || telemetry?.["mj.transfer.grid.published"] !== true) return;
    const requestId = telemetry?.["mj.transfer.grid.requestId"];
    const fingerprint = telemetry?.["mj.transfer.grid.fingerprint"];
    const dateSamples = telemetry?.["mj.transfer.grid.dateSamples"];
    const durationSamples = telemetry?.["mj.transfer.grid.durationSamples"];
    const departureUTs = telemetry?.["mj.transfer.grid.departureUTs"];
    const transferTimes = telemetry?.["mj.transfer.grid.transferTimes"];
    const costs = telemetry?.["mj.transfer.grid.costs"];
    const bestDepartureIndex = telemetry?.["mj.transfer.grid.bestDepartureIndex"];
    const bestTransferTimeIndex = telemetry?.["mj.transfer.grid.bestTransferTimeIndex"];
    if (requestId !== activeTransferRequestId || fingerprint !== activeTransferFingerprint
      || typeof dateSamples !== "number" || typeof durationSamples !== "number"
      || !Array.isArray(departureUTs) || !Array.isArray(transferTimes) || !Array.isArray(costs)
      || typeof bestDepartureIndex !== "number" || typeof bestTransferTimeIndex !== "number") return;
    const grid: PorkchopGrid = { requestId, fingerprint, dateSamples, durationSamples, departureUTs, transferTimes, costs, bestDepartureIndex, bestTransferTimeIndex };
    setPorkchopGrids((current) => ({ ...current, [activeTransferDirection]: grid }));
    if (acknowledgedGridRequest.current !== requestId) {
      acknowledgedGridRequest.current = requestId;
      liveTelemetryStore.send({ type: "mechjeb.transfer.evaluate", requestId, fingerprint, departureIndex: bestDepartureIndex, transferTimeIndex: bestTransferTimeIndex });
      liveTelemetryStore.send({ type: "mechjeb.transfer.grid.ack", requestId });
    }
  }, [activeTransferDirection, activeTransferFingerprint, activeTransferRequestId, modalExpectedFingerprint, porkchopDirection, telemetry]);

  const evaluatePorkchopCell = (cell: PorkchopCell) => {
    if (!modalGrid) return;
    liveTelemetryStore.send({ type: "mechjeb.transfer.evaluate", requestId: modalGrid.requestId, fingerprint: modalGrid.fingerprint, departureIndex: cell.departureIndex, transferTimeIndex: cell.transferTimeIndex });
  };
  const usePorkchopEvaluation = (evaluation: PorkchopEvaluation) => {
    if (!modalArc) return;
    const solution: LiveTransferSolution = {
      ...modalArc,
      arcId: modalArc.id,
      requestId: evaluation.requestId,
      fingerprint: evaluation.fingerprint,
      departureUT: evaluation.departureUT,
      arrivalUT: evaluation.arrivalUT,
      transferTime: evaluation.transferTime,
      ejectionDeltaV: evaluation.ejectionDeltaV,
      arrivalVInfinity: evaluation.arrivalVInfinity,
      ...(evaluation.departureVInfinity ? {
        departureVInfinity: evaluation.departureVInfinity,
        maneuverVectorSchema: 1 as const,
      } : {}),
    };
    setSelectedTransferSolutions((current) => ({ ...current, [modalArc.direction]: solution }));
    setSelectedPorkchopEvaluations((current) => ({ ...current, [modalArc.direction]: evaluation }));
    liveTelemetryStore.send({ type: "mechjeb.transfer.release", requestId: evaluation.requestId });
    setPorkchopDirection(null);
  };
  const closePorkchop = () => {
    if (activeTransferPurpose === "plot" && activeTransferRequestId && matchingResult && transferState === "completed") {
      liveTelemetryStore.send({ type: "mechjeb.transfer.release", requestId: activeTransferRequestId });
    }
    setPorkchopDirection(null);
  };
  useEffect(() => {
    if (activeTransferPurpose !== "plot" || porkchopDirection || !activeTransferRequestId || !matchingResult) return;
    if (!["completed", "failed", "cancelled"].includes(transferState)) return;
    liveTelemetryStore.send({ type: "mechjeb.transfer.release", requestId: activeTransferRequestId });
  }, [activeTransferPurpose, activeTransferRequestId, matchingResult, porkchopDirection, transferState]);
  const openPorkchop = (arc: TransferArcDescriptor) => {
    if (transferMode !== "advanced") return;
    setIdealSequenceActive(false);
    const cached = porkchopGrids[arc.direction];
    const expectedFingerprint = fingerprintForArc(system, arc, earliestDepartureForSegment(arc.direction));
    const cachedGridIsCurrent = cached?.fingerprint === expectedFingerprint;
    if (cached && !cachedGridIsCurrent) {
      setPorkchopGrids((current) => ({ ...current, [arc.direction]: undefined }));
    }
    setSendError("");
    setPorkchopDirection(arc.direction);
    // Closing or applying a porkchop releases the MechJeb planner owner. A
    // cached grid is still useful visually, but its old request can no longer
    // evaluate another cell. Reacquire the same calculation automatically so
    // reopening an existing plot remains selectable.
    if (cachedGridIsCurrent) startArcTransfer(arc, "plot");
  };
  const datedTransfers = plan
    ? Object.values(plan.transferTimeline).flatMap((entry) => entry ? [entry] : []).sort((left, right) => left.departureUT - right.departureUT)
    : [];
  const missionDepartureUT = datedTransfers[0]?.departureUT;
  const missionArrivalUT = transferSequence.finalEndpointArrivalUT;
  const missionElapsedSeconds = missionDepartureUT !== undefined
    && missionArrivalUT !== undefined
    && missionArrivalUT >= missionDepartureUT
    ? missionArrivalUT - missionDepartureUT
    : undefined;
  const surfaceStopCount = planningStops.filter((stop) => stop.endpoint === "surface").length;
  const routeHeading = plan && plan.origin.name === plan.destination.name && planningStops.length > 1
    ? `${plan.origin.name} round trip`
    : plan ? `${plan.origin.name} → ${plan.destination.name}` : "";
  const saveControls = plan ? <div className="delta-v-save-bar">
    <label><span>Plan name:</span><input aria-label="Delta-v plan name" placeholder={suggestedPlanName} value={planName} onChange={(event) => { setPlanName(event.target.value); setSaveError(false); setSavedNotice(""); }} /></label>
    <div className="delta-v-save-actions">
      <button disabled={advancedPlanIncomplete} onClick={() => saveCurrentPlan(false)} type="button">{activeSavedPlanId ? "Update plan" : "Save plan"}</button>
      {activeSavedPlanId && <button className="secondary" disabled={advancedPlanIncomplete} onClick={() => saveCurrentPlan(true)} type="button">Save as new</button>}
    </div>
    {savedNotice && <small className={saveError ? "error" : undefined} role={saveError ? "alert" : "status"}>{savedNotice}</small>}
  </div> : null;
  const renderSavedPlan = (record: SavedDeltaVPlanRecord) => {
    const isPinned = pinned?.id === record.id;
    const isLoaded = activeSavedPlanId === record.id;
    const routeNames = [record.draft.start.bodyName, ...record.draft.stops.map((stop) => stop.bodyName), ...(!record.draft.editingStopId && record.draft.nextStop.bodyName ? [record.draft.nextStop.bodyName] : [])];
    return <article className={[isPinned ? "pinned" : "", isLoaded ? "loaded" : ""].filter(Boolean).join(" ")} key={record.id}>
      <div><strong>{record.name}</strong><span>{routeNames.join(" → ")} · {formatDeltaV(record.plan.totalDeltaV)}</span></div>
      <div className="delta-v-plan-library-actions">
        <button onClick={() => loadSavedPlan(record.id)} type="button">Load</button>
        {mode !== "inactive" && <button className={isPinned ? "active" : ""} disabled={isPinned} onClick={() => pinPlan(record.id, telemetry)} type="button">{isPinned ? "Pinned to this craft" : mode === "editor" ? "Pin to Editor craft" : "Pin to active vessel"}</button>}
        <button aria-label={`Delete ${record.name}`} className="delete" onClick={() => deletePlan(record.id)} type="button">Delete</button>
      </div>
    </article>;
  };

  return <div className="delta-v-planner">
    {saveTarget && saveControls ? createPortal(saveControls, saveTarget) : null}
    <div className={`delta-v-configuration ${profileOpen ? "" : "collapsed"}`}>
      <button aria-controls="delta-v-profile-controls" aria-expanded={profileOpen} className="delta-v-configuration-toggle" onClick={() => setProfileOpen((current) => !current)} type="button">
        <span><b>SYSTEM PROFILE &amp; MISSION SETUP</b><small>{profileSummary}</small></span>
        <strong>{profileOpen ? "COLLAPSE" : "EXPAND"}<i aria-hidden="true">{profileOpen ? "▴" : "▾"}</i></strong>
      </button>
      {profileOpen && <section className="delta-v-controls" id="delta-v-profile-controls">
      {!startLocked && <div className={`delta-v-location-row delta-v-start-row endpoint-${start.endpoint}`}>
        <BodySelect bodies={bodies} label="Start" onChange={selectStart} value={origin.name} />
        <EndpointControl body={origin} endpoint={start.endpoint} groupName="mission-start" label="Start from" onChange={(endpoint) => setStart((current) => ({ ...current, endpoint }))} />
        {start.endpoint === "orbit" && <ParkingAltitudeInput body={origin} label="Start parking altitude" onChange={(parkingAltitude) => setStart((current) => ({ ...current, parkingAltitude }))} unit={unit} value={start.parkingAltitude} />}
      </div>}
      {startLocked && <div className={`delta-v-location-row delta-v-stop-builder ${editingStopId ? "editing" : ""} ${nextStopBody ? `endpoint-${nextStop.endpoint}` : ""}`}>
        <BodySelect bodies={bodies} label={editingStopId ? "Edit stop" : "Next stop"} onChange={selectNextStop} placeholder="Choose next body…" value={nextStop.bodyName} />
        {nextStopBody ? <>
          <EndpointControl body={nextStopBody} endpoint={nextStop.endpoint} groupName="next-mission-stop" label="Arrive at" onChange={(endpoint) => setNextStop((current) => ({ ...current, endpoint }))} />
          {nextStop.endpoint === "orbit" && <ParkingAltitudeInput body={nextStopBody} label={editingStopId ? "Edited stop parking altitude" : "Next stop parking altitude"} onChange={(parkingAltitude) => setNextStop((current) => ({ ...current, parkingAltitude }))} unit={unit} value={nextStop.parkingAltitude} />}
        </> : <div className="delta-v-empty-stop"><span>ARRIVAL PROFILE</span><strong>Choose a body to configure the next stop.</strong></div>}
      </div>}
      <div className="delta-v-mission-row one-way">
        <fieldset><legend>Transfer planning</legend><div className="resonant-segments delta-v-transfer-mode">
          <label><input checked={transferMode === "simple"} name="transfer-planning-mode" type="radio" onChange={() => selectTransferMode("simple")} /><span>Simple</span></label>
          <label><input checked={transferMode === "advanced"} name="transfer-planning-mode" type="radio" onChange={() => selectTransferMode("advanced")} /><span>Advanced</span></label>
        </div><small>Simple: ideal dates · Advanced: per-leg porkchops</small></fieldset>
        <label><span>Planning margin</span><div className="resonant-input-unit"><input min="0" max="100" step="1" type="number" value={marginPercent} onChange={(event) => setMarginPercent(Number(event.target.value))} /><span>%</span></div></label>
        <div className="delta-v-add-stop-row">
          <button disabled={startLocked && !nextStopBody} onClick={startLocked ? addStop : lockStart} title={editingStopId ? "Update this route stop" : startLocked ? "Add this stop and keep the builder ready for the next leg" : "Lock the mission start and configure the first destination"} type="button">{editingStopId ? "Update stop" : "+ Add next stop"}</button>
          {editingStopId && <button className="secondary" onClick={cancelStopEdit} type="button">Cancel edit</button>}
        </div>
      </div>
      </section>}
    </div>

    {savedPlansOpen && <div className="delta-v-modal-backdrop" onMouseDown={onCloseSavedPlans}>
      <section aria-labelledby="delta-v-saved-plans-title" aria-modal="true" className="delta-v-modal delta-v-plan-library-modal" onMouseDown={(event) => event.stopPropagation()} ref={savedPlansDialogRef} role="dialog" tabIndex={-1}>
        <header><div><span>PLAN LIBRARY</span><h3 id="delta-v-saved-plans-title">Saved Delta-V plans</h3></div><div className="delta-v-plan-library-header-actions"><button aria-label="Close saved plans" onClick={onCloseSavedPlans} type="button">×</button><label><input checked={loadFromAllSaves} type="checkbox" onChange={(event) => setLoadFromAllSaves(event.target.checked)} /><span>LOAD FROM ALL SAVES</span></label></div></header>
        <p>{mode === "flight" ? "Load a mission or pin it to Flight for reference." : mode === "editor" ? "Load a mission or pin it beside the Editor craft summary." : "Saved missions remain in this dashboard browser until deleted."}</p>
        {visibleSavedPlans.length === 0
          ? <div className="delta-v-plan-library-empty">
            <span>{loadFromAllSaves ? "No saved Delta-V plans yet." : `No saved Delta-V plans for ${currentSaveFolder || "the active save"}.`}</span>
            {!loadFromAllSaves && currentSaveFolder && unlinkedSavedPlans.length > 0 && <button onClick={() => linkPlansToSave(unlinkedSavedPlans.map((record) => record.id), currentSaveFolder)} type="button">LINK {unlinkedSavedPlans.length} UNLINKED PLAN{unlinkedSavedPlans.length === 1 ? "" : "S"} TO {currentSaveFolder}</button>}
          </div>
          : loadFromAllSaves
            ? <div className="delta-v-plan-library-list grouped">{savedPlanGroups.map(([saveFolder, records]) => <section className="delta-v-plan-library-group" key={saveFolder || "unlinked"}>
              <div className="delta-v-plan-library-group-heading">
                <h4>{saveFolder || "UNLINKED"}</h4>
                {!saveFolder && currentSaveFolder && <button onClick={() => linkPlansToSave(records.map((record) => record.id), currentSaveFolder)} type="button">LINK ALL TO {currentSaveFolder}</button>}
              </div>
              {records.map(renderSavedPlan)}
            </section>)}</div>
            : <div className="delta-v-plan-library-list">{visibleSavedPlans.map(renderSavedPlan)}</div>}
      </section>
    </div>}

    {calculation.error && <div className="resonant-error delta-v-error" role="alert">{calculation.error}</div>}
    {plan && <div className="delta-v-output">
      <section className="delta-v-summary">
        <header><div><span>PLANNING BUDGET</span><h3>{routeHeading}</h3></div><strong>{transferMode.toUpperCase()} + {marginPercent}%</strong></header>
        <div className="delta-v-total"><span>Total mission budget</span><strong className={advancedPlanIncomplete ? "delta-v-incomplete-bumper" : undefined}>{advancedPlanIncomplete ? "INCOMPLETE" : formatDeltaV(plan.totalDeltaV)}</strong><small>{planningStops.length} mission stop{planningStops.length === 1 ? "" : "s"} · {surfaceStopCount} surface stop{surfaceStopCount === 1 ? "" : "s"} · {plan.legs.length} modeled legs</small></div>
        <div className="delta-v-stat-grid">
          <article><span>Nominal route</span><strong className={advancedPlanIncomplete ? "delta-v-incomplete-bumper" : undefined}>{advancedPlanIncomplete ? "INCOMPLETE" : formatDeltaV(plan.nominalDeltaV)}</strong><small>Before planning margin</small></article>
          <article><span>Margin</span><strong className={advancedPlanIncomplete ? "delta-v-incomplete-bumper" : undefined}>{advancedPlanIncomplete ? "INCOMPLETE" : `+${formatDeltaV(plan.marginDeltaV)}`}</strong><small>User-selected reserve</small></article>
          <article><span>Landing</span><strong>{formatDeltaV(plan.landingDeltaV)}</strong><small>{surfaceStopCount === 0 ? "No surface stops" : plan.atmosphericAssistance ? "Selected steps assisted" : "Powered descent"}</small></article>
          <article><span>Ideal phase</span><strong>{plan.phaseAngle === null ? "n/a" : `${plan.phaseAngle.toFixed(1)}°`}</strong><small>First-transfer Hohmann reference</small></article>
        </div>
      </section>

      <section className="delta-v-route" aria-label="Delta-v route breakdown">
        <header>
          <span>MISSION ROUTE</span>
          <div className="delta-v-route-timing">
            <div><span>First depart</span><strong>{missionDepartureUT === undefined ? "NOT DATED" : formatMissionUT(missionDepartureUT, kerbinTime)}</strong></div>
            <div><span>Final arrive</span><strong>{missionArrivalUT === undefined ? "NOT DATED" : formatMissionUT(missionArrivalUT, kerbinTime)}</strong></div>
            <div><span>Mission time</span><strong>{missionElapsedSeconds === undefined ? "NOT DATED" : formatTransferDuration(missionElapsedSeconds, kerbinTime)}</strong></div>
          </div>
          {transferMode === "simple" && transferArcs.length > 0 && <div className="delta-v-route-window-actions">
            {idealSequenceActive || transferRunning ? <>
              <span>{transferState === "cancelling" ? "CANCELLING" : `CALCULATING ${Math.max(1, activeArcIndex + 1)}/${transferArcs.length} · ${Math.max(0, Math.min(100, Number(telemetry?.["mj.transfer.progress"] ?? 0)))}%`}</span>
              <button type="button" onClick={cancelLiveTransfer}>Cancel</button>
            </> : <button disabled={!canCalculateLive} title={!serviceReady ? "WoobiesMechJeb transfer service not available." : undefined} type="button" onClick={startLiveTransfer}>{allIdealArcsResolved ? "Recalculate ideal windows" : resolvedArcCount > 0 ? "Calculate remaining ideal windows" : "Calculate ideal windows"}</button>}
          </div>}
        </header>
        {transferMode === "simple" && (sendError || (matchingResult && transferState === "failed" && telemetry?.["mj.transfer.error"])) && <p className="delta-v-route-window-error" role="alert">{sendError || String(telemetry?.["mj.transfer.error"])}</p>}
        <div className="delta-v-route-list">{plan.legs.map((leg, index) => {
          const arc = transferArcs.find((candidate) => candidate.routeLegId === leg.id);
          const transferArc = leg.transferArcId ? transferArcs.find((candidate) => candidate.id === leg.transferArcId) : undefined;
          const incompleteAdvancedLeg = transferMode === "advanced"
            && transferArc !== undefined
            && !transferSequence.resolvedDirections.has(transferArc.direction);
          const segmentId = planningStops.find((stop) => leg.id === stop.id || leg.id.startsWith(`${stop.id}-`))?.id;
          const selectedTimeline = leg.transferArcId ? Object.values(plan.transferTimeline).find((entry) => entry?.arcId === leg.transferArcId) : undefined;
          const modeledTimeline = segmentId ? transferSequence.localTimelines[segmentId] : undefined;
          const displayedTimeline = incompleteAdvancedLeg ? undefined : selectedTimeline ?? modeledTimeline;
          const earliestDepartureUT = arc ? earliestDepartureForSegment(arc.direction) : undefined;
          const timelineConflict = selectedTimeline && earliestDepartureUT !== undefined && selectedTimeline.departureUT < earliestDepartureUT;
          const arrivalStop = leg.arrival ? planningStops.find((stop) => stop.id === leg.arrival) : undefined;
          const arrivalStrategy = arrivalStop?.arrivalStrategy;
          const arrivalStopIndex = arrivalStop ? planningStops.findIndex((stop) => stop.id === arrivalStop.id) : -1;
          const nextStop = arrivalStopIndex >= 0 ? planningStops[arrivalStopIndex + 1] : undefined;
          const nextTransferArc = nextStop ? transferArcs.find((candidate) => candidate.direction === nextStop.id) : undefined;
          const nextAdvancedLegIncomplete = transferMode === "advanced"
            && nextTransferArc !== undefined
            && !transferSequence.resolvedDirections.has(nextTransferArc.direction);
          const nextTimeline = nextStop && !nextAdvancedLegIncomplete
            ? plan.transferTimeline[nextStop.id] ?? transferSequence.localTimelines[nextStop.id]
            : undefined;
          const segmentStopIndex = segmentId ? planningStops.findIndex((stop) => stop.id === segmentId) : -1;
          const stayStop = leg.kind === "departure" && segmentStopIndex >= 0 && segmentStopIndex < planningStops.length - 1
            ? planningStops[segmentStopIndex]
            : undefined;
          const committedStopAction = committedStopActionsByLegId.get(leg.id);
          const calculatedStay = committedStopAction
            && arrivalStop
            && committedStopAction.stopId === arrivalStop.id
            && displayedTimeline
            && nextTimeline
            && nextTimeline.departureUT >= displayedTimeline.arrivalUT
            ? (() => {
              const totalSeconds = nextTimeline.departureUT - displayedTimeline.arrivalUT;
              const plannedSeconds = Math.max(0, arrivalStop.stayDurationDays ?? 1) * secondsPerSelectedDay;
              return {
                totalSeconds,
                plannedSeconds,
                windowWaitSeconds: Math.max(0, totalSeconds - plannedSeconds),
              };
            })()
            : undefined;
          return <Fragment key={leg.id}>
          <article className={`delta-v-leg ${leg.kind} ${committedStopAction?.stopId === editingStopId ? "editing-stop" : ""}`}>
            <div className="delta-v-leg-marker"><span>{String(index + 1).padStart(2, "0")}</span><i /></div>
            {leg.custom ? <>
              <div className="delta-v-custom-label"><input aria-label={`Custom step ${index + 1} name`} value={customSteps.find((step) => step.id === leg.id)?.label ?? leg.label} onChange={(event) => updateCustomStep(leg.id, { label: event.target.value })} /><small>User-entered planning estimate</small></div>
              <div className="delta-v-custom-actions"><div className="resonant-input-unit"><input aria-label={`${leg.label} estimate`} min="0" step="10" type="number" value={customSteps.find((step) => step.id === leg.id)?.deltaV ?? leg.deltaV} onChange={(event) => updateCustomStep(leg.id, { deltaV: Number(event.target.value) })} /><span>m/s</span></div><button aria-label={`Remove ${leg.label}`} onClick={() => removeCustomStep(leg.id)} title="Remove custom step" type="button">×</button></div>
            </> : <>
              <div className={`delta-v-leg-copy ${stayStop ? "with-stay" : ""} ${calculatedStay ? "with-calculated-stay" : ""}`}>
                <div className="delta-v-leg-primary">
                  <div className="delta-v-leg-heading"><strong>{leg.label}{!incompleteAdvancedLeg && (leg.transferSource === "mechjeb" ? <em className="delta-v-live-badge">MECHJEB</em> : modeledTimeline ? <em className="delta-v-live-badge modeled">HOHMANN</em> : null)}</strong>{transferMode === "advanced" && arc && <button className="delta-v-porkchop-button" disabled={!serviceReady} onClick={() => openPorkchop(arc)} type="button">PORKCHOP</button>}</div>
                  {!incompleteAdvancedLeg && <small className="delta-v-leg-note">{leg.note}</small>}
                  {leg.atmosphericAssist === "aerocapture" && <div className="delta-v-leg-advisories">
                    <small className="delta-v-craft-note">Aerobraking is craft-dependent.</small>
                    {craftThermalProtection !== "detected" && <small className={`delta-v-thermal-note ${craftThermalProtection}`} role={craftThermalProtection === "not-detected" ? "alert" : undefined}>{craftThermalProtection === "not-detected" ? "No thermal protection detected. Aerobraking may be risky." : "Thermal Protection Recommended"}</small>}
                  </div>}
                  {displayedTimeline && leg.kind !== "capture" && <small className={`delta-v-leg-timeline ${timelineConflict ? "conflict" : ""}`}>Depart {formatMissionUT(displayedTimeline.departureUT, kerbinTime)} · arrive {formatMissionUT(displayedTimeline.arrivalUT, kerbinTime)}</small>}
                  {timelineConflict && <small className="delta-v-timeline-conflict" role="alert">This transfer departs before the preceding segment arrives; choose it again.</small>}
                  {leg.arrival && arrivalStrategy && <ArrivalStepControls leg={leg} strategy={arrivalStrategy} onChange={(patch) => updateArrival(leg.arrival!, patch)} />}
                </div>
                {stayStop && <div className="delta-v-stay-control">
                  <span>Stay at {stayStop.bodyName} after arrival</span>
                  <div>
                    <button aria-label={`Decrease stay at ${stayStop.bodyName}`} disabled={(stayStop.stayDurationDays ?? 1) <= 0} onClick={() => updateStayDuration(stayStop.id, (stayStop.stayDurationDays ?? 1) - 1)} type="button">−</button>
                    <label><input aria-label={`Stay at ${stayStop.bodyName}`} min="0" step="1" type="number" value={stayStop.stayDurationDays ?? 1} onChange={(event) => updateStayDuration(stayStop.id, Number(event.target.value))} /><span>days</span></label>
                    <button aria-label={`Increase stay at ${stayStop.bodyName}`} onClick={() => updateStayDuration(stayStop.id, (stayStop.stayDurationDays ?? 1) + 1)} type="button">+</button>
                  </div>
                </div>}
                {calculatedStay && <div className="delta-v-calculated-stay">
                  <span>CALCULATED STAY</span>
                  <strong>{formatCalculatedStay(calculatedStay.totalSeconds, kerbinTime)}</strong>
                  <small>{formatCalculatedStay(calculatedStay.plannedSeconds, kerbinTime)} planned{calculatedStay.windowWaitSeconds >= 60 ? ` · ${formatCalculatedStay(calculatedStay.windowWaitSeconds, kerbinTime)} window wait` : ""}</small>
                </div>}
              </div>
              <div className="delta-v-leg-side">
                <b className={incompleteAdvancedLeg ? "delta-v-incomplete-bumper" : undefined}>{incompleteAdvancedLeg ? "INCOMPLETE" : formatDeltaV(leg.deltaV)}</b>
                {committedStopAction && <div className="delta-v-route-stop-actions">
                  <button aria-label={`Edit stop ${committedStopAction.stopIndex + 1}`} onClick={() => editStop(committedStopAction.stopId)} type="button">EDIT</button>
                  <button aria-label={`Remove stop ${committedStopAction.stopIndex + 1}`} onClick={() => removeStop(committedStopAction.stopId)} title="Remove this mission stop" type="button">×</button>
                </div>}
              </div>
            </>}
          </article>
          <div className="delta-v-add-step"><button aria-label={`Add custom step after ${leg.label}`} onClick={() => addCustomStep(leg.id)} title="Add custom route step" type="button">+</button></div>
        </Fragment>})}</div>
      </section>
    </div>}
    {modalArc && <PorkchopPlotModal
      arcLabel={modalArc.label}
      constraintText={modalPreviousArc
        ? modalEarliestDepartureUT === undefined
          ? `Choose the ${modalPreviousArc.label} transfer first; its arrival sets this segment's earliest departure.`
          : `Departures begin after the preceding arrival and stay at ${formatMissionUT(modalEarliestDepartureUT, kerbinTime)}.`
        : modalSegmentIndex === 0 && planningStops.length > 1
          ? "This arrival will constrain the next dated transfer in the mission."
          : undefined}
      earliestDepartureUT={modalEarliestDepartureUT}
      error={sendError || String(telemetry?.["mj.transfer.grid.error"] ?? telemetry?.["mj.transfer.evaluation.error"] ?? "")}
      evaluation={modalEvaluation}
      grid={modalGrid}
      loading={transferRunning || (activeTransferPurpose === "plot" && activeTransferDirection === modalArc.direction && activeTransferFingerprint === modalExpectedFingerprint && matchingResult && transferState === "completed" && !modalGrid)}
      onClose={closePorkchop}
      onEvaluate={evaluatePorkchopCell}
      onGenerate={() => startArcTransfer(modalArc, "plot")}
      onUse={usePorkchopEvaluation}
      selected={modalSelectedEvaluation}
    />}
  </div>;
}
