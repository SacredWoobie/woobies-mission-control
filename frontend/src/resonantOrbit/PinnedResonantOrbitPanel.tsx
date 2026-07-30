import { Panel } from "../components/Panel";
import type { TelemetrySnapshot } from "../telemetry/types";
import { useLiveTelemetrySelector } from "../telemetry/useLiveTelemetry";
import {
  evaluateOrbitTarget,
  formatDistance,
  formatDuration,
  type DistanceUnit,
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

export function PinnedResonantOrbitPanel({ scene = "flight", snapshot }: { scene?: "flight" | "editor"; snapshot?: TelemetrySnapshot }) {
  const { openDrawer, pinnedForTelemetry, setReleaseCount, unit, unpinPlan } = useResonantOrbitState();
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

  return (
    <Panel
      headingActions={<button className="resonant-unpin" onClick={unpinPlan} type="button">Unpin</button>}
      hideable={scene === "flight"}
      id={scene === "flight" ? "flightOrbitPlan" : "editorOrbitPlan"}
      tag="Saved"
      title={pinned.name}
    >
      <div className="resonant-flight-summary">
        {scene === "flight" ? (
          <>
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
          </>
        ) : (
          <>
            <div><span>Target Ap</span><strong>{formatDistance(plan.carrierApoapsis, unit)}</strong></div>
            <div><span>Target Pe</span><strong>{formatDistance(plan.carrierPeriapsis, unit)}</strong></div>
          </>
        )}
        <div><span>Injection Δv</span><strong>{plan.injectionDeltaV.toFixed(2)} m/s</strong></div>
      </div>
      {scene === "flight" ? (
        <>
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
      ) : (
        <div className="resonant-flight-guidance resonant-editor-guidance">
          <span>DESIGN</span>
          <div>
            <strong>{planStatus}</strong>
            <p>{plan.satelliteCount} satellites at {formatDistance(plan.targetAltitude, unit)} final altitude. Carrier period {formatDuration(plan.carrierPeriod)}.</p>
            <div className="resonant-deployment-actions">
              <button onClick={openDrawer} type="button">Open planner</button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
