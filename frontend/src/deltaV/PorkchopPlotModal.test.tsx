// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeSystemProvider } from "../timeSystem";
import { PorkchopPlotModal, formatMissionUT, porkchopBestCell, porkchopCellMatchesFilters, porkchopColorRange, porkchopHeatPosition, type PorkchopEvaluation, type PorkchopFilters, type PorkchopGrid } from "./PorkchopPlotModal";

const grid: PorkchopGrid = {
  requestId: "req-1",
  fingerprint: "fp-1",
  dateSamples: 3,
  durationSamples: 2,
  departureUTs: [0, 21_600, 43_200],
  transferTimes: [86_400, 172_800],
  costs: [1500, 1450, 1200, 1100, 1800, 1600],
  bestDepartureIndex: 1,
  bestTransferTimeIndex: 1,
};

const evaluation: PorkchopEvaluation = {
  requestId: "req-1",
  fingerprint: "fp-1",
  departureIndex: 1,
  transferTimeIndex: 1,
  departureUT: 21_600,
  arrivalUT: 194_400,
  transferTime: 172_800,
  ejectionDeltaV: 900,
  arrivalVInfinity: 300,
  rawCost: 1100,
};

describe("porkchop plot modal", () => {
  beforeEach(() => vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null));
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

  it("offers an explicit grid calculation before data is available", () => {
    const generate = vi.fn();
    render(<PorkchopPlotModal arcLabel="Kerbin → Duna" loading={false} onClose={() => undefined} onEvaluate={() => undefined} onGenerate={generate} onUse={() => undefined} />);
    expect(screen.getByRole("dialog", { name: "Kerbin → Duna porkchop plot" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Generate porkchop plot" }));
    expect(generate).toHaveBeenCalledOnce();
  });

  it("keeps extreme high-cost cells from flattening the useful color range", () => {
    const costs = [2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700, 2800, 2900, 1_000_000];
    const range = porkchopColorRange(costs);

    expect(range).toEqual({ minimum: 2000, maximum: 2900 });
    expect(porkchopHeatPosition(2450, range)).toBeCloseTo(Math.SQRT1_2);
    expect(porkchopHeatPosition(1_000_000, range)).toBe(1);
  });

  it("keeps the next ideal transfer visible independently of the active cell", () => {
    render(<PorkchopPlotModal arcLabel="Kerbin â†’ Duna" evaluation={{ ...evaluation, departureIndex: 2, transferTimeIndex: 0, departureUT: 43_200, transferTime: 86_400, rawCost: 1800 }} grid={grid} loading={false} onClose={() => undefined} onEvaluate={() => undefined} onGenerate={() => undefined} onUse={() => undefined} />);

    const ideal = screen.getByText("NEXT IDEAL TRANSFER").parentElement;
    expect(ideal?.textContent).toContain("1,100 m/s");
    expect(ideal?.textContent).toContain("Y1, D2 00:00");
    expect(ideal?.textContent).toContain("8d 0h");
    expect(screen.getByText("CURSOR / EVALUATED").parentElement?.textContent).toContain("Transfer score 1,800 m/s");
    expect(screen.getByText("NEXT IDEAL TRANSFER").parentElement?.textContent).toContain("Score 1,100 m/s");
    expect(screen.getByText("ROUTE EJECTION").parentElement?.textContent).toContain("900 m/s");
    expect(screen.getByText("SCORE = EJECTION + ARRIVAL V∞")).toBeTruthy();
  });

  it("applies cost, departure, and flight-time filters to cells", () => {
    const filters: PorkchopFilters = {
      maximumCost: 1_500,
      earliestDepartureIndex: 1,
      latestDepartureIndex: 2,
      minimumFlightTimeIndex: 0,
      maximumFlightTimeIndex: 0,
    };

    expect(porkchopCellMatchesFilters(grid, { departureIndex: 1, transferTimeIndex: 0 }, filters)).toBe(true);
    expect(porkchopCellMatchesFilters(grid, { departureIndex: 0, transferTimeIndex: 0 }, filters)).toBe(false);
    expect(porkchopCellMatchesFilters(grid, { departureIndex: 1, transferTimeIndex: 1 }, filters)).toBe(false);
    expect(porkchopCellMatchesFilters(grid, { departureIndex: 2, transferTimeIndex: 0 }, filters)).toBe(false);
    expect(porkchopBestCell(grid)).toEqual({ departureIndex: 1, transferTimeIndex: 1 });
  });

  it("masks cells over the transfer-score limit and prevents selecting them", async () => {
    const fills: string[] = [];
    const context = {
      fillStyle: "", strokeStyle: "", lineWidth: 0,
      setTransform: vi.fn(), clearRect: vi.fn(),
      fillRect: vi.fn(() => fills.push(context.fillStyle)),
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    };
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const evaluate = vi.fn();
    render(<PorkchopPlotModal arcLabel="Kerbin â†’ Duna" grid={grid} loading={false} onClose={() => undefined} onEvaluate={evaluate} onGenerate={() => undefined} onUse={() => undefined} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Maximum transfer score filter" }), { target: { value: "1300" } });
    await waitFor(() => expect(screen.getByText("2 of 6 solutions visible")).toBeTruthy());
    expect(fills).toContain("rgba(2,5,8,.94)");

    const canvas = screen.getByRole("img", { name: /Porkchop heatmap/ });
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 200, width: 300, height: 200, toJSON: () => ({}) });
    fireEvent.click(canvas, { clientX: 50, clientY: 150 });
    expect(evaluate).not.toHaveBeenCalled();
    fireEvent.click(canvas, { clientX: 150, clientY: 150 });
    expect(evaluate).toHaveBeenCalledWith({ departureIndex: 1, transferTimeIndex: 0 });
  });

  it("formats departure and flight filters in the shared time system", () => {
    render(<TimeSystemProvider><PorkchopPlotModal arcLabel="Kerbin â†’ Duna" grid={grid} loading={false} onClose={() => undefined} onEvaluate={() => undefined} onGenerate={() => undefined} onUse={() => undefined} /></TimeSystemProvider>);
    expect(screen.getAllByText(/Y1, D2 00:00/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Time system: Kerbin" }));
    expect(screen.getByRole("button", { name: "Time system: Earth" })).toBeTruthy();
    expect(screen.getAllByText(/Y1, D1 06:00/).length).toBeGreaterThan(0);
    expect(formatMissionUT(21_600, false)).toBe("Y1, D1 06:00");
  });

  it("narrows the visible set by departure and flight-time ranges", () => {
    render(<PorkchopPlotModal arcLabel="Kerbin â†’ Duna" grid={grid} loading={false} onClose={() => undefined} onEvaluate={() => undefined} onGenerate={() => undefined} onUse={() => undefined} />);
    expect(screen.getByText("6 of 6 solutions visible")).toBeTruthy();
    fireEvent.change(screen.getByRole("slider", { name: "Earliest departure filter" }), { target: { value: "2" } });
    expect(screen.getByText("2 of 6 solutions visible")).toBeTruthy();
    fireEvent.change(screen.getByRole("slider", { name: "Maximum flight time filter" }), { target: { value: "0" } });
    expect(screen.getByText("1 of 6 solutions visible")).toBeTruthy();
  });

  it("maps a canvas click to departure-major grid coordinates", () => {
    const evaluate = vi.fn();
    render(<PorkchopPlotModal arcLabel="Kerbin → Duna" grid={grid} loading={false} onClose={() => undefined} onEvaluate={evaluate} onGenerate={() => undefined} onUse={() => undefined} />);
    const canvas = screen.getByRole("img", { name: /Porkchop heatmap/ });
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 200, width: 300, height: 200, toJSON: () => ({}) });
    fireEvent.click(canvas, { clientX: 250, clientY: 150 });
    expect(evaluate).toHaveBeenCalledWith({ departureIndex: 2, transferTimeIndex: 0 });
  });

  it("redraws at capped device resolution and maps pointers against the canvas content box", () => {
    let resize: ResizeObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal("devicePixelRatio", 3);
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe() {}
      disconnect() { disconnect(); }
      unobserve() {}
    });
    const context = {
      fillStyle: "", strokeStyle: "", lineWidth: 0,
      setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(),
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    };
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const evaluate = vi.fn();
    const view = render(<PorkchopPlotModal arcLabel="Kerbin to Duna" grid={grid} loading={false} onClose={() => undefined} onEvaluate={evaluate} onGenerate={() => undefined} onUse={() => undefined} />);
    const canvas = screen.getByRole("img", { name: /Porkchop heatmap/ }) as HTMLCanvasElement;
    Object.defineProperties(canvas, {
      clientHeight: { configurable: true, value: 210 },
      clientLeft: { configurable: true, value: 1 },
      clientTop: { configurable: true, value: 1 },
      clientWidth: { configurable: true, value: 420 },
    });
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ x: 10, y: 20, top: 20, left: 10, right: 432, bottom: 232, width: 422, height: 212, toJSON: () => ({}) });

    resize?.([], {} as ResizeObserver);

    expect(canvas.width).toBe(840);
    expect(canvas.height).toBe(420);
    expect(context.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
    fireEvent.click(canvas, { clientX: 361, clientY: 178.5 });
    expect(evaluate).toHaveBeenCalledWith({ departureIndex: 2, transferTimeIndex: 0 });
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("shows exact details and applies the evaluated transfer", () => {
    const use = vi.fn();
    render(<PorkchopPlotModal arcLabel="Kerbin → Duna" evaluation={evaluation} grid={grid} loading={false} onClose={() => undefined} onEvaluate={() => undefined} onGenerate={() => undefined} onUse={use} />);
    expect(screen.getAllByText("Y1, D2 00:00").length).toBeGreaterThan(0);
    expect(screen.getByText("900 m/s")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use this transfer" }));
    expect(use).toHaveBeenCalledWith(evaluation);
  });

  it("surfaces a downstream departure constraint", () => {
    render(<PorkchopPlotModal arcLabel="Duna → Kerbin" constraintText="Return departures begin after Y2, D10" loading={false} onClose={() => undefined} onEvaluate={() => undefined} onGenerate={() => undefined} onUse={() => undefined} />);
    expect(screen.getByText("Return departures begin after Y2, D10")).toBeTruthy();
  });

  it("does not evaluate return cells before the earliest departure", () => {
    const evaluate = vi.fn();
    render(<PorkchopPlotModal arcLabel="Duna → Kerbin" earliestDepartureUT={43_200} grid={grid} loading={false} onClose={() => undefined} onEvaluate={evaluate} onGenerate={() => undefined} onUse={() => undefined} />);
    const canvas = screen.getByRole("img", { name: /Porkchop heatmap/ });
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 200, width: 300, height: 200, toJSON: () => ({}) });
    fireEvent.click(canvas, { clientX: 50, clientY: 100 });
    expect(evaluate).not.toHaveBeenCalled();
    fireEvent.click(canvas, { clientX: 250, clientY: 100 });
    expect(evaluate).toHaveBeenCalledOnce();
  });
});
