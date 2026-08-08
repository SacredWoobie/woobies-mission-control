import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  formatDistance,
  formatDuration,
  formatPressure,
  formatStageDeltaV,
  formatTwr,
  isFiniteNumber,
  VACUUM_PRESSURE_ATM,
} from "../formatting/numbers";
import { selectStages, selectStageSummary, selectThrottleFraction } from "../telemetry/selectors";
import type { StageViewModel, TelemetrySnapshot } from "../telemetry/types";
import { Panel } from "./Panel";
import { useEditorAnalysisStatus } from "./useEditorAnalysisStatus";

interface StagingPanelProps {
  snapshot: TelemetrySnapshot;
}

const VISIBLE_POWERED_STAGE_ROWS = 4;

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
  const {
    pending,
    retained,
    staleLabel,
  } = useEditorAnalysisStatus(snapshot);
  const stale = editorMode && retained;
  const activeKsp = atmosphere.currentKsp ?? vacuum.currentKsp;
  const previousActiveKsp = useRef(activeKsp);
  const editorStageTable = useRef<HTMLDivElement>(null);
  const [flashKsp, setFlashKsp] = useState<number>();
  const [showAllPoweredStages, setShowAllPoweredStages] = useState(false);
  const poweredRowsId = `powered-stage-rows-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

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
  const throttle = selectThrottleFraction(snapshot);
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
  const activeRowIndex = rows.findIndex((stage) => stage.ksp === activeKsp);
  const groupedRowCount = rows.length > VISIBLE_POWERED_STAGE_ROWS + 1
    && (activeRowIndex < 0 || activeRowIndex >= rows.length - VISIBLE_POWERED_STAGE_ROWS)
    ? rows.length - VISIBLE_POWERED_STAGE_ROWS
    : 0;
  const groupedRows = groupedRowCount > 0 ? rows.slice(0, groupedRowCount) : [];
  const groupedRange = groupedRows.length > 0
    ? `S${groupedRows[0].ksp}–S${groupedRows[groupedRows.length - 1].ksp}`
    : "";
  const displayedRows = groupedRowCount > 0 && !showAllPoweredStages
    ? rows.slice(groupedRowCount)
    : rows;

  useLayoutEffect(() => {
    const table = editorStageTable.current;
    if (!editorMode || stale || !table || activeKsp === undefined) return;
    const activeRow = table.querySelector<HTMLElement>(`[data-stage-ksp="${activeKsp}"]`);
    if (!activeRow) return;
    const header = table.querySelector<HTMLElement>(".st-head");
    const tableBounds = table.getBoundingClientRect();
    const rowBounds = activeRow.getBoundingClientRect();
    const visibleTop = tableBounds.top + (header?.getBoundingClientRect().height ?? 0);
    if (rowBounds.bottom > tableBounds.bottom) {
      table.scrollTop += Math.ceil(rowBounds.bottom - tableBounds.bottom) + 1;
    } else if (rowBounds.top < visibleTop) {
      table.scrollTop = Math.max(0, table.scrollTop - (visibleTop - rowBounds.top));
    }
  }, [activeKsp, editorMode, rows.length, stale]);

  const renderFlightStageRow = (stage: StageViewModel) => {
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
  };

  return (
    <Panel
      compact={!editorMode}
      id="stage"
      title={editorMode ? "Editor staging analysis" : "Staging analysis"}
      tag={editorMode ? (
        <span
          aria-label="Total delta-v"
          className={`editor-stage-total-dv${stale ? " editor-analysis-retained" : ""}`}
        >
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
      {unavailable ? (
        <p className="empty-state">
          Staging simulation is not available.
        </p>
      ) : pending && !stale ? (
        <p className="empty-state">Calculating staging simulation…</p>
      ) : editorMode ? (
        <>
          {stale && (
            <div aria-live="polite" className="editor-analysis-status wait">
              {staleLabel}
            </div>
          )}
          {rows.length === 0 ? (
            <p className={`empty-state${stale ? " editor-analysis-retained" : ""}`}>
              No propulsive stages for this condition.
            </p>
          ) : (
            <div
              aria-label="Editor stage performance"
              aria-busy={pending}
              className={`stage-table editor${stale ? " editor-analysis-retained" : ""}`}
              ref={editorStageTable}
              role="table"
              tabIndex={0}
            >
              <div className="st-row st-head" role="row">
                <span role="columnheader">Stage</span>
                <span role="columnheader">Δv Atmo</span>
                <span role="columnheader">Δv Vac</span>
                <span role="columnheader">TWR Atmo</span>
                <span role="columnheader">TWR Vac</span>
                <span role="columnheader">Burn</span>
              </div>
              {rows.map((stage) => {
                const isCurrent = !stale && atmosphere.current?.ksp === stage.ksp;
                return (
                  <div
                    aria-current={isCurrent ? "step" : undefined}
                    aria-label={isCurrent ? `Current stage S${stage.ksp}` : undefined}
                    className={`st-row ${isCurrent ? "cur" : ""}`}
                    data-stage-ksp={stage.ksp}
                    key={stage.ksp}
                    role="row"
                  >
                    <span className="sname" role="cell">{isCurrent ? "▶ " : ""}S{stage.ksp}</span>
                    <span role="cell">{formatStageDeltaV(stage.deltaVAtmosphere)}</span>
                    <span role="cell">{formatStageDeltaV(stage.deltaVVacuum)}</span>
                    <span role="cell">{formatTwr(stage.twrAtmosphere)}</span>
                    <span role="cell">{formatTwr(stage.twrVacuum)}</span>
                    <span role="cell">{formatDuration(stage.burnSeconds)}</span>
                  </div>
                );
              })}
            </div>
          )}
          {unpoweredCount > 0 && (
            <div className="editor-stage-footer">
              {unpoweredCount} non-propulsive {unpoweredCount === 1 ? "stage" : "stages"} omitted
            </div>
          )}
        </>
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
                <span title={`Full-throttle TWR at live body gravity (${body})`}>TWR · LIVE</span>
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
            <div className={`stage-table flight${groupedRowCount > 0 ? " has-stage-group" : ""}${showAllPoweredStages ? " expanded" : ""}`}>
              <div className="st-row st-head" aria-hidden="true">
                <span>ST</span>
                <span className={dimCurrentDeltaV ? "dim" : ""} title="Delta-v at live flight conditions">Δv LIVE</span>
                <span className={dimVacuumDeltaV ? "dim" : ""} title="Delta-v in vacuum">Δv VAC</span>
                <span title={`Full-throttle TWR at live body gravity (${body})`}>TWR · LIVE</span>
                <span>Burn</span>
              </div>
              {groupedRowCount > 0 && (
                <div className="flight-stage-group">
                  <span>
                    <strong>{groupedRange}</strong>
                    <small>{groupedRowCount} earlier powered stages</small>
                  </span>
                  <button
                    aria-controls={poweredRowsId}
                    aria-expanded={showAllPoweredStages}
                    aria-label={`${showAllPoweredStages ? "Collapse" : "Expand"} ${groupedRowCount} earlier powered stages, ${groupedRange.replace("–", " through ")}`}
                    onClick={() => setShowAllPoweredStages((expanded) => !expanded)}
                    type="button"
                  >{showAllPoweredStages ? "COLLAPSE" : "EXPAND"}</button>
                </div>
              )}
              <div className="flight-stage-rows" id={poweredRowsId}>
                {displayedRows.map(renderFlightStageRow)}
              </div>
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
