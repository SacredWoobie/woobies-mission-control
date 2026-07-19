import { useState } from "react";
import { formatDeltaV, formatDuration, isFiniteNumber } from "../telemetry/formatters";
import { selectStages, selectStageSummary } from "../telemetry/selectors";
import type { StageCondition, StageViewModel, TelemetrySnapshot } from "../telemetry/types";
import { Panel } from "./Panel";

interface StagingPanelProps {
  snapshot: TelemetrySnapshot;
}

function deltaVFor(stage: StageViewModel | undefined, condition: StageCondition) {
  return condition === "vacuum" ? stage?.deltaVVacuum : stage?.deltaVAtmosphere;
}

function twrFor(stage: StageViewModel | undefined, condition: StageCondition) {
  return condition === "vacuum" ? stage?.twrVacuum : stage?.twrAtmosphere;
}

function deltaVWithUnit(value: number | undefined) {
  const formatted = formatDeltaV(value);
  return formatted === "—" ? formatted : `${formatted} m/s`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="v">{value}</span>
    </div>
  );
}

function twrText(value: number | undefined) {
  return isFiniteNumber(value) ? value.toFixed(2) : "—";
}

export function StagingPanel({ snapshot }: StagingPanelProps) {
  const [condition, setCondition] = useState<StageCondition>("atmosphere");
  const editorMode = snapshot["context.mode"] === "editor";
  const rows = selectStages(snapshot, condition);
  const atmosphere = selectStageSummary(snapshot, "atmosphere");
  const vacuum = selectStageSummary(snapshot, "vacuum");
  const selected = condition === "vacuum" ? vacuum : atmosphere;
  const unavailable = snapshot["stage.available"] === false;
  const pending = snapshot["stage.pending"] === true;

  return (
    <Panel hideable={!editorMode} id="stage"
      title={editorMode ? "Editor staging analysis" : "Staging analysis"}
      tag={
        editorMode ? (
          "Selected conditions · Atmospheric + vacuum"
        ) : (
          <span aria-label="Staging analysis condition" className="dv-mode-buttons" role="group">
            <button aria-pressed={condition === "atmosphere"} className={`dv-mode-button ${condition === "atmosphere" ? "active" : ""}`} onClick={() => setCondition("atmosphere")} type="button">ATMO</button>
            <button aria-pressed={condition === "vacuum"} className={`dv-mode-button ${condition === "vacuum" ? "active" : ""}`} onClick={() => setCondition("vacuum")} type="button">VAC</button>
          </span>
        )
      }
    >
      {unavailable || pending ? (
        <p className="empty-state">
          {pending ? "Calculating staging simulation…" : "Staging simulation is not available."}
        </p>
      ) : (
        <>
          {editorMode ? (
            <div className="dv-grid editor-dv-grid">
              <Stat label="Launch stage" value={selected.currentKsp?.toString() ?? "—"} />
              <Stat label="Stage Δv · Atmo" value={deltaVWithUnit(deltaVFor(atmosphere.current, "atmosphere"))} />
              <Stat label="Stage Δv · Vac" value={deltaVWithUnit(deltaVFor(vacuum.current, "vacuum"))} />
              <Stat label="Total Δv · Atmo" value={deltaVWithUnit(atmosphere.totalDeltaV)} />
              <Stat label="Total Δv · Vac" value={deltaVWithUnit(vacuum.totalDeltaV)} />
              <Stat label="Initial TWR · Atmo" value={twrText(twrFor(atmosphere.current, "atmosphere"))} />
              <Stat label="Initial TWR · Vac" value={twrText(twrFor(vacuum.current, "vacuum"))} />
              <Stat label="Burn time" value={formatDuration(atmosphere.current?.burnSeconds ?? vacuum.current?.burnSeconds)} />
            </div>
          ) : (
            <>
              <div className="stage-top">
                <div className="stage-num">
                  <span className="label">Stage</span>
                  <span className="v">{selected.currentKsp?.toString() ?? "—"}</span>
                </div>
                <div className="thr-inline" id="stageThrottle">
                  <span className="label">Throttle</span>
                  <div className="meter" role="meter" aria-label="Throttle" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Number(snapshot["krpc.throttle"] ?? 0) * 100)}>
                    <div className="track">
                      <span className="fill" style={{ width: `${Math.round(Number(snapshot["krpc.throttle"] ?? 0) * 100)}%` }} />
                    </div>
                    <span className="cap" aria-hidden="true">
                      <span>{Math.round(Number(snapshot["krpc.throttle"] ?? 0) * 100)}%</span>
                    </span>
                  </div>
                </div>
              </div>
              <div className="dv-grid flight-dv-grid">
                <Stat label="Stage Δv" value={deltaVWithUnit(deltaVFor(selected.current, condition))} />
                <Stat label="Total Δv" value={deltaVWithUnit(selected.totalDeltaV)} />
                <Stat label="TWR" value={twrText(twrFor(selected.current, condition))} />
                <Stat label="Burn time" value={formatDuration(selected.current?.burnSeconds)} />
              </div>
            </>
          )}

          {rows.length === 0 ? (
            <p className="empty-state">No propulsive stages for this condition.</p>
          ) : (
            <div className={editorMode ? "stage-table editor" : "stage-table flight"}>
              <div className="st-row st-head" aria-hidden="true">
                <span>Stage</span>
                {editorMode ? (
                  <>
                    <span>Δv Atmo</span>
                    <span>Δv Vac</span>
                    <span>TWR Atmo</span>
                    <span>TWR Vac</span>
                  </>
                ) : (
                  <>
                    <span>Δv</span>
                    <span>TWR</span>
                  </>
                )}
                <span>Burn</span>
              </div>
              {rows.map((stage) => {
                const isCurrent = selected.current?.ksp === stage.ksp;
                return (
                  <div className={`st-row ${isCurrent ? "cur" : ""}`} key={stage.ksp}>
                    <span className="sname">{isCurrent ? "▶ " : ""}S{stage.ksp}</span>
                    {editorMode ? (
                      <>
                        <span>{formatDeltaV(stage.deltaVAtmosphere)}</span>
                        <span>{formatDeltaV(stage.deltaVVacuum)}</span>
                        <span>{isFiniteNumber(stage.twrAtmosphere) ? stage.twrAtmosphere.toFixed(2) : "—"}</span>
                        <span>{isFiniteNumber(stage.twrVacuum) ? stage.twrVacuum.toFixed(2) : "—"}</span>
                      </>
                    ) : (
                      <>
                        <span>{formatDeltaV(deltaVFor(stage, condition))}</span>
                        <span>{isFiniteNumber(twrFor(stage, condition)) ? twrFor(stage, condition)!.toFixed(2) : "—"}</span>
                      </>
                    )}
                    <span>{formatDuration(stage.burnSeconds)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
