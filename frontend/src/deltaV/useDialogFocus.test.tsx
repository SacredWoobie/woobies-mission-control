// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useDialogFocus } from "./useDialogFocus";

function DialogHarness() {
  const [open, setOpen] = useState(false);
  const dialogRef = useDialogFocus<HTMLElement>(open, () => setOpen(false));
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">Open planner</button>
      <button type="button">Background action</button>
      {open && (
        <>
          <div aria-hidden="true" className="resonant-drawer-backdrop" />
          <section aria-modal="true" ref={dialogRef} role="dialog" tabIndex={-1}>
            <button onClick={() => setOpen(false)} type="button">Close planner</button>
            <button type="button">Last action</button>
          </section>
        </>
      )}
    </>
  );
}

describe("useDialogFocus", () => {
  it("traps focus, makes the background inert, closes on Escape, and restores the opener", async () => {
    render(<DialogHarness />);
    const opener = screen.getByRole("button", { name: "Open planner" });
    const background = screen.getByRole("button", { name: "Background action" });

    opener.focus();
    fireEvent.click(opener);
    const close = screen.getByRole("button", { name: "Close planner" });
    const last = screen.getByRole("button", { name: "Last action" });
    expect(document.activeElement).toBe(close);
    expect(background.hasAttribute("inert")).toBe(true);
    expect(background.getAttribute("aria-hidden")).toBe("true");

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(background.hasAttribute("inert")).toBe(false);
    expect(background.hasAttribute("aria-hidden")).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});
