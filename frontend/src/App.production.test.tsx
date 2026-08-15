// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.production";
import { liveTelemetryStore } from "./telemetry/store";


const originalLocation = window.location;

function stubLocation(url: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: new URL(url),
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});


describe("Production dashboard entry", () => {
  it("connects directly to loopback without exposing developer controls", () => {
    stubLocation("http://127.0.0.1:8090/");
    const connect = vi.spyOn(liveTelemetryStore, "connect").mockImplementation(() => undefined);
    const disconnect = vi.spyOn(liveTelemetryStore, "disconnect").mockImplementation(() => undefined);

    const view = render(<App />);

    expect(connect).toHaveBeenCalledWith("ws://127.0.0.1:8090");
    expect(screen.getByRole("button", { name: "Notes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "DEV" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
    expect(screen.getByText("Woobie's Mission Control · React dashboard · v0.7.4 · Production")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("dialog", { name: "Mission Control Settings" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(screen.getByText("Production", { exact: true })).toBeTruthy();
    expect(within(screen.getByRole("dialog", { name: "Mission Control Settings" })).getByText("ws://127.0.0.1:8090", { exact: true })).toBeTruthy();

    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("connects back to the LAN address that actually served the page", () => {
    stubLocation("http://192.168.1.201:8090/");
    const connect = vi.spyOn(liveTelemetryStore, "connect").mockImplementation(() => undefined);
    vi.spyOn(liveTelemetryStore, "disconnect").mockImplementation(() => undefined);

    const view = render(<App />);

    expect(connect).toHaveBeenCalledWith("ws://192.168.1.201:8090");

    view.unmount();
  });
});
