// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionStatus } from "../telemetry/client";
import { flightTelemetryFixture, inactiveTelemetryFixture } from "../telemetry/fixtures";
import type { TelemetrySnapshot } from "../telemetry/types";
import { useFlightAnnunciator } from "./useFlightAnnunciator";

function Harness({
  connectionState,
  frameCount,
  lastFrameAt,
  snapshot,
}: {
  connectionState: ConnectionStatus;
  frameCount: number;
  lastFrameAt: number | null;
  snapshot: TelemetrySnapshot | null;
}) {
  const controller = useFlightAnnunciator({
    connectionState,
    frameCount,
    lastFrameAt,
    snapshot,
    watchdog: true,
  });
  return <div data-testid="summary">{controller.summary.lamp}|{controller.summary.tokens.join(",")}|{controller.summary.active.length}</div>;
}

describe("live Flight annunciator controller", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("retains Flight state through retry, raises DATALINK on a stale feed, and resets on a confirmed scene change", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { rerender } = render(
      <Harness connectionState="linked" frameCount={1} lastFrameAt={1_000} snapshot={flightTelemetryFixture} />,
    );
    expect(screen.getByTestId("summary").textContent).toBe("blinking|HEAT|1");

    rerender(<Harness connectionState="retrying" frameCount={1} lastFrameAt={1_000} snapshot={null} />);
    act(() => vi.advanceTimersByTime(5_250));
    expect(screen.getByTestId("summary").textContent).toBe("blinking|HEAT,DATALINK|2");

    rerender(<Harness connectionState="linked" frameCount={2} lastFrameAt={6_250} snapshot={flightTelemetryFixture} />);
    act(() => vi.advanceTimersByTime(250));
    expect(screen.getByTestId("summary").textContent).toBe("blinking|HEAT,DATALINK|1");

    rerender(<Harness connectionState="linked" frameCount={3} lastFrameAt={6_500} snapshot={inactiveTelemetryFixture} />);
    expect(screen.getByTestId("summary").textContent).toBe("dark||0");
  });

  it("drops retained Flight episodes on an explicit offline transition", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    const hotSnapshot: TelemetrySnapshot = {
      ...flightTelemetryFixture,
      "heat.backend": "system_heat",
      "heat.systemHeatStatus": "known",
      "heat.loops": [{
        id: "1",
        tempK: 950,
        nominalTempK: 1_000,
        genKw: 20,
        remKw: 0,
        netKw: 20,
        hasRadiators: true,
      }],
    };
    const { rerender } = render(
      <Harness connectionState="linked" frameCount={1} lastFrameAt={2_000} snapshot={hotSnapshot} />,
    );
    expect(screen.getByTestId("summary").textContent).toBe("blinking|HEAT|1");

    rerender(<Harness connectionState="offline" frameCount={1} lastFrameAt={2_000} snapshot={null} />);
    expect(screen.getByTestId("summary").textContent).toBe("dark||0");
  });
});
