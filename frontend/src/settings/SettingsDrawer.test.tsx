// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SCIENCE_ALARM_SETTINGS } from "./state";
import { SettingsDrawer, type SettingsDrawerProps } from "./SettingsDrawer";

afterEach(cleanup);

function props(overrides: Partial<SettingsDrawerProps> = {}): SettingsDrawerProps {
  return {
    hiddenPanelCount: 2,
    onClose: vi.fn(),
    onRestoreHiddenPanels: vi.fn(),
    onSetNavballStyle: vi.fn(),
    onScienceAlarmSettingsChange: vi.fn(),
    onSectionChange: vi.fn(),
    onSetTimeSystem: vi.fn(),
    onSetTheme: vi.fn(),
    open: true,
    navballStyleId: "mission-control",
    scienceAlarmProviders: { kac: true, stock: true },
    scienceAlarmSettings: DEFAULT_SCIENCE_ALARM_SETTINGS,
    section: "preferences",
    telemetry: {
      effectiveEndpoint: "ws://127.0.0.1:8090",
      capabilities: { schemaVersion: 1, features: {} as never },
      persistenceStatus: "shared",
    },
    themeId: "mission-control-dark",
    timeSystem: "kerbin",
    ...overrides,
  };
}

describe("SettingsDrawer", () => {
  it("renders immediate preferences and the safe restore action", () => {
    const onSetTimeSystem = vi.fn();
    const view = render(<SettingsDrawer {...props({ onSetTimeSystem })} />);
    const dialog = screen.getByRole("dialog", { name: "Mission Control Settings" });
    expect(within(dialog).getByText("2 panels hidden.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "EARTH TIME" }));
    expect(onSetTimeSystem).toHaveBeenCalledWith("earth");
    expect(view.container.querySelector("#settings-drawer")).toBeTruthy();
  });

  it("keeps feature labels and order fixed and expands one evidence row at a time", () => {
    const onSectionChange = vi.fn();
    const view = render(<SettingsDrawer {...props({ onSectionChange, section: "features-mods" })} />);
    const dialog = screen.getByRole("dialog", { name: "Mission Control Settings" });
    const rows = [...dialog.querySelectorAll<HTMLElement>(".settings-feature-toggle")];
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual([
      "Notes", "Science telemetry", "Science alarms", "Communications", "Stage analysis", "Live transfer calculations", "Heat monitoring", "Heat controls", "Editor electricity", "Damage monitoring",
    ]);
    fireEvent.click(rows[0]);
    expect(screen.getByText("Saved notes continuity across scenes")).toBeTruthy();
    fireEvent.click(rows[1]);
    expect(screen.queryByText("Saved notes continuity across scenes")).toBeNull();
    expect(screen.getByText("Science lab and experiment telemetry")).toBeTruthy();
    expect(view.container.textContent).toContain("ws://127.0.0.1:8090");
  });

  it("uses detection unavailable for invalid capability data and only publishes approved wiki links", () => {
    render(<SettingsDrawer {...props({ section: "features-mods", telemetry: { capabilities: { schemaVersion: 1, features: { notes: { status: "not-a-status", reason: "not-a-reason", evidence: [] } } as never } } })} />);
    expect(screen.getAllByText("DETECTION UNAVAILABLE").length).toBeGreaterThan(0);

    const onSectionChange = vi.fn();
    cleanup();
    render(<SettingsDrawer {...props({ onSectionChange, section: "help" })} />);
    expect(screen.queryByText(/Settings-and-Integrations/)).toBeNull();
    const links = screen.getAllByRole("link");
    expect(links.length).toBe(12);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://github.com/SacredWoobie/woobies-mission-control/wiki/Getting-Started",
      "https://github.com/SacredWoobie/woobies-mission-control/wiki/Installation-Options",
      "https://github.com/SacredWoobie/woobies-mission-control/wiki/Launcher-and-Service-Maintenance",
      "https://github.com/SacredWoobie/woobies-mission-control/wiki/Mission-Control-Overview",
      "https://github.com/SacredWoobie/woobies-mission-control/wiki/Flight-Dashboard",
      "https://github.com/SacredWoobie/woobies-mission-control/wiki/VAB-and-SPH",
      "https://github.com/SacredWoobie/woobies-mission-control/wiki/Mission-Planning",
      "https://github.com/SacredWoobie/woobies-mission-control/wiki/Notes-and-Panel-Customization",
      "https://github.com/SacredWoobie/woobies-mission-control/wiki/Mods-and-Compatibility",
      "https://github.com/SacredWoobie/woobies-mission-control/wiki/Network-and-Safety",
      "https://github.com/SacredWoobie/woobies-mission-control/wiki/Troubleshooting",
      "https://github.com/SacredWoobie/woobies-mission-control/wiki/ESP32-Controlpad",
    ]);
    links.forEach((link) => {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noreferrer");
    });
  });

  it("reports dashboard-wide installation capability without scene-dependent status", () => {
    render(<SettingsDrawer {...props({
      section: "features-mods",
      telemetry: {
        capabilities: {
          schemaVersion: 1,
          features: {
            notes: {
              status: "unknown",
              reason: "not_observed",
              evidence: [{ id: "notes", status: "detected", source: "root_scan" }],
            },
            science_telemetry: {
              status: "fallback",
              reason: "fallback_active",
              evidence: [
                { id: "stock_science", status: "active", source: "runtime" },
                { id: "wcs", status: "detected", source: "root_scan" },
              ],
            },
            communications: {
              status: "available",
              reason: "ready",
              evidence: [
                { id: "remote_tech", status: "active", source: "runtime" },
                { id: "remote_tech", status: "missing", source: "root_scan" },
              ],
            },
            stage_analysis: {
              status: "unknown",
              reason: "dependency_missing",
              evidence: [
                { id: "stage_stats", status: "missing", source: "root_scan" },
                { id: "mechjeb", status: "missing", source: "root_scan" },
              ],
            },
          } as never,
        },
      },
    })} />);
    expect(screen.getByRole("button", { name: /Notes.*AVAILABLE/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Science telemetry.*AVAILABLE/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Communications.*AVAILABLE · STOCK/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Stage analysis.*UNAVAILABLE/ })).toBeTruthy();
    expect(screen.queryByText(/NOT OBSERVED|STOCK FALLBACK ACTIVE|NOT DETECTED/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Science telemetry.*AVAILABLE/ }));
    expect(screen.queryByText("Runtime")).toBeNull();
    expect(screen.getByText(/Woobies Control Stats service.*DETECTED.*Installation scan/)).toBeTruthy();
  });

  it("offers all five themes and reports the current selection in About", () => {
    const onSetTheme = vi.fn();
    const view = render(<SettingsDrawer {...props({ onSetTheme })} />);
    const dialog = screen.getByRole("dialog", { name: "Mission Control Settings" });
    const themes = within(within(dialog).getByRole("radiogroup", { name: "Dashboard theme" })).getAllByRole("radio");
    expect(themes.map((theme) => theme.textContent)).toEqual([
      expect.stringContaining("Mission Control Dark"),
      expect.stringContaining("Daylight Console"),
      expect.stringContaining("Warm CRT"),
      expect.stringContaining("Green Phosphor"),
      expect.stringContaining("Catppuccin Mocha"),
    ]);
    expect(themes[0].getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Daylight Console/ }));
    expect(onSetTheme).toHaveBeenCalledWith("daylight-console");

    view.rerender(<SettingsDrawer {...props({ onSetTheme, section: "about", themeId: "daylight-console" })} />);
    expect(within(screen.getByRole("dialog", { name: "Mission Control Settings" })).getByText("Daylight Console")).toBeTruthy();
  });

  it("keeps Mission Control as the default navball and exposes the texture as an option", () => {
    const onSetNavballStyle = vi.fn();
    const view = render(<SettingsDrawer {...props({ onSetNavballStyle })} />);
    const group = screen.getByRole("radiogroup", { name: "Navball style" });
    const styles = within(group).getAllByRole("radio");
    expect(styles).toHaveLength(2);
    expect(styles[0].getAttribute("aria-checked")).toBe("true");
    expect(styles[1].getAttribute("aria-checked")).toBe("false");

    fireEvent.click(within(group).getByRole("radio", { name: /KSP2 Pre-Alpha/ }));
    expect(onSetNavballStyle).toHaveBeenCalledWith("ksp2-pre-alpha");

    view.rerender(<SettingsDrawer {...props({ navballStyleId: "ksp2-pre-alpha", onSetNavballStyle })} />);
    expect(screen.getByRole("radio", { name: /KSP2 Pre-Alpha/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("deep-links science alarms while retaining the Preferences navigator", () => {
    const onScienceAlarmSettingsChange = vi.fn();
    render(<SettingsDrawer {...props({ onScienceAlarmSettingsChange, section: "science-alarms" })} />);
    const dialog = screen.getByRole("dialog", { name: "Mission Control Settings" });
    expect(within(dialog).getByRole("button", { name: "Preferences" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(within(dialog).getByRole("button", { name: "STOCK" }));
    expect(onScienceAlarmSettingsChange).toHaveBeenCalledWith({ provider: "stock" });
  });
});
