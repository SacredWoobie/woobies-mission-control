import { describe, expect, it, vi } from "vitest";
import { TelemetryStore } from "./store";
import type { ConnectionStatus } from "./client";
import type { TelemetryCommand, TelemetrySnapshot } from "./types";

describe("TelemetryStore", () => {
  it("clears stale snapshots on connection loss and exposes reconnect state", () => {
    let callbacks: {
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
    expect(store.getSnapshot().snapshot?.["v.name"]).toBe("Odyssey");
    expect(store.getSnapshot().frameCount).toBe(1);
    expect(store.getSnapshot().lastFrameAt).not.toBeNull();

    callbacks!.onStatus("retrying", "Connection dropped");
    expect(store.getSnapshot()).toMatchObject({
      message: "Connection dropped",
      snapshot: null,
      status: "retrying",
    });
    expect(store.send({ type: "notes.select", relativePath: null })).toBe(true);
    expect(send).toHaveBeenCalledOnce();

    store.disconnect();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toMatchObject({ snapshot: null, status: "offline" });
    expect(listener).toHaveBeenCalled();
  });
});
