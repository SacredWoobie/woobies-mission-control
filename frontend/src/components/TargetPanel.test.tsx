// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flightTelemetryFixture } from "../telemetry/fixtures";
import type { TelemetryCommand } from "../telemetry/types";
import { PanelVisibilityProvider } from "./PanelVisibility";
import { TargetPanel } from "./TargetPanel";

afterEach(cleanup);

function renderTarget(element: ReactNode) {
  return render(<PanelVisibilityProvider>{element}</PanelVisibilityProvider>);
}

describe("TargetPanel", () => {
  it("replaces the passive type tag with a guarded unset command", () => {
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    const view = renderTarget(
      <TargetPanel commandEnabled onSendCommand={onSendCommand} snapshot={flightTelemetryFixture} />,
    );

    expect(view.container.querySelector("#target .tag")?.textContent).toBe("Odyssey Station Docking Port");
    expect([...view.container.querySelectorAll("#target .panel-heading-actions > *")].map((node) => node.className)).toEqual([
      "tag",
      "target-clear-button",
      "panel-collapse-button",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "UNSET TARGET" }));

    expect(onSendCommand).toHaveBeenCalledOnce();
    expect(onSendCommand.mock.calls[0][0]).toMatchObject({
      type: "target.clear",
      expectedVesselGuid: flightTelemetryFixture["v.guid"],
      expectedTargetObjectId: flightTelemetryFixture["tar.objectId"],
      expectedTargetName: flightTelemetryFixture["tar.name"],
      expectedTargetType: "dockingport",
    });
    expect(screen.getByRole("button", { name: "UNSETTING…" })).toBeTruthy();
  });

  it("stays disabled when exact target identity is unavailable", () => {
    renderTarget(<TargetPanel commandEnabled snapshot={{ ...flightTelemetryFixture, "tar.objectId": undefined }} />);
    expect((screen.getByRole("button", { name: "UNSET TARGET" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows matching server rejection feedback and releases the pending state", () => {
    const onSendCommand = vi.fn((_command: TelemetryCommand) => true);
    const view = renderTarget(
      <TargetPanel commandEnabled onSendCommand={onSendCommand} snapshot={flightTelemetryFixture} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "UNSET TARGET" }));
    const requestId = (onSendCommand.mock.calls[0][0] as Extract<TelemetryCommand, { type: "target.clear" }>).requestId;

    view.rerender(
      <PanelVisibilityProvider>
        <TargetPanel
          clearResult={{ type: "target.clear.result", requestId, status: "error", message: "The selected target changed; refresh before clearing it." }}
          commandEnabled
          onSendCommand={onSendCommand}
          snapshot={flightTelemetryFixture}
        />
      </PanelVisibilityProvider>,
    );

    expect(screen.getByRole("alert").textContent).toContain("target changed");
    expect(screen.getByRole("button", { name: "UNSET TARGET" })).toBeTruthy();
  });
});
