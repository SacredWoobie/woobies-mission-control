import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { isKerbinTime, useTimeSystem } from "../timeSystem";
import { formatDeltaV, formatTransferDuration } from "./calculations";
import { useDialogFocus } from "./useDialogFocus";

export interface PorkchopGrid {
  requestId: string;
  fingerprint: string;
  dateSamples: number;
  durationSamples: number;
  departureUTs: number[];
  transferTimes: number[];
  costs: (number | null)[];
  bestDepartureIndex: number;
  bestTransferTimeIndex: number;
}

export interface PorkchopEvaluation {
  requestId: string;
  fingerprint: string;
  departureIndex: number;
  transferTimeIndex: number;
  departureUT: number;
  arrivalUT: number;
  transferTime: number;
  ejectionDeltaV: number;
  arrivalVInfinity: number;
  rawCost: number;
  departureVInfinity?: [number, number, number];
  maneuverVectorSchema?: 1;
}

export interface PorkchopCell {
  departureIndex: number;
  transferTimeIndex: number;
}

export function formatMissionUT(universalTime: number, kerbin = true) {
  if (!Number.isFinite(universalTime)) return "Unknown date";
  const secondsPerDay = kerbin ? 21_600 : 86_400;
  const daysPerYear = kerbin ? 426 : 365;
  const wholeSeconds = Math.max(0, Math.floor(universalTime));
  const dayIndex = Math.floor(wholeSeconds / secondsPerDay);
  const year = Math.floor(dayIndex / daysPerYear) + 1;
  const day = dayIndex % daysPerYear + 1;
  const secondsToday = wholeSeconds % secondsPerDay;
  const hours = Math.floor(secondsToday / 3_600);
  const minutes = Math.floor(secondsToday % 3_600 / 60);
  return `Y${year}, D${day} ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function validCell(grid: PorkchopGrid, cell: PorkchopCell | null | undefined) {
  return Boolean(cell)
    && cell!.departureIndex >= 0
    && cell!.departureIndex < grid.dateSamples
    && cell!.transferTimeIndex >= 0
    && cell!.transferTimeIndex < grid.durationSamples;
}

function cellCost(grid: PorkchopGrid, cell: PorkchopCell) {
  return grid.costs[cell.departureIndex * grid.durationSamples + cell.transferTimeIndex];
}

export interface PorkchopFilters {
  maximumCost: number | null;
  earliestDepartureIndex: number;
  latestDepartureIndex: number;
  minimumFlightTimeIndex: number;
  maximumFlightTimeIndex: number;
}

export function porkchopCellMatchesFilters(grid: PorkchopGrid, cell: PorkchopCell, filters: PorkchopFilters, earliestDepartureUT?: number) {
  if (!validCell(grid, cell)) return false;
  const cost = cellCost(grid, cell);
  return typeof cost === "number"
    && Number.isFinite(cost)
    && cost >= 0
    && (earliestDepartureUT === undefined || grid.departureUTs[cell.departureIndex] >= earliestDepartureUT)
    && cell.departureIndex >= filters.earliestDepartureIndex
    && cell.departureIndex <= filters.latestDepartureIndex
    && cell.transferTimeIndex >= filters.minimumFlightTimeIndex
    && cell.transferTimeIndex <= filters.maximumFlightTimeIndex
    && (filters.maximumCost === null || cost <= filters.maximumCost);
}

export function porkchopBestCell(grid: PorkchopGrid, earliestDepartureUT?: number): PorkchopCell | null {
  let best: PorkchopCell | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let departureIndex = 0; departureIndex < grid.dateSamples; departureIndex += 1) {
    if (earliestDepartureUT !== undefined && grid.departureUTs[departureIndex] < earliestDepartureUT) continue;
    for (let transferTimeIndex = 0; transferTimeIndex < grid.durationSamples; transferTimeIndex += 1) {
      const cell = { departureIndex, transferTimeIndex };
      const cost = cellCost(grid, cell);
      if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0 && cost < bestCost) {
        best = cell;
        bestCost = cost;
      }
    }
  }
  return best;
}

export function porkchopColorRange(values: (number | null)[]) {
  const finite = values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (!finite.length) return { minimum: 0, maximum: 1 };
  const minimum = finite[0];
  const upperIndex = Math.floor((finite.length - 1) * .9);
  const percentileMaximum = finite[upperIndex];
  const maximum = percentileMaximum > minimum ? percentileMaximum : finite[finite.length - 1];
  return { minimum, maximum: maximum > minimum ? maximum : minimum + 1 };
}

export function porkchopHeatPosition(cost: number, range: { minimum: number; maximum: number }) {
  const linear = (cost - range.minimum) / Math.max(1, range.maximum - range.minimum);
  return Math.sqrt(Math.max(0, Math.min(1, linear)));
}

function heatColor(t: number) {
  const stops = [
    [50, 202, 178],
    [78, 201, 224],
    [111, 142, 192],
    [181, 116, 124],
    [226, 157, 82],
  ];
  const scaled = Math.max(0, Math.min(0.999, t)) * (stops.length - 1);
  const low = Math.floor(scaled);
  const amount = scaled - low;
  const from = stops[low];
  const to = stops[Math.min(low + 1, stops.length - 1)];
  return `rgb(${from.map((value, index) => Math.round(value + (to[index] - value) * amount)).join(",")})`;
}

function sameCell(left: PorkchopCell | null | undefined, right: PorkchopCell | null | undefined) {
  return Boolean(left && right)
    && left!.departureIndex === right!.departureIndex
    && left!.transferTimeIndex === right!.transferTimeIndex;
}

export function PorkchopPlotModal({
  arcLabel,
  constraintText,
  earliestDepartureUT,
  error,
  evaluation,
  grid,
  loading,
  onClose,
  onEvaluate,
  onGenerate,
  onUse,
  selected,
}: {
  arcLabel: string;
  constraintText?: string;
  earliestDepartureUT?: number;
  error?: string;
  evaluation?: PorkchopEvaluation;
  grid?: PorkchopGrid;
  loading: boolean;
  onClose(): void;
  onEvaluate(cell: PorkchopCell): void;
  onGenerate(): void;
  onUse(evaluation: PorkchopEvaluation): void;
  selected?: PorkchopEvaluation;
}) {
  const { system: timeSystem, toggleSystem } = useTimeSystem();
  const kerbinTime = isKerbinTime(timeSystem);
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<PorkchopCell | null>(null);
  const [maximumCostInput, setMaximumCostInput] = useState("");
  const [earliestDepartureFilter, setEarliestDepartureFilter] = useState<number | null>(null);
  const [latestDepartureFilter, setLatestDepartureFilter] = useState<number | null>(null);
  const [minimumFlightTimeFilter, setMinimumFlightTimeFilter] = useState<number | null>(null);
  const [maximumFlightTimeFilter, setMaximumFlightTimeFilter] = useState<number | null>(null);

  useEffect(() => {
    setHovered(null);
    setMaximumCostInput("");
    setEarliestDepartureFilter(null);
    setLatestDepartureFilter(null);
    setMinimumFlightTimeFilter(null);
    setMaximumFlightTimeFilter(null);
  }, [grid?.requestId]);

  const firstConstraintIndex = useMemo(() => {
    if (!grid || earliestDepartureUT === undefined) return 0;
    const found = grid.departureUTs.findIndex((departureUT) => departureUT >= earliestDepartureUT);
    return found >= 0 ? found : Math.max(0, grid.dateSamples - 1);
  }, [earliestDepartureUT, grid]);
  const earliestDepartureIndex = grid ? Math.max(firstConstraintIndex, Math.min(grid.dateSamples - 1, earliestDepartureFilter ?? firstConstraintIndex)) : 0;
  const latestDepartureIndex = grid ? Math.max(earliestDepartureIndex, Math.min(grid.dateSamples - 1, latestDepartureFilter ?? grid.dateSamples - 1)) : 0;
  const minimumFlightTimeIndex = grid ? Math.max(0, Math.min(grid.durationSamples - 1, minimumFlightTimeFilter ?? 0)) : 0;
  const maximumFlightTimeIndex = grid ? Math.max(minimumFlightTimeIndex, Math.min(grid.durationSamples - 1, maximumFlightTimeFilter ?? grid.durationSamples - 1)) : 0;
  const parsedMaximumCost = maximumCostInput.trim() === "" ? null : Number(maximumCostInput);
  const filters = useMemo<PorkchopFilters>(() => ({
    maximumCost: parsedMaximumCost !== null && Number.isFinite(parsedMaximumCost) && parsedMaximumCost >= 0 ? parsedMaximumCost : null,
    earliestDepartureIndex,
    latestDepartureIndex,
    minimumFlightTimeIndex,
    maximumFlightTimeIndex,
  }), [earliestDepartureIndex, latestDepartureIndex, maximumFlightTimeIndex, minimumFlightTimeIndex, parsedMaximumCost]);
  const bestCell = useMemo(() => grid ? porkchopBestCell(grid, earliestDepartureUT) : null, [earliestDepartureUT, grid]);
  const activeCell = hovered ?? evaluation ?? bestCell;
  const visibleCosts = useMemo(() => {
    if (!grid) return [];
    return grid.costs.filter((_, index) => porkchopCellMatchesFilters(grid, {
      departureIndex: Math.floor(index / grid.durationSamples),
      transferTimeIndex: index % grid.durationSamples,
    }, filters, earliestDepartureUT));
  }, [earliestDepartureUT, filters, grid]);
  const range = useMemo(() => porkchopColorRange(visibleCosts), [visibleCosts]);
  const counts = useMemo(() => {
    if (!grid) return { matching: 0, available: 0 };
    let matching = 0;
    let available = 0;
    for (let departureIndex = 0; departureIndex < grid.dateSamples; departureIndex += 1) {
      for (let transferTimeIndex = 0; transferTimeIndex < grid.durationSamples; transferTimeIndex += 1) {
        const cell = { departureIndex, transferTimeIndex };
        const cost = cellCost(grid, cell);
        const valid = typeof cost === "number" && Number.isFinite(cost) && cost >= 0
          && (earliestDepartureUT === undefined || grid.departureUTs[departureIndex] >= earliestDepartureUT);
        if (valid) available += 1;
        if (porkchopCellMatchesFilters(grid, cell, filters, earliestDepartureUT)) matching += 1;
      }
    }
    return { matching, available };
  }, [earliestDepartureUT, filters, grid]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !grid) return;
    const draw = () => {
      const context = canvas.getContext("2d");
      if (!context) return;
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
      const width = Math.max(240, canvas.clientWidth || Math.max(0, bounds.width - canvas.clientLeft * 2) || 640);
      const height = Math.max(180, canvas.clientHeight || Math.max(0, bounds.height - canvas.clientTop * 2) || 320);
      canvas.width = Math.floor(width * pixelRatio);
      canvas.height = Math.floor(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      const cellWidth = width / grid.dateSamples;
      const cellHeight = height / grid.durationSamples;
      for (let departureIndex = 0; departureIndex < grid.dateSamples; departureIndex += 1) {
        for (let transferTimeIndex = 0; transferTimeIndex < grid.durationSamples; transferTimeIndex += 1) {
          const cell = { departureIndex, transferTimeIndex };
          const cost = cellCost(grid, cell);
          const solvable = typeof cost === "number" && Number.isFinite(cost) && cost >= 0
            && (earliestDepartureUT === undefined || grid.departureUTs[departureIndex] >= earliestDepartureUT);
          const matches = porkchopCellMatchesFilters(grid, cell, filters, earliestDepartureUT);
          context.fillStyle = !solvable ? "rgba(65,75,83,.45)" : !matches ? "rgba(2,5,8,.94)" : heatColor(porkchopHeatPosition(cost, range));
          context.fillRect(departureIndex * cellWidth, height - (transferTimeIndex + 1) * cellHeight, Math.ceil(cellWidth) + .5, Math.ceil(cellHeight) + .5);
        }
      }
      const marker = (cell: PorkchopCell | undefined, color: string, shape: "circle" | "diamond") => {
        if (!cell || !validCell(grid, cell)) return;
        const x = (cell.departureIndex + .5) * cellWidth;
        const y = height - (cell.transferTimeIndex + .5) * cellHeight;
        context.save();
        context.strokeStyle = color;
        context.fillStyle = "rgba(7,13,19,.75)";
        context.lineWidth = 2;
        context.beginPath();
        if (shape === "diamond") {
          context.moveTo(x, y - 6);
          context.lineTo(x + 6, y);
          context.lineTo(x, y + 6);
          context.lineTo(x - 6, y);
          context.closePath();
        } else {
          context.arc(x, y, 6, 0, Math.PI * 2);
        }
        context.fill();
        context.stroke();
        context.restore();
      };
      marker(bestCell ?? undefined, "#effbff", "diamond");
      if (selected) marker(selected, "#ffb454", "circle");
      if (evaluation && !sameCell(evaluation, selected)) marker(evaluation, "#4ec9e0", "circle");
    };
    draw();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(draw);
    observer?.observe(canvas);
    window.addEventListener("resize", draw);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", draw);
    };
  }, [bestCell, earliestDepartureUT, evaluation, filters, grid, range.maximum, range.minimum, selected]);

  const cellFromPointer = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!grid) return null;
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    const width = canvas.clientWidth || Math.max(0, bounds.width - canvas.clientLeft * 2);
    const height = canvas.clientHeight || Math.max(0, bounds.height - canvas.clientTop * 2);
    if (width <= 0 || height <= 0) return null;
    const x = event.clientX - bounds.left - canvas.clientLeft;
    const y = event.clientY - bounds.top - canvas.clientTop;
    const departureIndex = Math.max(0, Math.min(grid.dateSamples - 1, Math.floor(x / width * grid.dateSamples)));
    const transferTimeIndex = Math.max(0, Math.min(grid.durationSamples - 1, Math.floor((1 - y / height) * grid.durationSamples)));
    const cell = { departureIndex, transferTimeIndex };
    return porkchopCellMatchesFilters(grid, cell, filters, earliestDepartureUT) ? cell : null;
  };
  const activeDepartureUT = grid && activeCell ? grid.departureUTs[activeCell.departureIndex] : undefined;
  const activeTransferTime = grid && activeCell ? grid.transferTimes[activeCell.transferTimeIndex] : undefined;
  const activeCost = grid && activeCell ? cellCost(grid, activeCell) : undefined;
  const idealDepartureUT = grid && bestCell ? grid.departureUTs[bestCell.departureIndex] : undefined;
  const idealTransferTime = grid && bestCell ? grid.transferTimes[bestCell.transferTimeIndex] : undefined;
  const idealCost = grid && bestCell ? cellCost(grid, bestCell) : undefined;
  const evaluationAllowed = Boolean(grid && evaluation) && porkchopCellMatchesFilters(grid!, evaluation!, filters, earliestDepartureUT);
  const resetFilters = () => {
    setMaximumCostInput("");
    setEarliestDepartureFilter(null);
    setLatestDepartureFilter(null);
    setMinimumFlightTimeFilter(null);
    setMaximumFlightTimeFilter(null);
  };

  return <div className="porkchop-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section aria-label={`${arcLabel} porkchop plot`} aria-modal="true" className="porkchop-modal" ref={dialogRef} role="dialog" tabIndex={-1}>
      <header>
        <div><span>TRANSFER WINDOW</span><h3>{arcLabel}</h3></div>
        <button aria-label="Close porkchop plot" onClick={onClose} type="button">×</button>
      </header>
      {constraintText && <p className="porkchop-constraint">{constraintText}</p>}
      {!grid ? <div className="porkchop-empty">
        <strong>{loading ? "Calculating transfer windows…" : "Generate a transfer window plot"}</strong>
        <small>MechJeb evaluates departure dates and flight times without creating maneuver nodes.</small>
        {!loading && <button type="button" onClick={onGenerate}>Generate porkchop plot</button>}
      </div> : <>
        <div className="porkchop-plot-shell">
          <div className="porkchop-y-label">FLIGHT TIME</div>
          <canvas
            aria-label={`Porkchop heatmap for ${arcLabel}. Lower-score windows progress from cyan toward higher-score amber windows.`}
            className="porkchop-canvas"
            ref={canvasRef}
            role="img"
            onClick={(event) => { const cell = cellFromPointer(event); if (cell) onEvaluate(cell); }}
            onMouseLeave={() => setHovered(null)}
            onMouseMove={(event) => setHovered(cellFromPointer(event))}
          />
          <div className="porkchop-x-label">DEPARTURE DATE</div>
        </div>
        <div className="porkchop-legend"><span>LOWER SCORE</span><i /><span>HIGHER SCORE</span><b>SCORE = EJECTION + ARRIVAL V∞</b><b>◇ BEST</b><b>○ SELECTED</b></div>
        <div className="porkchop-readouts">
          {activeCell && <div className="porkchop-hover-readout" aria-live="polite">
            <strong>CURSOR / EVALUATED</strong>
            <span>Depart <b>{formatMissionUT(Number(activeDepartureUT), kerbinTime)}</b></span>
            <span>Flight <b>{formatTransferDuration(Number(activeTransferTime), kerbinTime)}</b></span>
            <span>Transfer score <b>{typeof activeCost === "number" && Number.isFinite(activeCost) ? formatDeltaV(activeCost) : "No solution"}</b></span>
          </div>}
          <div className="porkchop-ideal-readout">
            <strong>NEXT IDEAL TRANSFER</strong>
            <span>Score <b>{typeof idealCost === "number" && Number.isFinite(idealCost) ? formatDeltaV(idealCost) : "No solution"}</b></span>
            <span>Depart <b>{formatMissionUT(Number(idealDepartureUT), kerbinTime)}</b></span>
            <span>Flight <b>{formatTransferDuration(typeof idealTransferTime === "number" ? idealTransferTime : null, kerbinTime)}</b></span>
          </div>
        </div>
        <section aria-label="Porkchop filters" className="porkchop-filters">
          <header><div><strong>FILTER WINDOWS</strong><span>{counts.matching.toLocaleString()} of {counts.available.toLocaleString()} solutions visible</span></div><div><button aria-label={`Time system: ${kerbinTime ? "Kerbin" : "Earth"}`} className="calendar-toggle" onClick={toggleSystem} type="button">[{kerbinTime ? "KERBIN" : "EARTH"}]</button><button onClick={resetFilters} type="button">RESET</button></div></header>
          <div className="porkchop-filter-grid">
            <label className="porkchop-cost-filter"><span>MAXIMUM SCORE</span><div><input aria-label="Maximum transfer score filter" min="0" placeholder={typeof idealCost === "number" ? String(Math.ceil(idealCost / 100) * 100) : undefined} step="10" type="number" value={maximumCostInput} onChange={(event) => setMaximumCostInput(event.target.value)} /><b>m/s</b></div></label>
            <div className="porkchop-range-filter"><span>DEPARTURE RANGE</span><label><b>From {formatMissionUT(grid.departureUTs[earliestDepartureIndex], kerbinTime)}</b><input aria-label="Earliest departure filter" min={firstConstraintIndex} max={grid.dateSamples - 1} type="range" value={earliestDepartureIndex} onChange={(event) => { const next = Number(event.target.value); setEarliestDepartureFilter(next); if (next > latestDepartureIndex) setLatestDepartureFilter(next); }} /></label><label><b>Through {formatMissionUT(grid.departureUTs[latestDepartureIndex], kerbinTime)}</b><input aria-label="Latest departure filter" min={firstConstraintIndex} max={grid.dateSamples - 1} type="range" value={latestDepartureIndex} onChange={(event) => { const next = Number(event.target.value); setLatestDepartureFilter(next); if (next < earliestDepartureIndex) setEarliestDepartureFilter(next); }} /></label></div>
            <div className="porkchop-range-filter"><span>FLIGHT-TIME RANGE</span><label><b>From {formatTransferDuration(grid.transferTimes[minimumFlightTimeIndex], kerbinTime)}</b><input aria-label="Minimum flight time filter" min="0" max={grid.durationSamples - 1} type="range" value={minimumFlightTimeIndex} onChange={(event) => { const next = Number(event.target.value); setMinimumFlightTimeFilter(next); if (next > maximumFlightTimeIndex) setMaximumFlightTimeFilter(next); }} /></label><label><b>Through {formatTransferDuration(grid.transferTimes[maximumFlightTimeIndex], kerbinTime)}</b><input aria-label="Maximum flight time filter" min="0" max={grid.durationSamples - 1} type="range" value={maximumFlightTimeIndex} onChange={(event) => { const next = Number(event.target.value); setMaximumFlightTimeFilter(next); if (next < minimumFlightTimeIndex) setMinimumFlightTimeFilter(next); }} /></label></div>
          </div>
        </section>
      </>}
      {evaluation && <div className="porkchop-evaluation">
        <div><span>DEPARTURE</span><strong>{formatMissionUT(evaluation.departureUT, kerbinTime)}</strong></div>
        <div><span>ARRIVAL</span><strong>{formatMissionUT(evaluation.arrivalUT, kerbinTime)}</strong></div>
        <div><span>ROUTE EJECTION</span><strong>{formatDeltaV(evaluation.ejectionDeltaV)}</strong></div>
        <div><span>ARRIVAL V∞</span><strong>{formatDeltaV(evaluation.arrivalVInfinity)}</strong></div>
      </div>}
      {error && <p className="porkchop-error" role="alert">{error}</p>}
      <footer>
        <button type="button" onClick={onClose}>Cancel</button>
        <button disabled={!evaluationAllowed || loading} type="button" onClick={() => evaluationAllowed && evaluation && onUse(evaluation)}>Use this transfer</button>
      </footer>
    </section>
  </div>;
}
