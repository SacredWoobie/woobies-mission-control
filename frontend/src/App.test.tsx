// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ConsumablesPanel } from "./components/ConsumablesPanel";
import { StagingPanel } from "./components/StagingPanel";
import { balanceContiguousPanelLanes, flightPanelOwner } from "./flight/layout";
import {
  editorTelemetryFixture,
  flightTelemetryFixture,
  fractionalStageElectricChargeFixture,
  inactiveTelemetryFixture,
} from "./telemetry/fixtures";
import { liveTelemetryStore } from "./telemetry/store";
import { consumablesSnapshotsEqual } from "./telemetry/subscriptions";
import { useLiveTelemetrySelector } from "./telemetry/useLiveTelemetry";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly sent: string[] = [];

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  drop() {
    this.close();
  }

  message(snapshot: object) {
    this.onmessage?.({ data: JSON.stringify(snapshot) });
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  send(data: string) {
    this.sent.push(data);
  }
}

function openLiveConnection() {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "DEV" }));
  fireEvent.change(screen.getByLabelText("Live endpoint", { exact: true }), {
    target: { value: "ws://127.0.0.1:8091" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  const socket = FakeWebSocket.instances.at(-1)!;
  act(() => socket.open());
  return socket;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  liveTelemetryStore.disconnect();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  liveTelemetryStore.disconnect();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Dashboard lifecycle", () => {
  it("assigns every flight panel to its stable fixed or workspace owner", () => {
    ["asc", "cons", "stage"].forEach((id) => {
      expect(flightPanelOwner(id as "asc")).toBe("fixed");
    });
    ["heat", "elec", "sci", "target"].forEach((id) => {
      expect(flightPanelOwner(id as "elec")).toBe("monitor");
    });
    ["flightNote", "flightOrbitPlan", "flightDeltaVPlan"].forEach((id) => {
      expect(flightPanelOwner(id as "flightNote")).toBe("plan");
    });
  });

  it("cascades wide flight panels vertically before moving to the next lane", () => {
    expect(balanceContiguousPanelLanes(
      ["elec", "heat", "sci", "stage", "flightOrbitPlan", "flightDeltaVPlan"],
      {
        heat: 229,
        elec: 213,
        sci: 169,
        stage: 328,
        flightOrbitPlan: 313,
        flightDeltaVPlan: 654,
      },
    )).toEqual([
      ["elec", "heat", "sci"],
      ["stage", "flightOrbitPlan"],
      ["flightDeltaVPlan"],
    ]);
  });

  it("fills wide flow lanes to the fixed primary-column height before moving right", () => {
    expect(balanceContiguousPanelLanes(
      ["elec", "heat", "sci", "stage"],
      {
        elec: 197,
        heat: 229,
        sci: 169,
        stage: 328,
      },
      3,
      612,
    )).toEqual([
      ["elec", "heat"],
      ["sci", "stage"],
      [],
    ]);
  });

  it("shares and persists the selected mission time system", () => {
    const firstView = render(<App />);
    expect(firstView.container.querySelector(".clock-primary-row .big")).toBeTruthy();
    expect(firstView.container.querySelector(".clock-primary-row")?.textContent).toContain("UT");
    fireEvent.click(screen.getByRole("button", { name: "Time system: Kerbin" }));
    expect(screen.getByRole("button", { name: "Time system: Earth" })).toBeTruthy();
    expect(localStorage.getItem("wmc-time-system-v1")).toBe("earth");
    firstView.unmount();

    render(<App />);
    expect(screen.getByRole("button", { name: "Time system: Earth" })).toBeTruthy();
  });

  it("renders the complete flight dashboard with in-place Flight panel collapse", () => {
    const firstView = render(<App />);
    expect(screen.getByText("Woobie's Mission Control · React dashboard · v0.4.4 · Development")).toBeTruthy();
    ["Datalink", "Flight context", "Ascension", "Consumables", "Heat Management", "Electricity", "Science", "Staging analysis", "Target"].forEach((heading) => {
      expect(screen.getByRole("heading", { name: new RegExp(`^${heading}`) })).toBeTruthy();
    });
    expect(screen.queryByRole("heading", { name: /^Pinned note/ })).toBeNull();
    expect(screen.getByRole("tab", { name: "MONITOR" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "PLAN" }).getAttribute("aria-selected")).toBe("false");
    const monitorTab = screen.getByRole("tab", { name: "MONITOR" });
    const planTab = screen.getByRole("tab", { name: "PLAN" });
    monitorTab.focus();
    fireEvent.keyDown(monitorTab, { key: "ArrowRight" });
    expect(planTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(planTab);
    fireEvent.keyDown(planTab, { key: "Home" });
    expect(monitorTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(monitorTab);
    const flightContext = firstView.container.querySelector("#clock");
    expect(flightContext?.textContent).toContain("Odyssey");
    expect(flightContext?.textContent).toContain("Kerbin");
    expect(flightContext?.textContent).toContain("Orbiting");
    expect(screen.queryByRole("button", { name: "Hide Flight context panel" })).toBeNull();
    expect(firstView.container.querySelector("#target .tag")?.textContent).toBe("Odyssey Station Docking Port");
    expect((screen.getByRole("button", { name: "UNSET TARGET" }) as HTMLButtonElement).disabled).toBe(true);
    expect(firstView.container.querySelector("#target .tgt-name")?.textContent).toBe("Odyssey Station Docking Port");
    expect(firstView.container.querySelector("#target")?.textContent).toContain("2.3\u2009m/s");
    expect(screen.getAllByRole("button", { name: "Notes" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Notes" }).querySelector(".panel-rail-icon-notes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Notes" }).querySelector(".panel-rail-label")?.textContent).toBe("Notes");
    screen.getByRole("navigation", { name: "Dashboard controls" });
    const toolsGroup = screen.getByRole("group", { name: "Tools" });
    const resonantTool = screen.getByRole("button", { name: "Resonant orbit planner" });
    const deltaVTool = screen.getByRole("button", { name: "Delta-v planner" });
    expect(toolsGroup.textContent).toContain("Tools");
    expect(toolsGroup.contains(resonantTool)).toBe(true);
    expect(toolsGroup.contains(deltaVTool)).toBe(true);
    expect(resonantTool.classList.contains("dashboard-tool-button")).toBe(true);
    expect(deltaVTool.classList.contains("dashboard-tool-button")).toBe(true);
    expect(resonantTool.querySelector(".panel-rail-label")?.textContent).toBe("Resonant Orbit Planner");
    expect(deltaVTool.querySelector(".panel-rail-label")?.textContent).toBe("Delta-V Planner");
    expect(firstView.container.querySelector("#conn")?.textContent).not.toContain("Notes");
    expect(firstView.container.querySelector("svg.spark")?.getAttribute("preserveAspectRatio")).toBe("none");
    expect(firstView.container.querySelector(".nav-sky")).toBeTruthy();
    expect(firstView.container.querySelector(".nav-ground")).toBeTruthy();
    const fixedRegion = firstView.container.querySelector('[data-flight-region="fixed"]');
    const tabbedRegion = firstView.container.querySelector('[data-flight-region="tabbed"]');
    const monitorView = tabbedRegion?.querySelector('[data-flight-workspace-view="monitor"]');
    const planView = tabbedRegion?.querySelector('[data-flight-workspace-view="plan"]');
    const ascensionSlot = fixedRegion?.querySelector(".flight-panel-slot-asc");
    expect(ascensionSlot?.querySelector("#asc")).toBeTruthy();
    expect(fixedRegion?.querySelector("#cons")).toBeTruthy();
    expect(fixedRegion?.querySelector("#stage")).toBeTruthy();
    expect(monitorView?.querySelector("#target")).toBeTruthy();
    expect(monitorView?.querySelector("#heat")).toBeTruthy();
    expect(monitorView?.querySelector("#elec")).toBeTruthy();
    expect(monitorView?.querySelector("#sci")).toBeTruthy();
    expect(planView?.querySelector("#flightNote")).toBeTruthy();
    expect([...firstView.container.querySelectorAll("[data-flight-panel]")].map((slot) => slot.getAttribute("data-flight-panel"))).toEqual([
      "asc", "cons", "stage", "elec", "heat", "sci", "target", "flightNote",
    ]);
    const pinnedNote = firstView.container.querySelector("#flightNote");
    expect(pinnedNote?.querySelector("h2 .flight-note-name")?.textContent).toBe("log_Odyssey");
    expect(pinnedNote?.querySelector("h2 .notes-font-controls")).toBeTruthy();
    expect(pinnedNote?.querySelector("h2 .flight-note-unpin")).toBeTruthy();
    expect(pinnedNote?.querySelector(".body")?.firstElementChild?.className).toBe("flight-note-meta");
    fireEvent.click(screen.getByRole("tab", { name: "PLAN" }));
    expect(screen.getByRole("heading", { name: /^Pinned note/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^Electricity/ })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "MONITOR" }));
    expect(flightTelemetryFixture["stage.totalDvAtmo"]).toBe(flightTelemetryFixture["stage.totalDvVac"]);
    expect(screen.queryByRole("button", { name: "CURRENT" })).toBeNull();
    expect(screen.queryByRole("button", { name: "VACUUM" })).toBeNull();
    expect(screen.getByText("Total Δv · vacuum", { exact: true })).toBeTruthy();
    expect(screen.getByText("Δv current", { exact: true })).toBeTruthy();
    expect(screen.getByText("Δv vac", { exact: true })).toBeTruthy();

    const heatNode = firstView.container.querySelector("#heat");
    fireEvent.click(screen.getByRole("button", { name: "Collapse Heat Management" }));
    expect(firstView.container.querySelector("#heat")).toBe(heatNode);
    expect(heatNode?.classList.contains("panel-collapsed")).toBe(true);
    expect((heatNode?.querySelector(".body") as HTMLElement).hidden).toBe(true);
    expect(screen.queryByRole("button", { name: "Heat" })).toBeNull();
    expect(JSON.parse(localStorage.getItem("wmc-hidden-panels-v1") ?? "[]")).not.toContain("heat");
    fireEvent.click(screen.getByRole("button", { name: "Expand Heat Management" }));
    expect((heatNode?.querySelector(".body") as HTMLElement).hidden).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Ascension" }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse Consumables" }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse Staging analysis" }));
    expect(fixedRegion?.hasAttribute("hidden")).toBe(false);
    expect(firstView.container.querySelector(".flight-workspace-shell")?.getAttribute("data-fixed-empty")).toBe("false");
    fireEvent.click(screen.getByRole("tab", { name: "PLAN" }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse Pinned note" }));
    expect(firstView.container.querySelector("#flightNote")?.classList.contains("panel-collapsed")).toBe(true);
    expect(screen.queryByRole("button", { name: "Pinned note" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand Pinned note" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase pinned note text size" }));
    expect(screen.getByRole("button", { name: "Reset pinned note text size" }).textContent).toBe("15px");
    fireEvent.click(screen.getByRole("button", { name: "Collapse Pinned note" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand Pinned note" }));
    expect(screen.getByRole("button", { name: "Reset pinned note text size" }).textContent).toBe("15px");
    expect(firstView.container.querySelector("[data-flight-panel=\"asc\"]")).toBeTruthy();
    expect(firstView.container.querySelector("[data-flight-panel=\"cons\"]")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "MONITOR" }));
    firstView.unmount();

    localStorage.setItem("wmc-hidden-panels-v1", JSON.stringify(["sci"]));
    const packedView = render(<App />);
    expect(screen.getByRole("heading", { name: /^Science/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Science" })).toBeNull();
    expect(packedView.container.querySelector("#sci")).toBeTruthy();
    expect(packedView.container.querySelector('[data-flight-panel-host="sci"]')?.getAttribute("aria-hidden")).not.toBe("true");
    expect(JSON.parse(localStorage.getItem("wmc-hidden-panels-v1") ?? "[]")).not.toContain("sci");
  });

  it("removes ElectricCharge from Flight Consumables", () => {
    const { container } = render(
      <ConsumablesPanel snapshot={fractionalStageElectricChargeFixture} />,
    );
    expect(container.querySelector("#cons > h2 .tag")?.textContent).toBe("Liquid Fuel 100%");
    expect(container.textContent).not.toContain("Electric Charge");
    expect(container.textContent).toContain("Liquid Fuel");
  });

  it("renders unavailable and pending lifecycle states without stale values", () => {
    const unavailableResources = {
      ...flightTelemetryFixture,
      "res.stageKnown": false,
    };
    const resourceView = render(<ConsumablesPanel snapshot={unavailableResources} />);
    expect(resourceView.container.textContent).toContain("Current-stage column unavailable");
    resourceView.unmount();

    render(<StagingPanel snapshot={{
      ...flightTelemetryFixture,
      "stage.pending": true,
      "stage.stages": [],
    }} />);
    expect(screen.getByText("Calculating staging simulation…", { exact: true })).toBeTruthy();
  });

  it("handles live scenes, Notes continuity, Editor commands, drop, and reconnect", () => {
    const firstSocket = openLiveConnection();
    expect(screen.getByRole("button", { name: "Datalink" })).toBeTruthy();

    act(() => firstSocket.message(flightTelemetryFixture));
    expect(screen.queryByRole("heading", { name: /Datalink/ })).toBeNull();
    const datalinkRestore = screen.getByRole("button", { name: "Datalink" });
    expect(datalinkRestore.classList.contains("datalink-rail-tab")).toBe(true);
    expect(datalinkRestore.querySelector(".panel-rail-icon-conn")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("wmc-hidden-panels-v1") ?? "[]")).not.toContain("conn");
    fireEvent.click(datalinkRestore);
    expect(screen.getByRole("heading", { name: /Datalink/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Datalink" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    expect(screen.getByRole("dialog", { name: "Notes continuity preview" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close Notes drawer" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Close Notes preview" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Crew Checklist" }));
    expect(JSON.parse(firstSocket.sent.at(-1)!)).toEqual({
      type: "notes.select",
      relativePath: "Crew Checklist.txt",
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove Crew Checklist from favorites" }));
    expect(JSON.parse(firstSocket.sent.at(-1)!)).toEqual({
      type: "notes.favorite",
      relativePath: "Crew Checklist.txt",
      favorite: false,
    });

    act(() => firstSocket.message(editorTelemetryFixture));
    expect(screen.getByRole("dialog", { name: "Notes continuity preview" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Notes reference" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close Notes preview" }));
    expect(screen.getAllByText("EDITOR LINK", { exact: true })).toHaveLength(2);
    expect(screen.getByRole("heading", { name: /Datalink/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Craft summary/ })).toBeTruthy();
    expect(screen.getByText("Dual-condition regression craft", { exact: true })).toBeTruthy();
    expect(screen.getByText("Analysis current", { exact: true })).toBeTruthy();
    expect(screen.queryByText("KSP stages activate from the highest stage number down to S0.")).toBeNull();
    expect(screen.queryByText("Launch stage", { exact: true })).toBeNull();
    expect(screen.getByText("Stage", { exact: true })).toBeTruthy();
    const editorStageTotals = document.querySelector(".editor-stage-total-dv");
    expect(editorStageTotals?.textContent).toContain("Total Δv");
    expect(editorStageTotals?.textContent).toContain("Atmo:");
    expect(editorStageTotals?.textContent).toContain("|");
    expect(editorStageTotals?.textContent).toContain("Vac:");
    expect(screen.queryByText(/Atmospheric \+ vacuum/i)).toBeNull();
    expect(screen.getByText("18,742 kg", { exact: true })).toBeTruthy();
    expect(screen.getByText("√42,580", { exact: true })).toBeTruthy();
    expect(screen.getByText("Liquid Fuel", { exact: true })).toBeTruthy();
    expect(screen.queryByText(/revision/i)).toBeNull();
    const editorWorkspace = document.querySelector(".editor-workspace");
    const editorPrimary = editorWorkspace?.querySelector(".editor-workspace-primary");
    const editorSecondary = editorWorkspace?.querySelector(".editor-workspace-secondary");
    expect(editorPrimary?.firstElementChild?.id).toBe("editorContext");
    expect(editorPrimary?.children[1]?.classList.contains("editor-staging-slice")).toBe(true);
    expect(editorPrimary?.lastElementChild?.id).toBe("editorSummary");
    expect(editorSecondary?.querySelector("#editorSummary")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Craft analysis" }));
    expect(document.querySelector("#editorContext")?.classList.contains("panel-collapsed")).toBe(true);
    expect(screen.queryByLabelText("Reference body")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand Craft analysis" }));
    expect(screen.getByLabelText("Reference body")).toBeTruthy();

    const commandsBeforeEditorChange = firstSocket.sent.length;
    fireEvent.change(screen.getByLabelText("Altitude ASL (m)", { exact: true }), {
      target: { value: "10000" },
    });
    fireEvent.change(screen.getByLabelText("Mach", { exact: true }), {
      target: { value: "0.8" },
    });
    act(() => vi.advanceTimersByTime(149));
    expect(firstSocket.sent).toHaveLength(commandsBeforeEditorChange);
    act(() => vi.advanceTimersByTime(1));
    fireEvent.click(screen.getByRole("button", { name: "Recalculate now" }));
    expect(JSON.parse(firstSocket.sent.at(-1)!)).toEqual({
      type: "editor.conditions",
      body: "Kerbin",
      altitude: 10000,
      mach: 0.8,
    });
    expect(JSON.parse(firstSocket.sent.at(-2)!)).toEqual({
      type: "editor.conditions",
      altitude: 10000,
      mach: 0.8,
    });
    expect(screen.getByText("Recalculating…", { exact: true })).toBeTruthy();

    act(() => firstSocket.message({
      ...editorTelemetryFixture,
      "editor.altitude": 10000,
      "editor.mach": 0.8,
      "editor.revision": 9,
    }));
    expect(screen.getByText("Analysis current", { exact: true })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Reference body", { exact: true }), {
      target: { value: "Duna" },
    });
    act(() => vi.advanceTimersByTime(150));
    expect(JSON.parse(firstSocket.sent.at(-1)!)).toEqual({
      type: "editor.conditions",
      body: "Duna",
    });

    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    act(() => firstSocket.message(inactiveTelemetryFixture));
    expect(screen.getByRole("dialog", { name: "Notes continuity preview" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close Notes preview" }));
    expect(screen.getAllByText("MISSION CONTROL LINK", { exact: true })).toHaveLength(1);
    expect(document.querySelector(".inactive-mode .slice-status")).toBeNull();
    expect(screen.getByRole("heading", { name: /Datalink/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Woobie's Mission Control" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Transfer windows" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Active vessels" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Astronaut roster" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Upcoming alarms" })).toBeTruthy();
    expect(screen.queryByText("Consumables", { exact: true })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    act(() => firstSocket.drop());
    expect(screen.getByRole("dialog", { name: "Notes continuity preview" })).toBeTruthy();
    expect(screen.getByText("Notes unavailable", { exact: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close Notes preview" }));
    expect(screen.getAllByText("RETRYING", { exact: true }).length).toBeGreaterThan(0);

    act(() => vi.advanceTimersByTime(2_000));
    expect(FakeWebSocket.instances).toHaveLength(2);
    const secondSocket = FakeWebSocket.instances[1];
    act(() => {
      secondSocket.open();
      secondSocket.message(flightTelemetryFixture);
    });
    expect(screen.getByRole("button", { name: "Datalink" })).toBeTruthy();
    expect(screen.getAllByText("Odyssey", { exact: true }).length).toBeGreaterThan(0);
  });

  it("does not rerender a consumables subscriber for unrelated frames", () => {
    let renders = 0;
    function Probe() {
      useLiveTelemetrySelector((state) => state.snapshot, consumablesSnapshotsEqual);
      renders += 1;
      return null;
    }

    render(<Probe />);
    liveTelemetryStore.connect("ws://127.0.0.1:8091");
    const socket = FakeWebSocket.instances[0];
    act(() => {
      socket.open();
      socket.message(flightTelemetryFixture);
    });
    const afterFirstFrame = renders;

    act(() => socket.message({ ...flightTelemetryFixture, "o.ut": 12345 }));
    expect(renders).toBe(afterFirstFrame);

    act(() => socket.message({
      ...flightTelemetryFixture,
      "r.resource[LiquidFuel]": 88,
    }));
    expect(renders).toBe(afterFirstFrame + 1);
  });
});
