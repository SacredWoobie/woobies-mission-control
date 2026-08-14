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
    onScienceAlarmSettingsChange: vi.fn(),
    onSectionChange: vi.fn(),
    onSetTimeSystem: vi.fn(),
    open: true,
    scienceAlarmProviders: { kac: true, stock: true },
    scienceAlarmSettings: DEFAULT_SCIENCE_ALARM_SETTINGS,
    section: "preferences",
    telemetry: {
      effectiveEndpoint: "ws://127.0.0.1:8090",
      capabilities: { schemaVersion: 1, features: {} as never },
      persistenceStatus: "shared",
    },
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

  it("uses unknown for invalid feature statuses and only publishes approved wiki links", () => {
    render(<SettingsDrawer {...props({ section: "features-mods", telemetry: { capabilities: { schemaVersion: 1, features: { notes: { status: "not-a-status", reason: "not-a-reason", evidence: [] } } as never } } })} />);
    expect(screen.getAllByText("UNKNOWN").length).toBeGreaterThan(0);

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

  it("reports the current palette without exposing a theme chooser", () => {
    render(<SettingsDrawer {...props({ section: "about" })} />);
    const dialog = screen.getByRole("dialog", { name: "Mission Control Settings" });
    expect(within(dialog).getByText("Mission Control Dark (read-only)")).toBeTruthy();
    expect(within(dialog).queryByRole("combobox")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /theme|palette/i })).toBeNull();
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
