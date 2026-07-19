import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TelemetryClient,
  parseTelemetrySnapshot,
  type ConnectionStatus,
  type WebSocketTransport,
} from "./client";
import type { TelemetrySnapshot } from "./types";

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
