import { TelemetryClient, type ConnectionStatus } from "./client";
import type { TelemetryCommand, TelemetrySnapshot } from "./types";

export interface LiveTelemetryState {
  endpoint: string;
  frameCount: number;
  lastFrameAt: number | null;
  message?: string;
  snapshot: TelemetrySnapshot | null;
  status: ConnectionStatus;
}

type Listener = () => void;
interface TelemetryConnection {
  connect(): void;
  disconnect(): void;
  send(command: TelemetryCommand): boolean;
}

const initialState: LiveTelemetryState = {
  endpoint: "",
  frameCount: 0,
  lastFrameAt: null,
  snapshot: null,
  status: "offline",
};

export class TelemetryStore {
  private client: TelemetryConnection | null = null;
  private readonly listeners = new Set<Listener>();
  private state = initialState;

  constructor(
    private readonly createClient: (
      endpoint: string,
      callbacks: {
        onSnapshot(snapshot: TelemetrySnapshot): void;
        onStatus(status: ConnectionStatus, message?: string): void;
      },
    ) => TelemetryConnection = (endpoint, callbacks) => new TelemetryClient(endpoint, callbacks),
  ) {}

  readonly getSnapshot = () => this.state;

  readonly subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  connect(endpoint: string) {
    const normalized = endpoint.trim();
    if (!normalized) throw new Error("A WebSocket endpoint is required.");
    if (this.client && this.state.endpoint === normalized && this.state.status !== "offline") return;

    this.client?.disconnect();
    this.client = this.createClient(normalized, {
      onSnapshot: (snapshot) => this.patch({
        frameCount: this.state.frameCount + 1,
        lastFrameAt: Date.now(),
        snapshot,
      }),
      onStatus: (status, message) => {
        const clearSnapshot = status === "offline" || status === "connecting" || status === "retrying";
        this.patch({
          message,
          status,
          ...(clearSnapshot ? { snapshot: null } : {}),
        });
      },
    });
    this.patch({
      endpoint: normalized,
      frameCount: 0,
      lastFrameAt: null,
      message: undefined,
      snapshot: null,
      status: "connecting",
    });
    this.client.connect();
  }

  disconnect() {
    const client = this.client;
    this.client = null;
    client?.disconnect();
    this.state = { ...initialState };
    this.emit();
  }

  send(command: TelemetryCommand) {
    return this.client?.send(command) ?? false;
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  private patch(patch: Partial<LiveTelemetryState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }
}

export const liveTelemetryStore = new TelemetryStore();
