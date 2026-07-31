import { describe, expect, it, vi } from "vitest";
import { TelemetryStore } from "./store";
import type { ConnectionStatus } from "./client";
import type {
  MissionPlanningPersistenceState,
  OverviewVesselEditResult,
  OverviewVesselLifecycleResult,
  OverviewVesselSwitchResult,
  TelemetryCommand,
  TelemetrySnapshot,
} from "./types";

describe("TelemetryStore", () => {
  it("clears stale snapshots on connection loss and exposes reconnect state", () => {
    let callbacks: {
      onOverviewVesselEditResult?(result: OverviewVesselEditResult): void;
      onOverviewVesselLifecycleResult?(result: OverviewVesselLifecycleResult): void;
      onOverviewVesselSwitchResult?(result: OverviewVesselSwitchResult): void;
      onPersistenceState?(state: MissionPlanningPersistenceState): void;
      onSnapshot(snapshot: TelemetrySnapshot): void;
      onStatus(status: ConnectionStatus, message?: string): void;
    } | undefined;
    const disconnect = vi.fn();
    const connect = vi.fn();
    const send = vi.fn((_command: TelemetryCommand) => true);
    const store = new TelemetryStore((_endpoint, nextCallbacks) => {
      callbacks = nextCallbacks;
      return { connect, disconnect, send };
    });
    const listener = vi.fn();
    store.subscribe(listener);

    store.connect("ws://127.0.0.1:8090");
    expect(connect).toHaveBeenCalledOnce();
    callbacks!.onStatus("linked");
    callbacks!.onSnapshot({ "context.mode": "flight", "v.name": "Odyssey" });
    callbacks!.onOverviewVesselSwitchResult?.({
      type: "overview.vessel.switch.result",
      requestId: "switch-1",
      status: "accepted",
      message: "Switching.",
    });
    callbacks!.onOverviewVesselEditResult?.({
      type: "overview.vessel.edit.result",
      requestId: "edit-1",
      status: "accepted",
      message: "Renamed.",
      name: "New Odyssey",
      vesselType: "Relay",
    });
    callbacks!.onOverviewVesselLifecycleResult?.({
      type: "overview.vessel.lifecycle.result",
      requestId: "terminate-1",
      action: "terminate",
      status: "accepted",
      message: "Terminated Odyssey.",
    });
    expect(store.getSnapshot().snapshot?.["v.name"]).toBe("Odyssey");
    expect(store.getSnapshot().frameCount).toBe(1);
    expect(store.getSnapshot().lastFrameAt).not.toBeNull();
    expect(store.getSnapshot().overviewVesselSwitchResult?.requestId).toBe("switch-1");
    expect(store.getSnapshot().overviewVesselEditResult?.name).toBe("New Odyssey");
    expect(store.getSnapshot().overviewVesselLifecycleResult?.action).toBe("terminate");

    callbacks!.onStatus("retrying", "Connection dropped");
    expect(store.getSnapshot()).toMatchObject({
      message: "Connection dropped",
      snapshot: null,
      overviewVesselSwitchResult: undefined,
      overviewVesselEditResult: undefined,
      overviewVesselLifecycleResult: undefined,
      status: "retrying",
    });
    expect(store.send({ type: "notes.select", relativePath: null })).toBe(true);
    expect(send).toHaveBeenCalledOnce();

    store.disconnect();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toMatchObject({ snapshot: null, status: "offline" });
    expect(listener).toHaveBeenCalled();
  });

  it("broadcasts persistence state and sends typed persistence commands", () => {
    let callbacks: {
      onOverviewVesselEditResult?(result: OverviewVesselEditResult): void;
      onOverviewVesselLifecycleResult?(result: OverviewVesselLifecycleResult): void;
      onOverviewVesselSwitchResult?(result: OverviewVesselSwitchResult): void;
      onPersistenceState?(state: MissionPlanningPersistenceState): void;
      onSnapshot(snapshot: TelemetrySnapshot): void;
      onStatus(status: ConnectionStatus, message?: string): void;
    } | undefined;
    const send = vi.fn((_command: TelemetryCommand) => true);
    const store = new TelemetryStore((_endpoint, nextCallbacks) => {
      callbacks = nextCallbacks;
      return { connect: vi.fn(), disconnect: vi.fn(), send };
    });
    const persistenceListener = vi.fn();
    const unsubscribe = store.subscribeMissionPlanningPersistence(persistenceListener);

    store.connect("ws://127.0.0.1:8090");
    const state: MissionPlanningPersistenceState = {
      type: "mission.planning.persistence.state",
      requestId: "request-1",
      section: "resonant",
      value: { plans: [] },
      revision: 3,
      status: "ok",
      message: "Planner persistence loaded.",
    };
    callbacks!.onPersistenceState?.(state);
    expect(persistenceListener).toHaveBeenCalledWith(state);

    expect(store.requestMissionPlanningPersistence("request-2", "deltaVLibrary")).toBe(true);
    expect(store.mergeMissionPlanningPersistence("request-3", "resonant", { plans: [] }, 3)).toBe(true);
    expect(store.updateMissionPlanningPersistence("request-4", "deltaVDraft", { stops: [] }, 7)).toBe(true);
    expect(send.mock.calls.map(([command]) => command)).toEqual([
      {
        type: "mission.planning.persistence.get",
        requestId: "request-2",
        section: "deltaVLibrary",
      },
      {
        type: "mission.planning.persistence.merge",
        requestId: "request-3",
        section: "resonant",
        incoming: { plans: [] },
        baseRevision: 3,
      },
      {
        type: "mission.planning.persistence.update",
        requestId: "request-4",
        section: "deltaVDraft",
        value: { stops: [] },
        baseRevision: 7,
      },
    ]);

    unsubscribe();
    callbacks!.onPersistenceState?.({ ...state, revision: 4 });
    expect(persistenceListener).toHaveBeenCalledOnce();
  });
});
