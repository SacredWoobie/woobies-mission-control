import { Panel } from "../components/Panel";
import type { TelemetrySnapshot } from "../telemetry/types";
import { useLiveTelemetrySelector } from "../telemetry/useLiveTelemetry";
import {
  evaluateOrbitTarget,
  formatDistance,
  formatDuration,
  type DistanceUnit,
  type ResonantOrbitPlan,
} from "./calculations";
import { useResonantOrbitState } from "./state";

function finiteTelemetryNumber(snapshot: TelemetrySnapshot | null, key: string) {
  const value = snapshot?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function OrbitTargetMetric({
  bodyRadius,
  currentAltitude,
  label,
  targetAltitude,
  unit,
}: {
  bodyRadius: number;
  currentAltitude?: number;
  label: "Target Ap" | "Target Pe";
  targetAltitude: number;
  unit: DistanceUnit;
}) {
  const evaluation = evaluateOrbitTarget(currentAltitude, targetAltitude, bodyRadius);
  const statusLabel = evaluation.state === "in-range"
    ? "IN RANGE"
    : evaluation.state === "unavailable"
      ? "NO DATA"
      : evaluation.state.toUpperCase();

  return (
    <div className="resonant-orbit-target">
      <span className="resonant-orbit-target-heading">{label}</span>
      <strong>{formatDistance(targetAltitude, unit)}</strong>
      <div className="resonant-orbit-target-state">
        <b
          aria-label={`${label} ${statusLabel.toLocaleLowerCase()}`}
          className={`resonant-orbit-target-status ${evaluation.state}`}
          title={`${label}: ${statusLabel}; tolerance ±${formatDistance(evaluation.tolerance, unit)}`}
        >
          {statusLabel}
        </b>
      </div>
    </div>
  );
}

function EditorOrbitSchematic({ plan }: { plan: ResonantOrbitPlan }) {
  const centerX = 110;
  const centerY = 62;
  const bodyRadius = plan.body.radius;
  const targetRadius = bodyRadius + plan.targetAltitude;
  const apoapsisRadius = bodyRadius + plan.carrierApoapsis;
  const periapsisRadius = bodyRadius + plan.carrierPeriapsis;
  const maximumRadius = Math.max(targetRadius, apoapsisRadius, periapsisRadius);
  const scale = 61 / maximumRadius;
  const finalOrbitRadius = targetRadius * scale;
  const carrierSemiMajor = (apoapsisRadius + periapsisRadius) / 2 * scale;
  const carrierEccentricity = Math.abs(apoapsisRadius - periapsisRadius) / (apoapsisRadius + periapsisRadius);
  const carrierSemiMinor = carrierSemiMajor * Math.sqrt(Math.max(0, 1 - carrierEccentricity ** 2));
  const carrierFocus = carrierSemiMajor * carrierEccentricity;
  const bodyPixels = Math.max(8, bodyRadius * scale);
  const satelliteRadius = plan.satelliteCount > 20 ? 1.1 : plan.satelliteCount > 10 ? 1.6 : 3;
  const releaseAngle = plan.releaseAt === "periapsis" ? 0 : Math.PI;

  return (
    <svg aria-hidden="true" className="resonant-editor-orbit-graphic" viewBox="0 0 200 145">
      <circle className="resonant-editor-orbit-grid" cx={centerX} cy={centerY} r="65" />
      <circle className="resonant-editor-final-orbit" cx={centerX} cy={centerY} r={finalOrbitRadius} />
      <ellipse
        className="resonant-editor-carrier-orbit"
        cx={centerX - carrierFocus}
        cy={centerY}
        rx={carrierSemiMajor}
        ry={carrierSemiMinor}
      />
      <circle className="resonant-editor-body" cx={centerX} cy={centerY} r={bodyPixels} />
      {Array.from({ length: plan.satelliteCount }, (_, index) => {
        const angle = releaseAngle + index * Math.PI * 2 / plan.satelliteCount;
        return (
          <circle
            className={index === 0 ? "resonant-editor-satellite release" : "resonant-editor-satellite"}
            cx={centerX + Math.cos(angle) * finalOrbitRadius}
            cy={centerY + Math.sin(angle) * finalOrbitRadius}
            key={index}
            r={index === 0 ? satelliteRadius + .5 : satelliteRadius}
          />
        );
      })}
    </svg>
  );
}

export function PinnedResonantOrbitPanel({ scene = "flight", snapshot }: { scene?: "flight" | "editor"; snapshot?: TelemetrySnapshot }) {
  const { loadPlan, openDrawer, pinnedForTelemetry, setReleaseCount, unit, unpinPlan } = useResonantOrbitState();
  const liveSnapshot = useLiveTelemetrySelector((state) => state.snapshot);
  const activeSnapshot = snapshot ?? liveSnapshot;
  const pinned = pinnedForTelemetry(activeSnapshot);
  if (!pinned) return null;
  const { plan, releaseCount } = pinned;
  const complete = releaseCount >= plan.satelliteCount;
  const activeBody = typeof activeSnapshot?.["v.body"] === "string" ? activeSnapshot["v.body"] : undefined;
  const targetBodyActive = scene === "flight"
    && activeBody?.localeCompare(plan.body.name, undefined, { sensitivity: "base" }) === 0;
  const currentApoapsis = targetBodyActive ? finiteTelemetryNumber(activeSnapshot, "o.ApA") : undefined;
  const currentPeriapsis = targetBodyActive ? finiteTelemetryNumber(activeSnapshot, "o.PeA") : undefined;
  const planStatus = plan.warnings.some((warning) => warning.level === "danger")
    ? "Plan conflict"
    : plan.warnings.some((warning) => warning.level === "warning")
      ? "Review plan"
      : "Calculated profile nominal";
  const planStatusTone = plan.warnings.some((warning) => warning.level === "danger")
    ? "danger"
    : plan.warnings.some((warning) => warning.level === "warning")
      ? "warning"
      : "nominal";
  const resonanceRatio = plan.mode === "raise"
    ? `${plan.satelliteCount + 1}:${plan.satelliteCount}`
    : `${plan.satelliteCount - 1}:${plan.satelliteCount}`;
  const planIssueLabels = plan.warnings.map((warning) => {
    if (warning.code === "los") return "No continuous LOS";
    if (warning.code === "impact") return "PE impact";
    if (warning.code === "atmosphere") return "PE too low";
    if (warning.code === "soi") return "AP too high";
    return "Review details";
  });
  const editorPlanStatus = planStatusTone === "nominal"
    ? "Profile nominal"
    : `${planStatus} — ${planIssueLabels.join(" · ")}`;
  const pinnedPlanId = pinned.id;

  function editPinnedPlan() {
    loadPlan(pinnedPlanId);
    openDrawer();
  }

  return (
    <Panel
      collapsible={scene === "flight"}
      compact={scene === "flight"}
      headingActions={scene === "editor" ? (
        <>
          <button className="resonant-edit-plan" onClick={editPinnedPlan} type="button">Edit plan</button>
          <button className="resonant-unpin" onClick={unpinPlan} type="button">Unpin</button>
        </>
      ) : <button className="resonant-unpin" onClick={unpinPlan} type="button">Unpin</button>}
      id={scene === "flight" ? "flightOrbitPlan" : "editorOrbitPlan"}
      tag={scene === "flight" ? planStatus : undefined}
      title={scene === "flight" ? pinned.name : "Resonant Orbit Plan"}
    >
      {scene === "editor" ? (
        <div className="resonant-editor-plan">
          <div className="resonant-editor-constellation">
            <EditorOrbitSchematic plan={plan} />
            <div className="resonant-editor-satellite-count"><strong>{plan.satelliteCount}</strong><span>Satellites</span></div>
          </div>
          <div className="resonant-editor-plan-details">
            <header><strong>{pinned.name}</strong><span>{plan.body.name}</span></header>
            <div className="resonant-editor-plan-metrics carrier">
              <div><span>Carrier Ap</span><strong>{formatDistance(plan.carrierApoapsis, unit)}</strong></div>
              <div><span>Carrier Pe</span><strong>{formatDistance(plan.carrierPeriapsis, unit)}</strong></div>
              <div><span>Resonance</span><strong>{resonanceRatio} {plan.mode}</strong></div>
            </div>
            <div className="resonant-editor-plan-metrics execution">
              <div><span>Injection Δv</span><strong>{plan.injectionDeltaV.toFixed(2)} m/s</strong></div>
              <div><span>Carrier period</span><strong>{formatDuration(plan.carrierPeriod)}</strong></div>
              <div><span>Release at</span><strong>{plan.releaseAt === "apoapsis" ? "AP" : "PE"}</strong></div>
            </div>
            <footer className={`resonant-editor-plan-status ${planStatusTone}`}><i />{editorPlanStatus}</footer>
          </div>
        </div>
      ) : (
        <>
          <div className="resonant-flight-summary">
            <OrbitTargetMetric
              bodyRadius={plan.body.radius}
              currentAltitude={currentApoapsis}
              label="Target Ap"
              targetAltitude={plan.carrierApoapsis}
              unit={unit}
            />
            <OrbitTargetMetric
              bodyRadius={plan.body.radius}
              currentAltitude={currentPeriapsis}
              label="Target Pe"
              targetAltitude={plan.carrierPeriapsis}
              unit={unit}
            />
            <div><span>Injection Δv</span><strong>{plan.injectionDeltaV.toFixed(2)} m/s</strong></div>
          </div>
          <div className="resonant-flight-guidance">
            <span>01</span>
            <div>
              <strong>Release at {plan.releaseAt}</strong>
              <p>Separate one satellite and circularize it. Repeat every {formatDuration(plan.carrierPeriod)}.</p>
            </div>
          </div>
          <div className="resonant-deployment">
            <div><span>Deployment tracking</span><strong>{releaseCount} / {plan.satelliteCount}</strong></div>
            <div className="resonant-progress"><span style={{ width: `${releaseCount / plan.satelliteCount * 100}%` }} /></div>
            <div className="resonant-deployment-actions">
              <button aria-label="Mark previous satellite" disabled={releaseCount === 0} onClick={() => setReleaseCount(releaseCount - 1)} type="button">−</button>
              <button disabled={complete} onClick={() => setReleaseCount(releaseCount + 1)} type="button">{complete ? "Constellation deployed" : "Mark satellite released"}</button>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}
