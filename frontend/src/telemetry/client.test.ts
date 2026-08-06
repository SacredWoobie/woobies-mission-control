import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TelemetryClient,
  parseMissionPlanningPersistenceState,
  parseOverviewVesselEditResult,
  parseOverviewVesselLifecycleResult,
  parseOverviewVesselSwitchResult,
  parseReactorControlResult,
  parseScienceAlarmResult,
  parseScienceLabResearchResult,
  parseScienceLabTransmitResult,
  parseTargetClearResult,
  parseTelemetrySnapshot,
  type ConnectionStatus,
  type WebSocketTransport,
} from "./client";
import type { HeatLoopControlResult, MissionPlanningPersistenceState, OverviewVesselEditResult, OverviewVesselLifecycleResult, OverviewVesselSwitchResult, ReactorControlResult, ScienceAlarmResult, ScienceLabResearchResult, ScienceLabTransmitResult, TargetClearResult, TelemetrySnapshot } from "./types";

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

describe("parseOverviewVesselLifecycleResult", () => {
  it("accepts typed lifecycle results and rejects malformed events", () => {
    expect(parseOverviewVesselLifecycleResult(JSON.stringify({
      type: "overview.vessel.lifecycle.result",
      requestId: "terminate-1",
      action: "terminate",
      status: "accepted",
      message: "Terminated Odyssey.",
    }))).toEqual({
      type: "overview.vessel.lifecycle.result",
      requestId: "terminate-1",
      action: "terminate",
      status: "accepted",
      message: "Terminated Odyssey.",
    });
    expect(parseOverviewVesselLifecycleResult({
      type: "overview.vessel.lifecycle.result",
      requestId: "terminate-2",
      action: "delete",
      status: "accepted",
      message: "Nope.",
    })).toBeNull();
  });
});

describe("parseScienceAlarmResult", () => {
  it("accepts finite typed alarm results and rejects unsupported providers", () => {
    expect(parseScienceAlarmResult({
      type: "science.alarm.create.result",
      requestId: "alarm-1",
      labId: "42:1",
      status: "accepted",
      message: "Alarm set.",
      provider: "kac",
      triggerUT: 9700084.3,
      leadSeconds: 3600,
    })?.provider).toBe("kac");
    expect(parseScienceAlarmResult({
      type: "science.alarm.create.result",
      requestId: "alarm-2",
      labId: "42:1",
      status: "accepted",
      message: "Alarm set.",
      provider: "other",
    })).toBeNull();
  });
});

describe("parseScienceLabTransmitResult", () => {
  it("accepts typed stock lab transmission results", () => {
    expect(parseScienceLabTransmitResult({
      type: "science.lab.transmit.result",
      requestId: "transmit-1",
      labId: "42:1",
      status: "accepted",
      message: "Transmit Science invoked.",
    })?.labId).toBe("42:1");
    expect(parseScienceLabTransmitResult({
      type: "science.lab.transmit.result",
      requestId: "",
      labId: "42:1",
      status: "accepted",
      message: "Malformed.",
    })).toBeNull();
  });
});

describe("parseScienceLabResearchResult", () => {
  it("accepts typed stock lab research results", () => {
    expect(parseScienceLabResearchResult({
      type: "science.lab.research.result",
      requestId: "research-1",
      labId: "42:1",
      enabled: true,
      status: "accepted",
      message: "Research started.",
    })?.enabled).toBe(true);
    expect(parseScienceLabResearchResult({
      type: "science.lab.research.result",
      requestId: "research-2",
      labId: "42:1",
      enabled: "yes",
      status: "accepted",
      message: "Malformed.",
    })).toBeNull();
  });
});

describe("TelemetryClient", () => {
  it("routes validated lab research results outside the snapshot stream", () => {
    const socket = new FakeSocket();
    const results: ScienceLabResearchResult[] = [];
    const snapshots: TelemetrySnapshot[] = [];
    const client = new TelemetryClient("ws://127.0.0.1:8090", {
      onScienceLabResearchResult: (result) => results.push(result),
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onStatus: () => undefined,
    }, { createSocket: () => socket });

    client.connect();
    socket.open();
    socket.message(JSON.stringify({
      type: "science.lab.research.result",
      requestId: "research-1",
      labId: "42:1",
      enabled: false,
      status: "accepted",
      message: "Research stopped.",
    }));

    expect(results).toHaveLength(1);
    expect(snapshots).toEqual([]);
  });

  it("routes validated lab transmission results outside the snapshot stream", () => {
    const socket = new FakeSocket();
    const results: ScienceLabTransmitResult[] = [];
    const snapshots: TelemetrySnapshot[] = [];
    const client = new TelemetryClient("ws://127.0.0.1:8090", {
      onScienceLabTransmitResult: (result) => results.push(result),
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onStatus: () => undefined,
    }, { createSocket: () => socket });

    client.connect();
    socket.open();
    socket.message(JSON.stringify({
      type: "science.lab.transmit.result",
      requestId: "transmit-1",
      labId: "42:1",
      status: "accepted",
      message: "Transmit Science invoked.",
    }));

    expect(results).toHaveLength(1);
    expect(snapshots).toEqual([]);
  });

  it("routes validated science alarm results outside the snapshot stream", () => {
    const socket = new FakeSocket();
    const results: ScienceAlarmResult[] = [];
    const snapshots: TelemetrySnapshot[] = [];
    const client = new TelemetryClient("ws://127.0.0.1:8090", {
      onScienceAlarmResult: (result) => results.push(result),
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onStatus: () => undefined,
    }, { createSocket: () => socket });

    client.connect();
    socket.open();
    socket.message(JSON.stringify({
      type: "science.alarm.create.result",
      requestId: "alarm-1",
      labId: "42:1",
      status: "accepted",
      message: "KAC alarm set.",
      provider: "kac",
      triggerUT: 9700084.3,
      leadSeconds: 3600,
    }));
    socket.message(JSON.stringify({
      type: "science.alarm.create.result",
      requestId: "",
      labId: "42:1",
      status: "accepted",
      message: "Malformed.",
    }));

    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe("kac");
    expect(snapshots).toEqual([]);
  });

  it("retries the initial connection after 500 ms", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const client = new TelemetryClient(
      "ws://127.0.0.1:8090",
      {
        onSnapshot: () => undefined,
        onStatus: () => undefined,
      },
      {
        createSocket: () => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket;
        },
      },
    );

    client.connect();
    sockets[0].drop();
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
  });

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

  it("routes valid heat loop results and drops malformed result envelopes", () => {
    const socket = new FakeSocket();
    const snapshots: TelemetrySnapshot[] = [];
    const results: HeatLoopControlResult[] = [];
    const client = new TelemetryClient(
      "ws://127.0.0.1:8090",
      {
        onHeatLoopControlResult: (result) => results.push(result),
        onSnapshot: (snapshot) => snapshots.push(snapshot),
        onStatus: () => undefined,
      },
      { createSocket: () => socket },
    );

    client.connect();
    socket.open();
    socket.message(JSON.stringify({
      type: "heat.loop.control.result",
      requestId: "heat-1",
      loopId: 7,
      action: "start",
      status: "accepted",
      message: "Radiators are extending and activating.",
    }));
    socket.message(JSON.stringify({
      type: "heat.loop.control.result",
      requestId: "heat-invalid-loop",
      loopId: -1,
      action: "start",
      status: "error",
      message: "Select a valid heat loop.",
    }));
    socket.message(JSON.stringify({
      type: "heat.loop.control.result",
      requestId: "",
      loopId: -1,
      action: "unknown",
      status: "unknown",
      message: "Malformed.",
    }));

    expect(results).toEqual([
      {
        type: "heat.loop.control.result",
        requestId: "heat-1",
        loopId: 7,
        action: "start",
        status: "accepted",
        message: "Radiators are extending and activating.",
      },
      {
        type: "heat.loop.control.result",
        requestId: "heat-invalid-loop",
        loopId: -1,
        action: "start",
        status: "error",
        message: "Select a valid heat loop.",
      },
    ]);
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

  it("routes vessel lifecycle results only to the originating client callback", () => {
    const socket = new FakeSocket();
    const snapshots: TelemetrySnapshot[] = [];
    const lifecycleResults: OverviewVesselLifecycleResult[] = [];
    const client = new TelemetryClient(
      "ws://127.0.0.1:8090",
      {
        onOverviewVesselLifecycleResult: (result) => lifecycleResults.push(result),
        onSnapshot: (snapshot) => snapshots.push(snapshot),
        onStatus: () => undefined,
      },
      { createSocket: () => socket },
    );

    client.connect();
    socket.open();
    socket.message(JSON.stringify({
      type: "overview.vessel.lifecycle.result",
      requestId: "terminate-1",
      action: "terminate",
      status: "error",
      message: "The vessel changed.",
    }));
    socket.message(JSON.stringify({
      type: "overview.vessel.lifecycle.result",
      requestId: "",
      action: "delete",
      status: "unknown",
      message: "Malformed.",
    }));

    expect(lifecycleResults).toHaveLength(1);
    expect(lifecycleResults[0].requestId).toBe("terminate-1");
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

describe("reactor control results", () => {
  it("parses and routes a valid result without publishing it as telemetry", () => {
    const payload = {
      type: "reactor.control.result" as const,
      requestId: "reactor-1",
      index: 2,
      action: "start_charging" as const,
      status: "accepted" as const,
      message: "Startup charging enabled.",
    };
    expect(parseReactorControlResult(JSON.stringify(payload))).toEqual(payload);
    expect(parseReactorControlResult({ ...payload, index: -1 })).toBeNull();

    const socket = new FakeSocket();
    const results: ReactorControlResult[] = [];
    const snapshots: TelemetrySnapshot[] = [];
    const client = new TelemetryClient("ws://127.0.0.1:8090", {
      onReactorControlResult: (result) => results.push(result),
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onStatus: () => undefined,
    }, { createSocket: () => socket });

    client.connect();
    socket.open();
    socket.message(JSON.stringify(payload));
    socket.message(JSON.stringify({ ...payload, requestId: "", action: "invalid" }));

    expect(results).toEqual([payload]);
    expect(snapshots).toEqual([]);
  });
});

describe("target clear results", () => {
  it("parses and routes a valid result without publishing it as telemetry", () => {
    const payload = {
      type: "target.clear.result" as const,
      requestId: "target-clear-1",
      status: "accepted" as const,
      message: "Target Slate cleared.",
    };
    expect(parseTargetClearResult(JSON.stringify(payload))).toEqual(payload);
    expect(parseTargetClearResult({ ...payload, requestId: "" })).toBeNull();

    const socket = new FakeSocket();
    const results: TargetClearResult[] = [];
    const snapshots: TelemetrySnapshot[] = [];
    const client = new TelemetryClient("ws://127.0.0.1:8090", {
      onTargetClearResult: (result) => results.push(result),
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onStatus: () => undefined,
    }, { createSocket: () => socket });

    client.connect();
    socket.open();
    socket.message(JSON.stringify(payload));
    socket.message(JSON.stringify({ ...payload, requestId: "", status: "invalid" }));

    expect(results).toEqual([payload]);
    expect(snapshots).toEqual([]);
  });
});
