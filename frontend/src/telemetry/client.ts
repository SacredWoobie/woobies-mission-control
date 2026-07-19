import type { TelemetryCommand, TelemetrySnapshot } from "./types";

export type ConnectionStatus = "offline" | "connecting" | "linked" | "retrying";

export interface WebSocketTransport {
  readyState: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
  send(data: string): void;
}

interface TelemetryClientCallbacks {
  onSnapshot(snapshot: TelemetrySnapshot): void;
  onStatus(status: ConnectionStatus, message?: string): void;
}

interface TelemetryClientOptions {
  createSocket?: (url: string) => WebSocketTransport;
  reconnectDelayMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

const OPEN_STATE = 1;

function defaultSocketFactory(url: string): WebSocketTransport {
  return new WebSocket(url) as WebSocketTransport;
}

export function parseTelemetrySnapshot(raw: unknown): TelemetrySnapshot | null {
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  const suppliedMode = candidate["context.mode"];
  const mode =
    suppliedMode === "flight" || suppliedMode === "editor" || suppliedMode === "inactive"
      ? suppliedMode
      : candidate["flight.active"] === false
        ? "inactive"
        : "flight";

  return { ...candidate, "context.mode": mode } as TelemetrySnapshot;
}

export class TelemetryClient {
  private readonly callbacks: TelemetryClientCallbacks;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  private readonly createSocket: (url: string) => WebSocketTransport;
  private readonly reconnectDelayMs: number;
  private readonly setTimer: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private socket: WebSocketTransport | null = null;
  private wanted = false;

  constructor(
    private readonly url: string,
    callbacks: TelemetryClientCallbacks,
    options: TelemetryClientOptions = {},
  ) {
    this.callbacks = callbacks;
    this.createSocket = options.createSocket ?? defaultSocketFactory;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 2_000;
    this.setTimer = options.setTimer ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((timer) => globalThis.clearTimeout(timer));
  }

  connect() {
    if (this.wanted) return;
    this.wanted = true;
    this.openSocket("connecting");
  }

  disconnect() {
    this.wanted = false;
    this.clearReconnectTimer();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      try {
        socket.close();
      } catch {
        // The transport is already gone; the desired state is still offline.
      }
    }
    this.callbacks.onStatus("offline");
  }

  send(command: TelemetryCommand) {
    if (!this.socket || this.socket.readyState !== OPEN_STATE) return false;
    this.socket.send(JSON.stringify(command));
    return true;
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      this.clearTimer(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private handleDrop(socket: WebSocketTransport, message: string) {
    if (socket !== this.socket) return;
    this.socket = null;
    if (!this.wanted) {
      this.callbacks.onStatus("offline");
      return;
    }

    this.callbacks.onStatus("retrying", message);
    this.clearReconnectTimer();
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null;
      if (this.wanted) this.openSocket("connecting");
    }, this.reconnectDelayMs);
  }

  private openSocket(status: "connecting") {
    this.callbacks.onStatus(status);
    let socket: WebSocketTransport;
    try {
      socket = this.createSocket(this.url);
    } catch {
      this.scheduleAfterOpenFailure("Bad WebSocket address");
      return;
    }

    this.socket = socket;
    socket.onopen = () => {
      if (socket === this.socket && this.wanted) this.callbacks.onStatus("linked");
    };
    socket.onmessage = (event) => {
      if (socket !== this.socket || !this.wanted) return;
      const snapshot = parseTelemetrySnapshot(event.data);
      if (snapshot) this.callbacks.onSnapshot(snapshot);
    };
    socket.onclose = () => this.handleDrop(socket, "Connection dropped");
    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        this.handleDrop(socket, "Link error");
      }
    };
  }

  private scheduleAfterOpenFailure(message: string) {
    if (!this.wanted) return;
    this.callbacks.onStatus("retrying", message);
    this.clearReconnectTimer();
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null;
      if (this.wanted) this.openSocket("connecting");
    }, this.reconnectDelayMs);
  }
}
