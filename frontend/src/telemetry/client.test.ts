import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TelemetryClient,
  parseMissionPlanningPersistenceState,
  parseOverviewVesselEditResult,
  parseOverviewVesselSwitchResult,
  parseTelemetrySnapshot,
  type ConnectionStatus,
  type WebSocketTransport,
} from "./client";
import type { MissionPlanningPersistenceState, OverviewVesselEditResult, OverviewVesselSwitchResult, TelemetrySnapshot } from "./types";

class FakeSocket implements WebSocketTransport {
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly sent: string[] = [];

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  drop() {
    this.close();
  }

  message(data: unknown) {
    this.onmessage?.({ data });
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  send(data: string) {
    this.sent.push(data);
  }
}

afterEach(() => vi.useRealTimers());

describe("parseTelemetrySnapshot", () => {
  it("normalizes released payloads without an explicit context mode", () => {
    expect(parseTelemetrySnapshot('{"flight.active":false}')).toMatchObject({
      "context.mode": "inactive",
    });
    expect(parseTelemetrySnapshot('{"v.name":"Odyssey"}')).toMatchObject({
      "context.mode": "flight",
    });
    expect(parseTelemetrySnapshot("not json")).toBeNull();
  });
});

describe("parseMissionPlanningPersistenceState", () => {
  it("accepts typed persistence state events and rejects malformed ones", () => {
    expect(parseMissionPlanningPersistenceState(JSON.stringify({
      type: "mission.planning.persistence.state",
      requestId: "request-1",
      section: "resonant",
      value: { plans: [] },
      revision: 4,
      status: "ok",
      message: "Planner persistence loaded.",
    }))).toEqual({
      type: "mission.planning.persistence.state",
      requestId: "request-1",
      section: "resonant",
      value: { plans: [] },
      revision: 4,
      status: "ok",
      message: "Planner persistence loaded.",
    });
    expect(parseMissionPlanningPersistenceState({
      type: "mission.planning.persistence.state",
      requestId: "request-2",
      section: "unknown",
      revision: 1,
    })).toBeNull();
    expect(parseMissionPlanningPersistenceState({
      type: "mission.planning.persistence.state",
      requestId: "request-3",
      section: "deltaVDraft",
      revision: -1,
    })).toBeNull();
  });
});

describe("parseOverviewVesselSwitchResult", () => {
  it("accepts a typed switch result and rejects malformed events", () => {
    expect(parseOverviewVesselSwitchResult(JSON.stringify({
      type: "overview.vessel.switch.result",
      requestId: "switch-1",
      status: "accepted",
      message: "Switching.",
    }))).toEqual({
      type: "overview.vessel.switch.result",
      requestId: "switch-1",
      status: "accepted",
      message: "Switching.",
    });
    expect(parseOverviewVesselSwitchResult({
      type: "overview.vessel.switch.result",
      requestId: "switch-2",
      status: "unknown",
      message: "Nope.",
    })).toBeNull();
  });
});

describe("parseOverviewVesselEditResult", () => {
  it("accepts typed edit results and rejects malformed events", () => {
    expect(parseOverviewVesselEditResult(JSON.stringify({
      type: "overview.vessel.edit.result",
      requestId: "edit-1",
      status: "accepted",
      message: "Renamed.",
      name: "Duna Relay",
      vesselType: "Relay",
    }))).toEqual({
      type: "overview.vessel.edit.result",
      requestId: "edit-1",
      status: "accepted",
      message: "Renamed.",
      name: "Duna Relay",
      vesselType: "Relay",
    });
    expect(parseOverviewVesselEditResult({
      type: "overview.vessel.edit.result",
      requestId: "edit-2",
      status: "accepted",
      message: "Renamed.",
      name: 42,
    })).toBeNull();
  });
});

describe("TelemetryClient", () => {
  it("publishes snapshots and sends existing dashboard commands when linked", () => {
    const sockets: FakeSocket[] = [];
    const statuses: ConnectionStatus[] = [];
    const snapshots: TelemetrySnapshot[] = [];
    const client = new TelemetryClient(
      "ws://127.0.0.1:8090",
      {
        onSnapshot: (snapshot) => snapshots.push(snapshot),
        onStatus: (status) => statuses.push(status),
      },
      {
        createSocket: () => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket;
        },
      },
    );

    expect(client.send({ type: "notes.pin", relativePath: null })).toBe(false);
    client.connect();
    sockets[0].open();
    sockets[0].message('{"context.mode":"editor","editor.craftName":"Test craft"}');

    expect(statuses).toEqual(["connecting", "linked"]);
    expect(snapshots[0]).toMatchObject({
      "context.mode": "editor",
      "editor.craftName": "Test craft",
    });
    expect(client.send({ type: "notes.pin", relativePath: "Flight.txt" })).toBe(true);
    expect(JSON.parse(sockets[0].sent[0])).toEqual({
      type: "notes.pin",
      relativePath: "Flight.txt",
    });
  });

  it("routes persistence state events before telemetry snapshot parsing", () => {
    const socket = new FakeSocket();
    const snapshots: TelemetrySnapshot[] = [];
    const persistenceStates: MissionPlanningPersistenceState[] = [];
    const client = new TelemetryClient(
      "ws://127.0.0.1:8090",
      {
        onPersistenceState: (state) => persistenceStates.push(state),
        onSnapshot: (snapshot) => snapshots.push(snapshot),
        onStatus: () => undefined,
      },
      { createSocket: () => socket },
    );

    client.connect();
    socket.open();
    socket.message(JSON.stringify({
      type: "mission.planning.persistence.state",
      requestId: "request-1",
      section: "deltaVLibrary",
      value: { plans: [] },
      revision: 2,
      status: "ok",
      message: "Planner persistence loaded.",
    }));
    socket.message(JSON.stringify({
      type: "mission.planning.persistence.state",
      requestId: "malformed",
      section: "unknown",
      revision: -1,
      status: "error",
      message: "Unknown section.",
    }));

    expect(persistenceStates).toEqual([{
      type: "mission.planning.persistence.state",
      requestId: "request-1",
      section: "deltaVLibrary",
      value: { plans: [] },
      revision: 2,
      status: "ok",
      message: "Planner persistence loaded.",
    }]);
    expect(snapshots).toEqual([]);
  });

  it("routes vessel switch results only through the command-result callback", () => {
    const socket = new FakeSocket();
    const snapshots: TelemetrySnapshot[] = [];
    const switchResults: OverviewVesselSwitchResult[] = [];
    const client = new TelemetryClient(
      "ws://127.0.0.1:8090",
      {
        onOverviewVesselSwitchResult: (result) => switchResults.push(result),
        onSnapshot: (snapshot) => snapshots.push(snapshot),
        onStatus: () => undefined,
      },
      { createSocket: () => socket },
    );

    client.connect();
    socket.open();
    socket.message(JSON.stringify({
      type: "overview.vessel.switch.result",
      requestId: "switch-1",
      status: "error",
      message: "Unavailable.",
    }));
    socket.message(JSON.stringify({
      type: "overview.vessel.switch.result",
      requestId: "",
      status: "unknown",
      message: "Malformed.",
    }));

    expect(switchResults).toHaveLength(1);
    expect(switchResults[0].requestId).toBe("switch-1");
    expect(snapshots).toEqual([]);
  });

  it("routes vessel edit results only to the originating client callback", () => {
    const socket = new FakeSocket();
    const snapshots: TelemetrySnapshot[] = [];
    const editResults: OverviewVesselEditResult[] = [];
    const client = new TelemetryClient(
      "ws://127.0.0.1:8090",
      {
        onOverviewVesselEditResult: (result) => editResults.push(result),
        onSnapshot: (snapshot) => snapshots.push(snapshot),
        onStatus: () => undefined,
      },
      { createSocket: () => socket },
    );

    client.connect();
    socket.open();
    socket.message(JSON.stringify({
      type: "overview.vessel.edit.result",
      requestId: "edit-1",
      status: "accepted",
      message: "Renamed.",
      name: "Duna Relay",
      vesselType: "Relay",
    }));
    socket.message(JSON.stringify({
      type: "overview.vessel.edit.result",
      requestId: "",
      status: "unknown",
      message: "Malformed.",
    }));

    expect(editResults).toHaveLength(1);
    expect(editResults[0].name).toBe("Duna Relay");
    expect(snapshots).toEqual([]);
  });

  it("retries a dropped link and stops retrying after a manual disconnect", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const statuses: ConnectionStatus[] = [];
    const client = new TelemetryClient(
      "ws://127.0.0.1:8090",
      {
        onSnapshot: () => undefined,
        onStatus: (status) => statuses.push(status),
      },
      {
        createSocket: () => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket;
        },
        reconnectDelayMs: 2_000,
      },
    );

    client.connect();
    sockets[0].open();
    sockets[0].drop();
    expect(statuses.at(-1)).toBe("retrying");

    vi.advanceTimersByTime(1_999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    expect(statuses.at(-1)).toBe("connecting");

    client.disconnect();
    vi.advanceTimersByTime(4_000);
    expect(statuses.at(-1)).toBe("offline");
    expect(sockets).toHaveLength(2);
  });
});
