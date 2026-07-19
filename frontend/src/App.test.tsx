// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ConsumablesPanel } from "./components/ConsumablesPanel";
import { StagingPanel } from "./components/StagingPanel";
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
  it("renders the complete flight dashboard and restores hidden panels from the left rail", () => {
    const firstView = render(<App />);
    ["Datalink", "Time & communications", "Ascension", "Consumables", "Heat Management", "Electricity", "Science", "Staging analysis", "Target", "Pinned note"].forEach((heading) => {
      expect(screen.getByText(heading, { exact: true })).toBeTruthy();
    });
    expect(screen.getAllByRole("button", { name: "Notes" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Notes" }).querySelector(".panel-rail-icon-notes")).toBeTruthy();
    expect(firstView.container.querySelector("#conn")?.textContent).not.toContain("Notes");
    expect(firstView.container.querySelector("svg.spark")?.getAttribute("preserveAspectRatio")).toBe("none");
    expect(firstView.container.querySelector(".nav-sky")).toBeTruthy();
    expect(firstView.container.querySelector(".nav-ground")).toBeTruthy();
    const pinnedNote = firstView.container.querySelector("#flightNote");
    expect(pinnedNote?.querySelector("h2 .flight-note-name")?.textContent).toBe("log_Odyssey");
    expect(pinnedNote?.querySelector("h2 .notes-font-controls")).toBeTruthy();
    expect(pinnedNote?.querySelector("h2 .flight-note-unpin")).toBeTruthy();
    expect(pinnedNote?.querySelector(".body")?.firstElementChild?.className).toBe("flight-note-meta");
    const atmoButton = screen.getByRole("button", { name: "ATMO" });
    const vacuumButton = screen.getByRole("button", { name: "VAC" });
    expect(atmoButton.getAttribute("aria-pressed")).toBe("true");
    expect(vacuumButton.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(vacuumButton);
    expect(atmoButton.getAttribute("aria-pressed")).toBe("false");
    expect(vacuumButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Hide Heat Management panel" }));
    expect(screen.queryByText("Heat Management", { exact: true })).toBeNull();
    const restore = screen.getByRole("button", { name: "Heat" });
    expect(restore.textContent).toBe("");
    expect(restore.querySelector(".panel-rail-icon-heat")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("wmc-hidden-panels-v1") ?? "[]")).toContain("heat");
    fireEvent.click(restore);
    expect(screen.getByText("Heat Management", { exact: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide Ascension panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide Consumables panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide Pinned note panel" }));
    const pinnedRestore = screen.getByRole("button", { name: "Pinned note" });
    expect(pinnedRestore.querySelector(".panel-rail-icon-flightNote")).toBeTruthy();
    expect(firstView.container.querySelector(".panel-restore-rail")?.lastElementChild).toBe(pinnedRestore);
    expect(firstView.container.querySelector(".flight-grid")?.className).toContain("no-left-column");
    expect(firstView.container.querySelector(".flight-grid")?.className).toContain("flight-columns-2");
    firstView.unmount();

    localStorage.setItem("wmc-hidden-panels-v1", JSON.stringify(["sci"]));
    render(<App />);
    expect(screen.queryByRole("heading", { name: "Science" })).toBeNull();
    expect(screen.getByRole("button", { name: "Science" })).toBeTruthy();
  });

  it("preserves fractional current-stage capacity instead of displaying 0 / 0", () => {
    const { container } = render(
      <ConsumablesPanel snapshot={fractionalStageElectricChargeFixture} />,
    );
    const emptyStageMeter = container.querySelector('[aria-label="0% remaining"]');
    expect(emptyStageMeter?.textContent?.replace(/\s/g, "")).toBe("0.0/0.4");
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
    expect(screen.getByRole("complementary", { name: "Notes continuity preview" })).toBeTruthy();
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
    expect(screen.getAllByText("EDITOR LINK", { exact: true })).toHaveLength(2);
    expect(screen.getByRole("heading", { name: /Datalink/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Craft summary/ })).toBeTruthy();
    expect(screen.getByText("Dual-condition regression craft", { exact: true })).toBeTruthy();
    expect(screen.getByText("Analysis current", { exact: true })).toBeTruthy();
    expect(screen.getByText("18,742 kg", { exact: true })).toBeTruthy();
    expect(screen.getByText("√42,580", { exact: true })).toBeTruthy();
    expect(screen.getByText("Liquid Fuel", { exact: true })).toBeTruthy();
    expect(screen.queryByText(/revision/i)).toBeNull();
    expect(screen.getByRole("complementary", { name: "Notes continuity preview" })).toBeTruthy();

    const commandsBeforeEditorChange = firstSocket.sent.length;
    fireEvent.change(screen.getByLabelText("Altitude ASL (m)", { exact: true }), {
      target: { value: "10000" },
    });
    fireEvent.change(screen.getByLabelText("Mach", { exact: true }), {
      target: { value: "0.8" },
    });
    act(() => vi.advanceTimersByTime(499));
    expect(firstSocket.sent).toHaveLength(commandsBeforeEditorChange);
    act(() => vi.advanceTimersByTime(1));
    fireEvent.click(screen.getByRole("button", { name: "Recalculate" }));
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
    act(() => vi.advanceTimersByTime(500));
    expect(JSON.parse(firstSocket.sent.at(-1)!)).toEqual({
      type: "editor.conditions",
      body: "Duna",
    });

    act(() => firstSocket.message(inactiveTelemetryFixture));
    expect(screen.getAllByText("MISSION CONTROL LINK", { exact: true })).toHaveLength(2);
    expect(screen.getByRole("heading", { name: /Datalink/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Woobie's Mission Control" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Active vessels" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Astronaut roster" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Upcoming alarms" })).toBeTruthy();
    expect(screen.queryByText("Consumables", { exact: true })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Notes continuity preview" })).toBeTruthy();

    act(() => firstSocket.drop());
    expect(screen.getAllByText("RETRYING", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByRole("complementary", { name: "Notes continuity preview" })).toBeTruthy();
    expect(screen.getByText("Notes unavailable", { exact: true })).toBeTruthy();

    act(() => vi.advanceTimersByTime(2_000));
    expect(FakeWebSocket.instances).toHaveLength(2);
    const secondSocket = FakeWebSocket.instances[1];
    act(() => {
      secondSocket.open();
      secondSocket.message(flightTelemetryFixture);
    });
    expect(screen.getByRole("button", { name: "Datalink" })).toBeTruthy();
    expect(screen.getByText("Odyssey", { exact: true })).toBeTruthy();
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
