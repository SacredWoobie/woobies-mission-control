// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.production";
import { liveTelemetryStore } from "./telemetry/store";


afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});


describe("Production dashboard entry", () => {
  it("connects directly to loopback without exposing developer controls", () => {
    const connect = vi.spyOn(liveTelemetryStore, "connect").mockImplementation(() => undefined);
    vi.spyOn(liveTelemetryStore, "disconnect").mockImplementation(() => undefined);

    render(<App />);

    expect(connect).toHaveBeenCalledWith("ws://127.0.0.1:8090");
    expect(screen.getByRole("button", { name: "Notes" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "DEV" })).toBeNull();
    expect(screen.getByText("Woobie's Mission Control · React dashboard · v0.3.0")).toBeTruthy();
  });
});
