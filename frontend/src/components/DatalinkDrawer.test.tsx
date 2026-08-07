// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatalinkDrawer } from "./DatalinkDrawer";

afterEach(cleanup);

describe("DatalinkDrawer", () => {
  it("shows fixture diagnostics without offering live connection controls", () => {
    render(<DatalinkDrawer
      connectionStatus="fixture"
      endpoint="deterministic fixtures"
      frameCount={1}
      onClose={vi.fn()}
      open
      sceneMode="flight"
    />);

    expect(screen.getByRole("dialog", { name: "Datalink controls" })).toBeTruthy();
    expect(screen.getByText("FIXTURE FEED", { exact: true })).toBeTruthy();
    expect(screen.getByText("FLIGHT", { exact: true })).toBeTruthy();
    expect((screen.getByRole("button", { name: /^REFRESH CONNECTION/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /^TURN DATALINK OFF/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders recent events newest first", () => {
    render(<DatalinkDrawer
      connectionStatus="linked"
      endpoint="ws://127.0.0.1:8090"
      events={[
        { at: 2_000, id: 2, message: "Linked.", status: "linked" },
        { at: 1_000, id: 1, message: "Opening.", status: "connecting" },
      ]}
      lastFrameAt={2_000}
      onClose={vi.fn()}
      onRefresh={vi.fn()}
      onToggle={vi.fn()}
      open
    />);

    const events = screen.getAllByRole("listitem");
    expect(events[0].textContent).toContain("Linked.");
    expect(events[1].textContent).toContain("Opening.");
  });
});
