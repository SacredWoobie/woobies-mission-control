import { TelemetryClient, type ConnectionStatus } from "./client";
import type {
  MissionPlanningPersistenceSection,
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

export interface LiveTelemetryState {
  endpoint: string;
  frameCount: number;
  lastFrameAt: number | null;
  message?: string;
  overviewVesselEditResult?: OverviewVesselEditResult;
  overviewVesselLifecycleResult?: OverviewVesselLifecycleResult;
  overviewVesselSwitchResult?: OverviewVesselSwitchResult;
  reactorControlResult?: ReactorControlResult;
  scienceAlarmResult?: ScienceAlarmResult;
  scienceLabResearchResult?: ScienceLabResearchResult;
  scienceLabTransmitResult?: ScienceLabTransmitResult;
  snapshot: TelemetrySnapshot | null;
  status: ConnectionStatus;
}

type Listener = () => void;
export type MissionPlanningPersistenceListener = (
  state: MissionPlanningPersistenceState,
) => void;

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
  private readonly persistenceListeners = new Set<MissionPlanningPersistenceListener>();
  private state = initialState;

  constructor(
    private readonly createClient: (
      endpoint: string,
      callbacks: {
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
      },
    ) => TelemetryConnection = (endpoint, callbacks) => new TelemetryClient(endpoint, callbacks),
  ) {}

  readonly getSnapshot = () => this.state;

  readonly subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly subscribeMissionPlanningPersistence = (
    listener: MissionPlanningPersistenceListener,
  ) => {
    this.persistenceListeners.add(listener);
    return () => this.persistenceListeners.delete(listener);
  };

  connect(endpoint: string) {
    const normalized = endpoint.trim();
    if (!normalized) throw new Error("A WebSocket endpoint is required.");
    if (this.client && this.state.endpoint === normalized && this.state.status !== "offline") return;

    this.client?.disconnect();
    this.client = this.createClient(normalized, {
      onOverviewVesselEditResult: (overviewVesselEditResult) => {
        this.patch({ overviewVesselEditResult });
      },
      onOverviewVesselLifecycleResult: (overviewVesselLifecycleResult) => {
        this.patch({ overviewVesselLifecycleResult });
      },
      onOverviewVesselSwitchResult: (overviewVesselSwitchResult) => {
        this.patch({ overviewVesselSwitchResult });
      },
      onReactorControlResult: (reactorControlResult) => {
        this.patch({ reactorControlResult });
      },
      onScienceAlarmResult: (scienceAlarmResult) => {
        this.patch({ scienceAlarmResult });
      },
      onScienceLabResearchResult: (scienceLabResearchResult) => {
        this.patch({ scienceLabResearchResult });
      },
      onScienceLabTransmitResult: (scienceLabTransmitResult) => {
        this.patch({ scienceLabTransmitResult });
      },
      onPersistenceState: (persistenceState) => {
        this.persistenceListeners.forEach((listener) => listener(persistenceState));
      },
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
          ...(clearSnapshot ? {
            snapshot: null,
            overviewVesselEditResult: undefined,
            overviewVesselLifecycleResult: undefined,
            overviewVesselSwitchResult: undefined,
            reactorControlResult: undefined,
            scienceAlarmResult: undefined,
            scienceLabResearchResult: undefined,
            scienceLabTransmitResult: undefined,
          } : {}),
        });
      },
    });
    this.patch({
      endpoint: normalized,
      frameCount: 0,
      lastFrameAt: null,
      message: undefined,
      reactorControlResult: undefined,
      scienceAlarmResult: undefined,
      scienceLabResearchResult: undefined,
      scienceLabTransmitResult: undefined,
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

  requestMissionPlanningPersistence(
    requestId: string,
    section: MissionPlanningPersistenceSection,
  ) {
    return this.send({
      type: "mission.planning.persistence.get",
      requestId,
      section,
    });
  }

  mergeMissionPlanningPersistence(
    requestId: string,
    section: MissionPlanningPersistenceSection,
    incoming: unknown,
    baseRevision: number,
  ) {
    return this.send({
      type: "mission.planning.persistence.merge",
      requestId,
      section,
      incoming,
      baseRevision,
    });
  }

  updateMissionPlanningPersistence(
    requestId: string,
    section: MissionPlanningPersistenceSection,
    value: unknown,
    baseRevision: number,
  ) {
    return this.send({
      type: "mission.planning.persistence.update",
      requestId,
      section,
      value,
      baseRevision,
    });
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
