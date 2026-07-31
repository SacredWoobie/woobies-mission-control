// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TelemetrySnapshot } from "../telemetry/types";
import { EditorContextPanel } from "./EditorContextPanel";

const snapshot: TelemetrySnapshot = {
  "context.mode": "editor",
  "editor.body": "Kerbin",
  "editor.bodies": ["Kerbin", "Mun"],
  "editor.altitude": 0,
  "editor.mach": 0,
  "editor.revision": 8,
  "editor.stable": true,
  "stage.available": true,
  "stage.pending": false,
};

describe("EditorContextPanel recalculation timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("coalesces rapid condition edits into one command after 150 ms", () => {
    const onSendCommand = vi.fn(() => true);
    render(
      <EditorContextPanel
        commandEnabled
        onSendCommand={onSendCommand}
        snapshot={snapshot}
      />,
    );

    fireEvent.change(screen.getByLabelText("Altitude ASL (m)"), {
      target: { value: "10000" },
    });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.change(screen.getByLabelText("Mach"), {
      target: { value: "0.8" },
    });
    act(() => vi.advanceTimersByTime(149));
    expect(onSendCommand).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onSendCommand).toHaveBeenCalledTimes(1);
    expect(onSendCommand).toHaveBeenCalledWith({
      type: "editor.conditions",
      altitude: 10000,
      mach: 0.8,
    });
  });

  it("cancels the pending automatic command when Enter submits", () => {
    const onSendCommand = vi.fn(() => true);
    render(
      <EditorContextPanel
        commandEnabled
        onSendCommand={onSendCommand}
        snapshot={snapshot}
      />,
    );

    const altitude = screen.getByLabelText("Altitude ASL (m)");
    fireEvent.change(altitude, { target: { value: "5000" } });
    fireEvent.keyDown(altitude, { key: "Enter" });

    expect(onSendCommand).toHaveBeenCalledTimes(1);
    expect(onSendCommand).toHaveBeenCalledWith({
      type: "editor.conditions",
      altitude: 5000,
    });
    act(() => vi.advanceTimersByTime(500));
    expect(onSendCommand).toHaveBeenCalledTimes(1);
  });
});
