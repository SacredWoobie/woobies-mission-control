// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TelemetrySnapshot } from "../telemetry/types";
import { SciencePanel } from "./SciencePanel";

afterEach(cleanup);

describe("SciencePanel", () => {
  it("uses adaptive hero precision and fixed experiment-column precision", () => {
    const snapshot: TelemetrySnapshot = {
      "context.mode": "flight",
      "sci.krpc.total": 12,
      "sci.krpc.transmitTotal": 7,
      "sci.krpc.count": 1,
      "sci.krpc.experiments": [{
        title: "Mystery Goo",
        value: 12,
        transmit: 7,
      }],
    };
    render(<SciencePanel snapshot={snapshot} />);

    expect(screen.getByText("12 science recoverable · 7 by transmit", { exact: true })).toBeTruthy();
    expect(screen.getByText((_, element) => element?.textContent === "12.0 / 7.0 tx")).toBeTruthy();
  });
});
