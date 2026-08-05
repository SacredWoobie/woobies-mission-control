import type {
  HeatLoopControlResult,
  MissionPlanningPersistenceSection,
  MissionPlanningPersistenceState,
  OverviewVesselEditResult,
  OverviewVesselLifecycleResult,
  OverviewVesselSwitchResult,
  TelemetryCommand,
  TelemetrySnapshot,
} from "./types";

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
  onHeatLoopControlResult?(result: HeatLoopControlResult): void;
  onOverviewVesselEditResult?(result: OverviewVesselEditResult): void;
  onOverviewVesselLifecycleResult?(result: OverviewVesselLifecycleResult): void;
  onOverviewVesselSwitchResult?(result: OverviewVesselSwitchResult): void;
  onPersistenceState?(state: MissionPlanningPersistenceState): void;
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

export function parseHeatLoopControlResult(raw: unknown): HeatLoopControlResult | null {
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.type !== "heat.loop.control.result"
    || typeof candidate.requestId !== "string"
    || !candidate.requestId
    || candidate.requestId.length > 128
    || typeof candidate.loopId !== "number"
    || !Number.isSafeInteger(candidate.loopId)
    || candidate.loopId < 0
    || (candidate.action !== "start" && candidate.action !== "stop")
    || (candidate.status !== "accepted" && candidate.status !== "error")
    || typeof candidate.message !== "string"
  ) return null;
  return candidate as unknown as HeatLoopControlResult;
}

function isHeatLoopControlResultMessage(raw: unknown) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Boolean(
      parsed
      && typeof parsed === "object"
      && !Array.isArray(parsed)
      && (parsed as Record<string, unknown>).type === "heat.loop.control.result",
    );
  } catch {
    return false;
  }
}

const persistenceSections = new Set<MissionPlanningPersistenceSection>([
  "resonant",
  "deltaVLibrary",
  "deltaVDraft",
]);
const persistenceStatuses = new Set<MissionPlanningPersistenceState["status"]>([
  "ok",
  "merged",
  "unchanged",
  "updated",
  "conflict",
  "invalid",
  "too_large",
  "error",
]);

export function parseMissionPlanningPersistenceState(raw: unknown): MissionPlanningPersistenceState | null {
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.type !== "mission.planning.persistence.state"
    || typeof candidate.requestId !== "string"
    || !persistenceSections.has(candidate.section as MissionPlanningPersistenceSection)
    || typeof candidate.revision !== "number"
    || !Number.isSafeInteger(candidate.revision)
    || candidate.revision < 0
    || !persistenceStatuses.has(candidate.status as MissionPlanningPersistenceState["status"])
    || typeof candidate.message !== "string"
  ) return null;

  return {
    type: "mission.planning.persistence.state",
    requestId: candidate.requestId,
    section: candidate.section as MissionPlanningPersistenceSection,
    value: candidate.value,
    revision: candidate.revision,
    status: candidate.status as MissionPlanningPersistenceState["status"],
    message: candidate.message,
  };
}

export function parseOverviewVesselSwitchResult(raw: unknown): OverviewVesselSwitchResult | null {
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.type !== "overview.vessel.switch.result"
    || typeof candidate.requestId !== "string"
    || !candidate.requestId
    || candidate.requestId.length > 128
    || (candidate.status !== "accepted" && candidate.status !== "error")
    || typeof candidate.message !== "string"
  ) return null;
  return candidate as unknown as OverviewVesselSwitchResult;
}

export function parseOverviewVesselEditResult(raw: unknown): OverviewVesselEditResult | null {
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.type !== "overview.vessel.edit.result"
    || typeof candidate.requestId !== "string"
    || !candidate.requestId
    || candidate.requestId.length > 128
    || (candidate.status !== "accepted" && candidate.status !== "error")
    || typeof candidate.message !== "string"
    || (candidate.name !== undefined && typeof candidate.name !== "string")
    || (candidate.vesselType !== undefined && typeof candidate.vesselType !== "string")
  ) return null;
  return candidate as unknown as OverviewVesselEditResult;
}

export function parseOverviewVesselLifecycleResult(raw: unknown): OverviewVesselLifecycleResult | null {
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.type !== "overview.vessel.lifecycle.result"
    || typeof candidate.requestId !== "string"
    || !candidate.requestId
    || candidate.requestId.length > 128
    || (candidate.action !== "recover" && candidate.action !== "terminate")
    || (candidate.status !== "accepted" && candidate.status !== "error")
    || typeof candidate.message !== "string"
  ) return null;
  return candidate as unknown as OverviewVesselLifecycleResult;
}

function isOverviewVesselLifecycleResultMessage(raw: unknown) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Boolean(
      parsed
      && typeof parsed === "object"
      && !Array.isArray(parsed)
      && (parsed as Record<string, unknown>).type === "overview.vessel.lifecycle.result",
    );
  } catch {
    return false;
  }
}

function isOverviewVesselEditResultMessage(raw: unknown) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Boolean(
      parsed
      && typeof parsed === "object"
      && !Array.isArray(parsed)
      && (parsed as Record<string, unknown>).type === "overview.vessel.edit.result",
    );
  } catch {
    return false;
  }
}

function isOverviewVesselSwitchResultMessage(raw: unknown) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Boolean(
      parsed
      && typeof parsed === "object"
      && !Array.isArray(parsed)
      && (parsed as Record<string, unknown>).type === "overview.vessel.switch.result",
    );
  } catch {
    return false;
  }
}

function isMissionPlanningPersistenceStateMessage(raw: unknown) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Boolean(
      parsed
      && typeof parsed === "object"
      && !Array.isArray(parsed)
      && (parsed as Record<string, unknown>).type === "mission.planning.persistence.state",
    );
  } catch {
    return false;
  }
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
      const heatLoopControlResult = parseHeatLoopControlResult(event.data);
      if (heatLoopControlResult) {
        this.callbacks.onHeatLoopControlResult?.(heatLoopControlResult);
        return;
      }
      if (isHeatLoopControlResultMessage(event.data)) return;
      const lifecycleResult = parseOverviewVesselLifecycleResult(event.data);
      if (lifecycleResult) {
        this.callbacks.onOverviewVesselLifecycleResult?.(lifecycleResult);
        return;
      }
      if (isOverviewVesselLifecycleResultMessage(event.data)) return;
      const editResult = parseOverviewVesselEditResult(event.data);
      if (editResult) {
        this.callbacks.onOverviewVesselEditResult?.(editResult);
        return;
      }
      if (isOverviewVesselEditResultMessage(event.data)) return;
      const switchResult = parseOverviewVesselSwitchResult(event.data);
      if (switchResult) {
        this.callbacks.onOverviewVesselSwitchResult?.(switchResult);
        return;
      }
      if (isOverviewVesselSwitchResultMessage(event.data)) return;
      const persistenceState = parseMissionPlanningPersistenceState(event.data);
      if (persistenceState) {
        this.callbacks.onPersistenceState?.(persistenceState);
        return;
      }
      if (isMissionPlanningPersistenceStateMessage(event.data)) return;
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
