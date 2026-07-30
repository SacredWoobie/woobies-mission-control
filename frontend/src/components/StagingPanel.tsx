import { useEffect, useRef, useState } from "react";
import {
  formatDistance,
  formatDuration,
  formatPressure,
  formatStageDeltaV,
  formatTwr,
  isFiniteNumber,
  VACUUM_PRESSURE_ATM,
} from "../formatting/numbers";
import { selectStages, selectStageSummary } from "../telemetry/selectors";
import type { StageViewModel, TelemetrySnapshot } from "../telemetry/types";
import { Panel } from "./Panel";

interface StagingPanelProps {
  snapshot: TelemetrySnapshot;
}

function deltaVWithUnit(value: number | undefined) {
  const formatted = formatStageDeltaV(value);
  return formatted === "—" ? formatted : `${formatted} m/s`;
}

function compactDuration(seconds: number | undefined) {
  if (!isFiniteNumber(seconds)) return "—";
  const clamped = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const remainder = clamped % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function twrRange(stage: StageViewModel | undefined) {
  const start = stage?.twrStart;
  const end = stage?.twrEnd;
  if (!isFiniteNumber(start)) return "—";
  return isFiniteNumber(end)
    ? `${formatTwr(start)}→${formatTwr(end)}`
    : formatTwr(start);
}

function isSurfaceSituation(situation: string) {
  const normalized = situation.trim().toLowerCase().replace(/[_-]+/g, " ");
  return normalized === "pre launch"
    || normalized === "prelaunch"
    || normalized === "landed"
    || normalized === "splashed";
}

export function StagingPanel({ snapshot }: StagingPanelProps) {
  const editorMode = snapshot["context.mode"] === "editor";
  const rows = selectStages(snapshot);
  const atmosphere = selectStageSummary(snapshot, "atmosphere");
  const vacuum = selectStageSummary(snapshot, "vacuum");
  const unavailable = snapshot["stage.available"] === false;
  const pending = snapshot["stage.pending"] === true;
  const activeKsp = atmosphere.currentKsp ?? vacuum.currentKsp;
  const previousActiveKsp = useRef(activeKsp);
  const [flashKsp, setFlashKsp] = useState<number>();

  useEffect(() => {
    if (
      previousActiveKsp.current !== undefined
      && activeKsp !== undefined
      && previousActiveKsp.current !== activeKsp
    ) {
      setFlashKsp(activeKsp);
    }
    previousActiveKsp.current = activeKsp;
  }, [activeKsp]);

  const pressureAtm = snapshot["stage.staticPressureAtm"];
  const body = snapshot["stage.body"] || snapshot["v.body"] || "Current body";
  const altitude = snapshot["stage.altitude"] ?? snapshot["v.altitude"];
  const throttle = snapshot["stage.throttle"] ?? snapshot["krpc.throttle"];
  const situation = snapshot["stage.situation"] || snapshot["v.situationString"] || "";
  const unpoweredCount = isFiniteNumber(snapshot["stage.unpoweredCount"])
    ? Math.max(0, Math.round(snapshot["stage.unpoweredCount"]))
    : Math.max(0, Number(snapshot["stage.count"] ?? rows.length) - rows.length);
  const totalBurn = isFiniteNumber(snapshot["stage.totalBurnSeconds"])
    ? snapshot["stage.totalBurnSeconds"]
    : rows.reduce((total, stage) => total + (stage.burnSeconds ?? 0), 0);
  const dimCurrentDeltaV = isFiniteNumber(pressureAtm) && pressureAtm < VACUUM_PRESSURE_ATM;
  const dimVacuumDeltaV = isFiniteNumber(pressureAtm) && pressureAtm > 0.5;
  const throttlePercent = isFiniteNumber(throttle)
    ? Math.round(Math.max(0, Math.min(1, throttle)) * 100)
    : undefined;

  return (
    <Panel
      hideable={!editorMode}
      id="stage"
      title={editorMode ? "Editor staging analysis" : "Staging analysis"}
      tag={editorMode ? (
        <span aria-label="Total delta-v" className="editor-stage-total-dv">
          <span className="editor-stage-total-label">Total Δv</span>
          <span className="editor-stage-total-value">
            <small>Atmo:</small>
            <strong>{deltaVWithUnit(atmosphere.totalDeltaV)}</strong>
          </span>
          <span aria-hidden="true" className="editor-stage-total-separator">|</span>
          <span className="editor-stage-total-value">
            <small>Vac:</small>
            <strong>{deltaVWithUnit(vacuum.totalDeltaV)}</strong>
          </span>
        </span>
      ) : undefined}
    >
      {unavailable || pending ? (
        <p className="empty-state">
          {pending ? "Calculating staging simulation…" : "Staging simulation is not available."}
        </p>
      ) : editorMode ? (
        rows.length === 0 ? (
          <p className="empty-state">No propulsive stages for this condition.</p>
        ) : (
          <div className="stage-table editor">
            <div className="st-row st-head" aria-hidden="true">
              <span>Stage</span>
              <span>Δv Atmo</span>
              <span>Δv Vac</span>
              <span>TWR Atmo</span>
              <span>TWR Vac</span>
              <span>Burn</span>
            </div>
            {rows.map((stage) => {
              const isCurrent = atmosphere.current?.ksp === stage.ksp;
              return (
                <div className={`st-row ${isCurrent ? "cur" : ""}`} key={stage.ksp}>
                  <span className="sname">{isCurrent ? "▶ " : ""}S{stage.ksp}</span>
                  <span>{formatStageDeltaV(stage.deltaVAtmosphere)}</span>
                  <span>{formatStageDeltaV(stage.deltaVVacuum)}</span>
                  <span>{formatTwr(stage.twrAtmosphere)}</span>
                  <span>{formatTwr(stage.twrVacuum)}</span>
                  <span>{formatDuration(stage.burnSeconds)}</span>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <>
          <div className="flight-stage-hero">
            <div className="flight-stage-total">
              <span>Total Δv · vacuum</span>
              <strong>{deltaVWithUnit(vacuum.totalDeltaV)}</strong>
              <small>{deltaVWithUnit(atmosphere.totalDeltaV)} at {formatPressure(pressureAtm)}</small>
              <small>
                at full throttle
                {rows.length > 1 ? ` · ${compactDuration(totalBurn)} total burn` : ""}
              </small>
            </div>
            <div className="flight-stage-conditions">
              <span>Conditions</span>
              <strong>{formatPressure(pressureAtm)}</strong>
              <small>{formatDistance(altitude, "context")} · {body}</small>
              <small>{isFiniteNumber(throttlePercent) ? `throttle ${throttlePercent}%` : "throttle —"}</small>
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="empty-state">No propulsive stages detected.</p>
          ) : rows.length === 1 ? (
            <div className="flight-stage-single">
              <div>
                <span>TWR · {body}</span>
                <strong className={
                  isSurfaceSituation(situation)
                  && rows[0].ksp === activeKsp
                  && isFiniteNumber(rows[0].twrStart)
                  && rows[0].twrStart < 1
                    ? "danger"
                    : ""
                }>{twrRange(rows[0])}</strong>
              </div>
              <div>
                <span>Burn</span>
                <strong>{compactDuration(rows[0].burnSeconds)}</strong>
              </div>
              <div>
                <span>Throttle</span>
                <strong>{isFiniteNumber(throttlePercent) ? `${throttlePercent}%` : "—"}</strong>
              </div>
            </div>
          ) : (
            <div className="stage-table flight">
              <div className="st-row st-head" aria-hidden="true">
                <span>ST</span>
                <span className={dimCurrentDeltaV ? "dim" : ""}>Δv current</span>
                <span className={dimVacuumDeltaV ? "dim" : ""}>Δv vac</span>
                <span>TWR · {body}</span>
                <span>Burn</span>
              </div>
              {rows.map((stage) => {
                const isCurrent = activeKsp === stage.ksp;
                const danger = isCurrent
                  && isSurfaceSituation(situation)
                  && isFiniteNumber(stage.twrStart)
                  && stage.twrStart < 1;
                return (
                  <div
                    className={`st-row${isCurrent ? " cur" : ""}${flashKsp === stage.ksp ? " newly-active" : ""}`}
                    key={stage.ksp}
                  >
                    <span className="sname">S{stage.ksp}</span>
                    <span className={dimCurrentDeltaV ? "dim" : ""}>{formatStageDeltaV(stage.deltaVAtmosphere)}</span>
                    <span className={dimVacuumDeltaV ? "dim" : ""}>{formatStageDeltaV(stage.deltaVVacuum)}</span>
                    <span className={`stage-twr${danger ? " danger" : ""}`}>{twrRange(stage)}</span>
                    <span>{compactDuration(stage.burnSeconds)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {unpoweredCount > 0 && (
            <div className="flight-stage-footer">
              {unpoweredCount} unpowered {unpoweredCount === 1 ? "stage" : "stages"} hidden
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
