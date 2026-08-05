import { describe, expect, it, vi } from "vitest";
import { TelemetryStore } from "./store";
import type { ConnectionStatus } from "./client";
import type {
  HeatLoopControlResult,
  MissionPlanningPersistenceState,
  OverviewVesselEditResult,
  OverviewVesselLifecycleResult,
  OverviewVesselSwitchResult,
  ReactorControlResult,
  ScienceAlarmResult,
  ScienceLabResearchResult,
  ScienceLabTransmitResult,
  TelemetryCommand,
  TelemetrySnapshot,
} from "./types";

describe("TelemetryStore", () => {
  it("clears stale snapshots on connection loss and exposes reconnect state", () => {
    let callbacks: {
      onHeatLoopControlResult?(result: HeatLoopControlResult): void;
      onOverviewVesselEditResult?(result: OverviewVesselEditResult): void;
      onOverviewVesselLifecycleResult?(result: OverviewVesselLifecycleResult): void;
      onOverviewVesselSwitchResult?(result: OverviewVesselSwitchResult): void;
      onReactorControlResult?(result: ReactorControlResult): void;
      onScienceAlarmResult?(result: ScienceAlarmResult): void;
      onScienceLabResearchResult?(result: ScienceLabResearchResult): void;
      onScienceLabTransmitResult?(result: ScienceLabTransmitResult): void;
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
    callbacks!.onHeatLoopControlResult?.({
      type: "heat.loop.control.result",
      requestId: "heat-1",
      loopId: 2,
      action: "stop",
      status: "accepted",
      message: "Radiators are retracting and deactivating.",
    });
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
    callbacks!.onReactorControlResult?.({
      type: "reactor.control.result",
      requestId: "reactor-1",
      index: 0,
      action: "start",
      status: "accepted",
      message: "Reactor started.",
    });
    callbacks!.onScienceAlarmResult?.({
      type: "science.alarm.create.result",
      requestId: "alarm-1",
      labId: "42:1",
      status: "accepted",
      message: "KAC alarm set.",
      provider: "kac",
    });
    callbacks!.onScienceLabResearchResult?.({
      type: "science.lab.research.result",
      requestId: "research-1",
      labId: "42:1",
      enabled: false,
      status: "accepted",
      message: "Research stopped.",
    });
    callbacks!.onScienceLabTransmitResult?.({
      type: "science.lab.transmit.result",
      requestId: "transmit-1",
      labId: "42:1",
      status: "accepted",
      message: "Transmit Science invoked.",
    });
    expect(store.getSnapshot().snapshot?.["v.name"]).toBe("Odyssey");
    expect(store.getSnapshot().frameCount).toBe(1);
    expect(store.getSnapshot().lastFrameAt).not.toBeNull();
    expect(store.getSnapshot().heatLoopControlResult?.requestId).toBe("heat-1");
    expect(store.getSnapshot().overviewVesselSwitchResult?.requestId).toBe("switch-1");
    expect(store.getSnapshot().overviewVesselEditResult?.name).toBe("New Odyssey");
    expect(store.getSnapshot().overviewVesselLifecycleResult?.action).toBe("terminate");
    expect(store.getSnapshot().reactorControlResult?.requestId).toBe("reactor-1");
    expect(store.getSnapshot().scienceAlarmResult?.provider).toBe("kac");
    expect(store.getSnapshot().scienceLabResearchResult?.enabled).toBe(false);
    expect(store.getSnapshot().scienceLabTransmitResult?.requestId).toBe("transmit-1");

    callbacks!.onStatus("retrying", "Connection dropped");
    expect(store.getSnapshot()).toMatchObject({
      message: "Connection dropped",
      snapshot: null,
      heatLoopControlResult: undefined,
      overviewVesselSwitchResult: undefined,
      overviewVesselEditResult: undefined,
      overviewVesselLifecycleResult: undefined,
      reactorControlResult: undefined,
      scienceAlarmResult: undefined,
      scienceLabResearchResult: undefined,
      scienceLabTransmitResult: undefined,
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
      onHeatLoopControlResult?(result: HeatLoopControlResult): void;
      onOverviewVesselEditResult?(result: OverviewVesselEditResult): void;
      onOverviewVesselLifecycleResult?(result: OverviewVesselLifecycleResult): void;
      onOverviewVesselSwitchResult?(result: OverviewVesselSwitchResult): void;
      onReactorControlResult?(result: ReactorControlResult): void;
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
