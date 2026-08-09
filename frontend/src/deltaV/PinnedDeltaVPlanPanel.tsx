import { Fragment, useEffect, useState } from "react";
import { Panel } from "../components/Panel";
import { useResonantOrbitState } from "../resonantOrbit/state";
import {
  formatDistance,
  formatEccentricity,
  formatInclination,
} from "../formatting/numbers";
import { liveTelemetryStore } from "../telemetry/store";
import type { TelemetrySnapshot } from "../telemetry/types";
import { useLiveConnectionStatus, useLiveTelemetrySelector } from "../telemetry/useLiveTelemetry";
import { isKerbinTime, useTimeSystem } from "../timeSystem";
import {
  formatDeltaV,
  formatTransferDuration,
  type DeltaVLeg,
  type DeltaVPlan,
  type LiveTransferSolution,
} from "./calculations";
import { formatMissionUT } from "./PorkchopPlotModal";
import { useDeltaVDraft } from "./state";
import { thermalProtectionStatus } from "./thermalProtection";

const AUTO_COLLAPSE_ROUTE_THRESHOLD = 8;
const EDITOR_COLLAPSE_ROUTE_THRESHOLD = 7;

function timelineForLeg(plan: DeltaVPlan, leg: DeltaVLeg) {
  const timelines = Object.entries(plan.transferTimeline)
    .flatMap(([segmentId, timeline]) => timeline ? [{ segmentId, timeline }] : []);
  if (leg.transferArcId) {
    const matchingArc = timelines.find(({ timeline }) => timeline.arcId === leg.transferArcId);
    if (matchingArc) return matchingArc.timeline;
  }
  return timelines.find(({ segmentId }) => leg.arrival === segmentId
    || leg.id === segmentId
    || leg.id.startsWith(`${segmentId}-`))?.timeline;
}

function burnTimeForLeg(plan: DeltaVPlan, leg: DeltaVLeg) {
  if (leg.kind === "departure" && typeof leg.departureUT === "number") return leg.departureUT;
  if (leg.kind === "capture" && typeof leg.arrivalUT === "number") return leg.arrivalUT;
  const timeline = timelineForLeg(plan, leg);
  if (!timeline) return undefined;
  if (leg.kind === "departure") return timeline.departureUT;
  if (leg.kind === "capture") return timeline.arrivalUT;
  return undefined;
}

function relativeBurnTime(burnUT: number, currentUT: number, kerbinTime: boolean) {
  const difference = burnUT - currentUT;
  const absolute = Math.abs(difference);
  if (absolute < 60) return "NOW";
  const duration = absolute < 3_600
    ? `${Math.ceil(absolute / 60)}m`
    : formatTransferDuration(absolute, kerbinTime);
  return difference > 0 ? `T\u2212 ${duration}` : `${duration} overdue`;
}

function remainingBudget(plan: DeltaVPlan, visibleLegs: DeltaVLeg[]) {
  const remainingNominal = visibleLegs.reduce((sum, leg) => sum + leg.deltaV, 0);
  const marginRatio = plan.nominalDeltaV > 0 ? plan.marginDeltaV / plan.nominalDeltaV : 0;
  return remainingNominal * (1 + marginRatio);
}

function stageComparison(
  snapshot: TelemetrySnapshot | null,
  requiredDeltaV: number,
) {
  const availableDeltaV = snapshot?.["stage.totalDvVac"];
  if (snapshot?.["stage.pending"] || snapshot?.["stage.available"] === false
    || typeof availableDeltaV !== "number" || !Number.isFinite(availableDeltaV)) {
    return { availableDeltaV: undefined, difference: undefined, status: "unavailable" as const };
  }
  const difference = availableDeltaV - requiredDeltaV;
  if (difference < 0) return { availableDeltaV, difference, status: "shortfall" as const };
  if (requiredDeltaV > 0 && difference < Math.max(100, requiredDeltaV * 0.05)) {
    return { availableDeltaV, difference, status: "tight" as const };
  }
  return { availableDeltaV, difference, status: "surplus" as const };
}

function comparisonMessage(status: "unavailable" | "shortfall" | "tight" | "surplus") {
  if (status === "shortfall") return "Craft does not cover this plan.";
  if (status === "tight") return "Craft only narrowly covers this plan.";
  if (status === "surplus") return "Craft covers this plan.";
  return "Craft delta-v is unavailable.";
}

function orbitAltitude(value: number | undefined) {
  return formatDistance(value, "plan");
}

function selectedSolutionForLeg(
  solutions: Partial<Record<string, LiveTransferSolution>>,
  leg: DeltaVLeg | undefined,
) {
  if (!leg?.transferArcId) return undefined;
  return Object.values(solutions).find((solution) => solution?.arcId === leg.transferArcId);
}

function finiteTelemetryNumber(snapshot: TelemetrySnapshot | null, key: string) {
  const value = snapshot?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function newManeuverActionId(planId: string, legId: string) {
  const nonce = (globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`)
    .replaceAll("-", "")
    .slice(0, 16);
  return `${`${planId}:${legId}`.slice(0, 111)}:${nonce}`;
}

export function PinnedDeltaVPlanPanel({
  scene = "flight",
  snapshot: suppliedSnapshot,
}: {
  scene?: "flight" | "editor";
  snapshot?: TelemetrySnapshot | null;
}) {
  const { loadPlan, pinnedForTelemetry, rememberPinnedCraft, setPinnedStepComplete, unpinPlan } = useDeltaVDraft();
  const { openDeltaVDrawer } = useResonantOrbitState();
  const liveSnapshot = useLiveTelemetrySelector((state) => state.snapshot);
  const connection = useLiveConnectionStatus();
  const snapshot = connection.status === "linked"
    ? liveSnapshot
    : suppliedSnapshot === undefined ? liveSnapshot : suppliedSnapshot;
  const { system } = useTimeSystem();
  const [maneuverSendError, setManeuverSendError] = useState("");
  const [maneuverPreview, setManeuverPreview] = useState<{
    actionId: string;
    context: string;
  } | null>(null);
  const [routeExpanded, setRouteExpanded] = useState(false);
  const [readinessExpanded, setReadinessExpanded] = useState(scene !== "flight");
  const pinned = pinnedForTelemetry(snapshot);
  useEffect(() => rememberPinnedCraft(snapshot), [rememberPinnedCraft, snapshot]);
  useEffect(() => setRouteExpanded(false), [pinned?.id]);
  useEffect(() => setReadinessExpanded(scene !== "flight"), [pinned?.id, scene]);
  useEffect(() => {
    if (connection.status !== "linked") setManeuverPreview(null);
  }, [connection.status]);
  if (!pinned) return null;

  const { plan } = pinned;
  const kerbinTime = isKerbinTime(system);
  const completedLegIds = pinned.completedLegIds.filter((id) => plan.legs.some((leg) => leg.id === id));
  const completed = new Set(completedLegIds);
  const visibleLegs = scene === "flight" ? plan.legs.filter((leg) => !completed.has(leg.id)) : plan.legs;
  const remaining = remainingBudget(plan, visibleLegs);
  const comparisonRequirement = scene === "flight" ? remaining : plan.totalDeltaV;
  const comparison = stageComparison(snapshot, comparisonRequirement);
  const currentUT = snapshot?.["t.universalTime"];
  const hasAerocapture = visibleLegs.some((leg) => leg.atmosphericAssist === "aerocapture");
  const protection = thermalProtectionStatus(snapshot);
  const lastCompletedLegId = completedLegIds.at(-1);
  const firstIncompleteLeg = visibleLegs[0];
  const firstMissionAscentLeg = plan.legs.find((leg) => leg.kind === "ascent");
  const upcomingDepartureLeg = visibleLegs.find((leg) => leg.kind === "departure");
  const launchTransferLeg = upcomingDepartureLeg?.transferSource === "mechjeb"
    ? upcomingDepartureLeg
    : undefined;
  const launchTransferSolution = selectedSolutionForLeg(
    pinned.draft.selectedTransferSolutions ?? {},
    launchTransferLeg,
  );
  const launchTransferBurnUT = launchTransferSolution?.departureUT
    ?? (launchTransferLeg ? burnTimeForLeg(plan, launchTransferLeg) : undefined);
  const showLaunchTarget = firstIncompleteLeg?.kind === "ascent" && Boolean(launchTransferLeg);
  const nextTransferLeg = firstIncompleteLeg?.kind === "departure"
    && firstIncompleteLeg.transferSource === "mechjeb"
    ? firstIncompleteLeg
    : undefined;
  const nextTransferBurnUT = nextTransferLeg
    ? burnTimeForLeg(plan, nextTransferLeg)
    : undefined;
  const selectedSolution = selectedSolutionForLeg(
    pinned.draft.selectedTransferSolutions ?? {},
    nextTransferLeg,
  );
  const maneuverContext = selectedSolution && nextTransferLeg
    ? [
      pinned.id,
      nextTransferLeg.id,
      selectedSolution.fingerprint,
      selectedSolution.departureUT,
      selectedSolution.ejectionDeltaV,
      selectedSolution.departureVInfinity?.join(",") ?? "",
    ].join("|")
    : "";
  const actionId = maneuverPreview?.context === maneuverContext
    ? maneuverPreview.actionId
    : "";
  const vesselGuid = typeof snapshot?.["v.guid"] === "string" ? snapshot["v.guid"] : "";
  const nodeIdentityMatches = Boolean(selectedSolution)
    && snapshot?.["mj.transfer.node.fingerprint"] === selectedSolution?.fingerprint
    && snapshot?.["mj.transfer.node.vesselGuid"] === vesselGuid;
  const persistedNodeMatches = nodeIdentityMatches
    && ["created", "executed"].includes(snapshot?.["mj.transfer.node.state"] ?? "");
  const previewTelemetryMatches = nodeIdentityMatches
    && Boolean(actionId)
    && snapshot?.["mj.transfer.node.actionId"] === actionId;
  const nodeTelemetryMatches = persistedNodeMatches || previewTelemetryMatches;
  const nodeState = nodeTelemetryMatches
    ? snapshot?.["mj.transfer.node.state"]
    : actionId ? "previewing" : "idle";
  const apoapsisAltitude = finiteTelemetryNumber(snapshot, "o.ApA");
  const periapsisAltitude = finiteTelemetryNumber(snapshot, "o.PeA");
  const inclination = finiteTelemetryNumber(snapshot, "o.inclination");
  const eccentricity = finiteTelemetryNumber(snapshot, "o.eccentricity");
  const currentBody = typeof snapshot?.["v.body"] === "string" ? snapshot["v.body"] : "";
  const currentSituation = typeof snapshot?.["v.situationString"] === "string"
    ? snapshot["v.situationString"]
    : "";
  const canReconcileLaunch = scene === "flight"
    && firstIncompleteLeg?.kind === "ascent"
    && currentBody === plan.origin.name
    && /orbit/i.test(currentSituation)
    && periapsisAltitude !== undefined
    && periapsisAltitude > 0;
  const routeIsLong = scene === "flight"
    && visibleLegs.length > AUTO_COLLAPSE_ROUTE_THRESHOLD;
  const editorRouteIsLong = scene === "editor"
    && visibleLegs.length > EDITOR_COLLAPSE_ROUTE_THRESHOLD;
  const hasDedicatedNextStep = showLaunchTarget || Boolean(nextTransferLeg);
  const renderedRouteLegs = editorRouteIsLong && !routeExpanded
    ? [...visibleLegs.slice(0, 3), ...visibleLegs.slice(-2)]
    : routeIsLong && !routeExpanded
      ? hasDedicatedNextStep ? [] : visibleLegs.slice(0, 1)
      : visibleLegs;
  const hiddenEditorRouteSteps = editorRouteIsLong ? Math.max(0, visibleLegs.length - 5) : 0;
  const plannedAltitude = selectedSolution?.originParkingAltitude;
  const launchTargetAltitude = launchTransferSolution?.originParkingAltitude
    ?? (firstIncompleteLeg?.id === firstMissionAscentLeg?.id
      ? pinned.draft.start.parkingAltitude
      : undefined);
  const meanAltitude = apoapsisAltitude !== undefined && periapsisAltitude !== undefined
    ? (apoapsisAltitude + periapsisAltitude) / 2
    : undefined;
  const altitudeError = plannedAltitude !== undefined && meanAltitude !== undefined
    ? Math.abs(meanAltitude - plannedAltitude)
    : undefined;
  const warningAltitudeError = plannedAltitude === undefined ? undefined : Math.max(2_000, plannedAltitude * .05);
  const blockingAltitudeError = plannedAltitude === undefined ? undefined : Math.max(10_000, plannedAltitude * .2);
  const readinessBlockers: string[] = [];
  const readinessWarnings: string[] = [];
  const usesPorkchopTransfer = pinned.draft.transferMode === "advanced";
  if (connection.status !== "linked") readinessBlockers.push("Link the live dashboard to check this maneuver.");
  if (!pinned.craftBound || !vesselGuid) readinessBlockers.push("This plan must be bound to the active craft.");
  if (nextTransferLeg && !selectedSolution) readinessBlockers.push(usesPorkchopTransfer
    ? "Select and save a MechJeb porkchop transfer before checking this maneuver."
    : "Calculate and save this ideal transfer before checking the maneuver.");
  if (selectedSolution && (!selectedSolution.departureVInfinity || selectedSolution.maneuverVectorSchema !== 1)) readinessBlockers.push(usesPorkchopTransfer
    ? "Recalculate and update this porkchop selection to enable maneuver creation."
    : "Recalculate and update this ideal transfer to enable maneuver creation.");
  if (selectedSolution && !currentBody) readinessBlockers.push("Active-vessel body telemetry is required.");
  else if (selectedSolution && currentBody !== selectedSolution.origin) readinessBlockers.push(`Active vessel must be orbiting ${selectedSolution.origin}.`);
  if (selectedSolution && typeof currentUT === "number" && selectedSolution.departureUT <= currentUT) readinessBlockers.push("The selected transfer epoch has passed.");
  if (apoapsisAltitude === undefined || periapsisAltitude === undefined || inclination === undefined || eccentricity === undefined) {
    readinessBlockers.push("A complete parking-orbit snapshot is required.");
  }
  if (periapsisAltitude !== undefined && periapsisAltitude <= 0) readinessBlockers.push("Establish a bound parking orbit before checking the maneuver.");
  if (eccentricity !== undefined && eccentricity >= .1) readinessBlockers.push("Parking-orbit eccentricity is outside the supported envelope.");
  else if (eccentricity !== undefined && eccentricity > .02) readinessWarnings.push(`Orbit is eccentric (${formatEccentricity(eccentricity)}).`);
  if (inclination !== undefined && inclination > 15) readinessBlockers.push("Parking-orbit inclination is outside the supported envelope.");
  else if (inclination !== undefined && inclination > 2) readinessWarnings.push(`Inclination is ${formatInclination(inclination)}; the plan assumes a near-equatorial orbit.`);
  if (altitudeError !== undefined && blockingAltitudeError !== undefined && altitudeError > blockingAltitudeError) readinessBlockers.push("Parking-orbit altitude is too far from the planned orbit.");
  else if (altitudeError !== undefined && warningAltitudeError !== undefined && altitudeError > warningAltitudeError) readinessWarnings.push(`Mean parking altitude differs by ${orbitAltitude(altitudeError)}.`);

  const previewNodeUT = nodeTelemetryMatches ? finiteTelemetryNumber(snapshot, "mj.transfer.node.nodeUT") : undefined;
  const previewDeltaV = nodeTelemetryMatches ? finiteTelemetryNumber(snapshot, "mj.transfer.node.deltaV") : undefined;
  const nodeError = nodeState === "failed"
    ? String(snapshot?.["mj.transfer.node.error"] ?? "Maneuver check failed.")
    : "";
  if (nodeState === "ready") {
    if (previewNodeUT !== undefined && typeof currentUT === "number") {
      const lead = previewNodeUT - currentUT;
      if (lead <= 120) readinessBlockers.push("The computed node is too close or already past.");
      else if (lead < 900) readinessWarnings.push("The computed node is less than 15 minutes away.");
    }
    if (previewDeltaV !== undefined && selectedSolution) {
      const difference = Math.abs(previewDeltaV - selectedSolution.ejectionDeltaV);
      if (difference > Math.max(100, selectedSolution.ejectionDeltaV * .2)) readinessBlockers.push("The active-orbit burn differs too much from the selected plan.");
      else if (difference > Math.max(25, selectedSolution.ejectionDeltaV * .05)) readinessWarnings.push(`Active-orbit burn differs by ${formatDeltaV(difference)}.`);
    }
  }
  const readinessStatus = nodeState === "created"
    ? "NODE CREATED"
    : nodeState === "executed"
      ? "BURN PASSED"
    : readinessBlockers.length || nodeError
      ? "HOLD"
      : nodeState === "ready"
        ? readinessWarnings.length ? "CHECK" : "READY"
        : readinessWarnings.length ? "CHECK ORBIT" : "ORBIT READY";
  const readinessClass = nodeState === "created"
    ? "created"
    : nodeState === "executed"
      ? "executed"
    : readinessBlockers.length || nodeError ? "blocked" : readinessWarnings.length ? "warning" : "ready";
  const previewManeuver = () => {
    if (!selectedSolution?.departureVInfinity || !vesselGuid || !nextTransferLeg || !maneuverContext) return;
    const previewActionId = newManeuverActionId(pinned.id, nextTransferLeg.id);
    setManeuverSendError("");
    if (liveTelemetryStore.send({
      type: "mechjeb.transfer.node.preview",
      actionId: previewActionId,
      fingerprint: selectedSolution.fingerprint,
      origin: selectedSolution.origin,
      plannedParkingAltitude: selectedSolution.originParkingAltitude,
      departureUT: selectedSolution.departureUT,
      expectedDeltaV: selectedSolution.ejectionDeltaV,
      departureVInfinity: selectedSolution.departureVInfinity,
      expectedVesselGuid: vesselGuid,
    })) {
      setManeuverPreview({ actionId: previewActionId, context: maneuverContext });
    } else {
      setManeuverSendError("The live dashboard did not accept the maneuver check.");
    }
  };
  const createManeuver = () => {
    if (!selectedSolution || !vesselGuid || !actionId) return;
    setManeuverSendError("");
    if (!liveTelemetryStore.send({
      type: "mechjeb.transfer.node.create",
      actionId,
      fingerprint: selectedSolution.fingerprint,
      expectedVesselGuid: vesselGuid,
    })) setManeuverSendError("The live dashboard did not accept node creation.");
  };
  const comparisonAmount = comparison.difference === undefined
    ? undefined
    : Math.abs(comparison.difference);
  const comparisonPercent = comparisonAmount === undefined || comparisonRequirement <= 0
    ? undefined
    : comparisonAmount / comparisonRequirement * 100;
  const editorComparisonDetail = comparison.status === "unavailable"
    ? "Staging data unavailable"
    : comparison.status === "shortfall"
      ? `${formatDeltaV(comparisonAmount ?? 0)} needed${comparisonPercent === undefined ? "" : ` · ${comparisonPercent.toFixed(1)}% short`}`
      : `${formatDeltaV(comparisonAmount ?? 0)} reserve${comparisonPercent === undefined ? "" : ` · ${comparisonPercent.toFixed(1)}%`}`;
  const savedStopBodies = [
    ...pinned.draft.stops.map((stop) => stop.bodyName),
    ...(!pinned.draft.editingStopId && pinned.draft.nextStop.bodyName ? [pinned.draft.nextStop.bodyName] : []),
  ];
  const routeStopBodies = savedStopBodies.length > 0 ? savedStopBodies : [plan.destination.name];
  const routeVisitsAnotherBody = routeStopBodies.some((bodyName) => bodyName !== plan.origin.name);
  const routeIdentity = plan.origin.name === plan.destination.name
    ? routeVisitsAnotherBody
      ? `${plan.origin.name} round trip${routeStopBodies.length > 1 ? ` · ${routeStopBodies.length} stops` : ""}`
      : `${plan.origin.name} local mission`
    : `${plan.origin.name} → ${plan.destination.name}${routeStopBodies.length > 1 ? ` · ${routeStopBodies.length} stops` : ""}`;
  const routeIdentityTitle = [plan.origin.name, ...routeStopBodies].join(" → ");
  const pinnedPlanId = pinned.id;

  function editPinnedPlan() {
    loadPlan(pinnedPlanId);
    openDeltaVDrawer();
  }

  return <Panel
    collapsible={scene === "flight"}
    compact={scene === "flight"}
    headingActions={scene === "editor" ? <>
      <button className="resonant-edit-plan" onClick={editPinnedPlan} type="button">Edit plan</button>
      <button className="resonant-unpin" onClick={() => unpinPlan(snapshot)} type="button">Unpin</button>
    </> : <button className="resonant-unpin" onClick={() => unpinPlan(snapshot)} type="button">Unpin</button>}
    id={scene === "flight" ? "flightDeltaVPlan" : "editorDeltaVPlan"}
    tag={scene === "flight" ? comparison.status.toUpperCase() : undefined}
    title="Mission Plan"
  >
    <div className={`delta-v-pinned-identity ${scene}`}>
      <strong>{pinned.name}</strong>
      <span title={routeIdentityTitle}>{routeIdentity}</span>
    </div>
    {!pinned.craftBound && <>
      <div className="delta-v-pinned-scope legacy">LEGACY GLOBAL PIN</div>
      <div className="delta-v-pinned-scope-warning" role="alert">Craft identity is unavailable. Install or repair StageStats 0.2.8, then pin this plan to the intended craft.</div>
    </>}
    {scene === "editor" ? (
      <div aria-label="Mission delta-v overview" className="delta-v-editor-briefing">
        <section className="delta-v-editor-budget">
          <header><span>Mission budget</span><strong>{formatDeltaV(plan.totalDeltaV)}</strong></header>
          <div className="delta-v-editor-budget-breakdown">
            <div><span>Nominal route</span><strong>{formatDeltaV(plan.nominalDeltaV)}</strong></div>
            <div><span>Planning margin</span><strong>+{formatDeltaV(plan.marginDeltaV)}</strong><small>{pinned.draft.marginPercent}%</small></div>
          </div>
        </section>
        <section
          className={`delta-v-editor-coverage ${comparison.status}`}
          role={comparison.status === "shortfall" ? "alert" : "status"}
        >
          <header><span>Craft coverage · vacuum</span><strong>{comparison.status.toUpperCase()}</strong></header>
          <div><strong>{comparison.availableDeltaV === undefined ? "Unavailable" : formatDeltaV(comparison.availableDeltaV)}</strong><span>Craft VAC Δv</span></div>
          <footer>{editorComparisonDetail}</footer>
        </section>
      </div>
    ) : (
      <div aria-label="Mission delta-v overview" className={`delta-v-pinned-overview ${comparison.status}`}>
        <div className="delta-v-pinned-facts">
          <div><span>Total budget</span><strong>{formatDeltaV(plan.totalDeltaV)}</strong></div>
          <div><span>Nominal route</span><strong>{formatDeltaV(plan.nominalDeltaV)}</strong></div>
          <div><span>Margin</span><strong>+{formatDeltaV(plan.marginDeltaV)}</strong></div>
          <div><span>Remaining</span><strong>{formatDeltaV(remaining)}</strong></div>
          <div><span>Craft available</span><strong>{comparison.availableDeltaV === undefined ? "Unavailable" : formatDeltaV(comparison.availableDeltaV)}</strong></div>
          <div><span>{comparison.difference !== undefined && comparison.difference < 0 ? "Shortfall" : "Reserve"}</span><strong>{comparison.difference === undefined ? "\u2014" : formatDeltaV(Math.abs(comparison.difference))}</strong></div>
        </div>
        <div className={`delta-v-pinned-comparison ${comparison.status}`} role={comparison.status === "shortfall" || comparison.status === "tight" ? "alert" : undefined}>
          <header><span>VAC {"\u0394"}v</span><strong>{comparison.status.toUpperCase()}</strong></header>
          <p>{comparisonMessage(comparison.status)} <span>Staging CURRENT may differ.</span></p>
        </div>
      </div>
    )}
    {scene === "flight" && <div className="delta-v-pinned-progress">
      <span>Progress <strong>{completedLegIds.length} / {plan.legs.length} steps</strong></span>
      {lastCompletedLegId && <button onClick={() => setPinnedStepComplete(lastCompletedLegId, false, snapshot)} type="button">Undo last</button>}
    </div>}
    {scene === "flight" && showLaunchTarget && <div className="delta-v-launch-target">
      <header><span>LAUNCH TARGET</span><strong>ASCENT GUIDANCE</strong></header>
      <div className="delta-v-launch-target-grid">
        <div>
          <span>Parking orbit</span>
          <b>{launchTargetAltitude === undefined ? "\u2014" : `${orbitAltitude(launchTargetAltitude)} circular`}</b>
          <small>Now {orbitAltitude(apoapsisAltitude)}{" \u00d7 "}{orbitAltitude(periapsisAltitude)}</small>
        </div>
        <div>
          <span>Inclination</span>
          <b>0.0{"\u00b0"} equatorial</b>
          <small>Aim {"\u2264"}2.0{"\u00b0"}{" \u00b7 "}now {formatInclination(inclination)}</small>
        </div>
        <div>
          <span>Transfer window</span>
          <b>{launchTransferBurnUT === undefined
            ? "Not selected"
            : typeof currentUT === "number"
              ? relativeBurnTime(launchTransferBurnUT, currentUT, kerbinTime)
              : formatMissionUT(launchTransferBurnUT, kerbinTime)}</b>
          <small>{launchTransferBurnUT === undefined
            ? "Select or calculate the interplanetary window"
            : typeof currentUT === "number"
              ? formatMissionUT(launchTransferBurnUT, kerbinTime)
              : "Countdown awaiting live game time"}</small>
        </div>
      </div>
    </div>}
    {canReconcileLaunch && firstIncompleteLeg && <div className="delta-v-progress-suggestion" role="status">
      <div>
        <strong>Launch step may already be complete</strong>
        <span>The active craft is {currentSituation.toLowerCase()} {currentBody}. Confirm before updating this saved plan.</span>
      </div>
      <button onClick={() => setPinnedStepComplete(firstIncompleteLeg.id, true, snapshot)} type="button">Mark launch complete</button>
    </div>}
    {scene === "flight" && nextTransferLeg && <div className={`delta-v-transfer-readiness ${readinessClass}`}>
      <header>
        <span>TRANSFER READINESS</span>
        <button
          aria-controls="flight-transfer-readiness-details"
          aria-expanded={readinessExpanded}
          aria-label={`${readinessExpanded ? "Collapse" : "Expand"} transfer readiness`}
          className="delta-v-readiness-toggle"
          onClick={() => setReadinessExpanded((expanded) => !expanded)}
          type="button"
        >
          <strong>{readinessStatus}</strong>
          <span aria-hidden="true">{readinessExpanded ? "\u25be" : "\u25c2"}</span>
        </button>
      </header>
      {readinessExpanded && <div className="delta-v-readiness-body" id="flight-transfer-readiness-details">
        <div className="delta-v-readiness-grid">
          <div><span>Target orbit</span><b>{plannedAltitude === undefined ? "\u2014" : `${orbitAltitude(plannedAltitude)} circular`}</b></div>
          <div><span>Current orbit</span><b>{orbitAltitude(apoapsisAltitude)}{" \u00d7 "}{orbitAltitude(periapsisAltitude)}</b></div>
          <div><span>Inclination</span><b>{formatInclination(inclination)}</b></div>
          <div><span>Transfer epoch</span><b>{nextTransferBurnUT === undefined ? "\u2014" : formatMissionUT(nextTransferBurnUT, kerbinTime)}</b></div>
        </div>
        <p>{nextTransferLeg.label}{nextTransferBurnUT !== undefined && typeof currentUT === "number" ? ` \u00b7 ${relativeBurnTime(nextTransferBurnUT, currentUT, kerbinTime)}` : ""}</p>
        {nodeState === "ready" && previewNodeUT !== undefined && previewDeltaV !== undefined && <div className="delta-v-maneuver-preview">
          <div><span>Actual node</span><strong>{formatMissionUT(previewNodeUT, kerbinTime)}</strong><small>{typeof currentUT === "number" ? relativeBurnTime(previewNodeUT, currentUT, kerbinTime) : ""}</small></div>
          <div><span>Active-orbit burn</span><strong>{formatDeltaV(previewDeltaV)}</strong><small>Plan {formatDeltaV(selectedSolution?.ejectionDeltaV ?? 0)}</small></div>
        </div>}
        {readinessBlockers.length > 0 && <ul className="delta-v-readiness-issues blockers">{readinessBlockers.map((message) => <li key={message}>{message}</li>)}</ul>}
        {nodeError && <p className="delta-v-maneuver-error" role="alert">{nodeError}</p>}
        {readinessBlockers.length === 0 && readinessWarnings.length > 0 && <ul className="delta-v-readiness-issues warnings">{readinessWarnings.map((message) => <li key={message}>{message}</li>)}</ul>}
        {maneuverSendError && <p className="delta-v-maneuver-error" role="alert">{maneuverSendError}</p>}
      </div>}
      <div className="delta-v-maneuver-actions">
        {nodeState !== "ready" && nodeState !== "created" && nodeState !== "executed" && <button disabled={readinessBlockers.length > 0 || nodeState === "previewing"} onClick={previewManeuver} type="button">{nodeState === "previewing" ? "Checking\u2026" : nodeState === "failed" ? "Check again" : "Check maneuver"}</button>}
        {nodeState === "ready" && <button disabled={readinessBlockers.length > 0} onClick={createManeuver} type="button">Create KSP node</button>}
        {(nodeState === "created" || nodeState === "executed") && <button onClick={() => setPinnedStepComplete(nextTransferLeg.id, true, snapshot)} type="button">Mark transfer complete</button>}
      </div>
    </div>}
    {routeIsLong && <div className="delta-v-pinned-route-toggle">
      <span>{visibleLegs.length} mission steps remaining</span>
      <button
        aria-controls="flight-delta-v-mission-steps"
        aria-expanded={routeExpanded}
        onClick={() => setRouteExpanded((expanded) => !expanded)}
        type="button"
      >
        {routeExpanded ? "Collapse mission steps" : `Show all ${visibleLegs.length} mission steps`}
      </button>
    </div>}
    {scene === "editor" && <div className="delta-v-editor-route-heading">
      <span>Mission route <b>{visibleLegs.length} {visibleLegs.length === 1 ? "step" : "steps"}</b></span>
      <strong>{formatDeltaV(plan.nominalDeltaV)}</strong>
      {editorRouteIsLong && routeExpanded && <button aria-expanded="true" onClick={() => setRouteExpanded(false)} type="button">Collapse route</button>}
    </div>}
    {(!routeIsLong || routeExpanded || renderedRouteLegs.length > 0) && <div
      aria-label={scene === "flight" ? "Remaining mission plan steps" : "Mission plan steps"}
      className={`delta-v-pinned-route ${scene}${editorRouteIsLong && routeExpanded ? " expanded" : ""}`}
      id={scene === "flight" ? "flight-delta-v-mission-steps" : undefined}
      role="list"
    >
      {renderedRouteLegs.map((leg, renderedIndex) => {
        const originalIndex = plan.legs.findIndex((candidate) => candidate.id === leg.id);
        const burnUT = scene === "flight" ? burnTimeForLeg(plan, leg) : undefined;
        return <Fragment key={leg.id}>
          {scene === "editor" && editorRouteIsLong && !routeExpanded && renderedIndex === 3 && <button
            aria-expanded="false"
            className="delta-v-editor-route-omitted"
            onClick={() => setRouteExpanded(true)}
            type="button"
          >{hiddenEditorRouteSteps} intermediate {hiddenEditorRouteSteps === 1 ? "step" : "steps"} <span>Expand route</span></button>}
          <div role="listitem">
            {scene === "flight" && <button aria-label={`Mark ${leg.label} complete`} className="delta-v-pinned-check" onClick={() => setPinnedStepComplete(leg.id, true, snapshot)} title="Mark step complete" type="button"><span aria-hidden="true">{"\u2713"}</span></button>}
            <span className="delta-v-pinned-step-number">{String(originalIndex + 1).padStart(2, "0")}</span>
            <div className="delta-v-pinned-step-copy">
              <strong title={leg.label}>{leg.label}</strong>
              {burnUT !== undefined && <small><span>{formatMissionUT(burnUT, kerbinTime)}</span>{typeof currentUT === "number" && <b>{relativeBurnTime(burnUT, currentUT, kerbinTime)}</b>}</small>}
            </div>
            <b className={scene === "editor" && leg.deltaV === 0 ? "assisted" : undefined} title={scene === "editor" && leg.deltaV === 0 ? "0 m/s planned" : undefined}>{scene === "editor" && leg.deltaV === 0 ? leg.atmosphericAssist ? "Assisted" : "No burn" : formatDeltaV(leg.deltaV)}</b>
          </div>
        </Fragment>;
      })}
      {visibleLegs.length === 0 && <div className="delta-v-pinned-complete" role="status"><strong>Mission plan complete</strong><span>All planned steps have been checked off.</span></div>}
    </div>}
    {scene === "flight" && completedLegIds.length > 0 && <details className="delta-v-pinned-completed">
      <summary>{completedLegIds.length} completed {completedLegIds.length === 1 ? "step" : "steps"}</summary>
      <div>{completedLegIds.map((id) => {
        const leg = plan.legs.find((candidate) => candidate.id === id)!;
        return <button key={id} onClick={() => setPinnedStepComplete(id, false, snapshot)} type="button"><span>{leg.label}</span><b>Restore</b></button>;
      })}</div>
    </details>}
    {hasAerocapture && <div className={`delta-v-pinned-thermal ${protection}`} role={protection === "not-detected" ? "alert" : undefined}>{protection === "detected" ? "Thermal protection detected \u00b7 aerobraking remains craft-dependent." : protection === "not-detected" ? "No thermal protection detected. Aerobraking may be risky." : "Thermal Protection Recommended \u00b7 aerobraking is craft-dependent."}</div>}
  </Panel>;
}
