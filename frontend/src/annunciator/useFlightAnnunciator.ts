import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionStatus } from "../telemetry/client";
import { isFiniteNumber } from "../formatting/numbers";
import type { TelemetrySnapshot } from "../telemetry/types";
import {
  acknowledgeAnnunciator,
  createAnnunciatorState,
  evaluateAnnunciatorSnapshot,
  summarizeAnnunciator,
  tickAnnunciatorWatchdog,
  type AnnunciatorState,
  type AnnunciatorSummary,
} from "./engine";
import { ACTIVE_FLIGHT_ANNUNCIATOR_RULES } from "./rules";

export interface FlightAnnunciatorController {
  state: AnnunciatorState;
  summary: AnnunciatorSummary;
  acknowledge(): void;
}

interface FlightAnnunciatorInput {
  connectionState: ConnectionStatus;
  frameCount: number;
  lastFrameAt: number | null;
  snapshot: TelemetrySnapshot | null;
  watchdog: boolean;
}

function missionTime(snapshot: TelemetrySnapshot) {
  const value = snapshot["v.missionTime"];
  return isFiniteNumber(value) ? value : undefined;
}

function vesselIdentity(snapshot: TelemetrySnapshot) {
  const value = snapshot["v.persistentId"] ?? snapshot["v.guid"] ?? snapshot["v.name"];
  return value === undefined || value === null ? undefined : String(value);
}

function monotonicNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export function useFlightAnnunciator({
  connectionState,
  frameCount,
  lastFrameAt,
  snapshot,
  watchdog,
}: FlightAnnunciatorInput): FlightAnnunciatorController {
  const [state, setState] = useState(createAnnunciatorState);
  const flightActiveRef = useRef(false);
  const missionTimeRef = useRef<number | undefined>(undefined);
  const connectionStateRef = useRef(connectionState);
  connectionStateRef.current = connectionState;

  useEffect(() => {
    if (snapshot?.["context.mode"] === "flight") {
      flightActiveRef.current = true;
      missionTimeRef.current = missionTime(snapshot);
      setState((current) => evaluateAnnunciatorSnapshot(
        current,
        ACTIVE_FLIGHT_ANNUNCIATOR_RULES,
        snapshot,
        {
          nowMs: monotonicNow(),
          missionTime: missionTimeRef.current,
          vesselIdentity: vesselIdentity(snapshot),
        },
      ));
      return;
    }

    if (snapshot || connectionState === "offline" || connectionState === "connecting") {
      flightActiveRef.current = false;
      missionTimeRef.current = undefined;
      setState(createAnnunciatorState());
    }
  }, [connectionState, frameCount, lastFrameAt, snapshot]);

  useEffect(() => {
    if (!watchdog) return undefined;
    const interval = window.setInterval(() => {
      if (!flightActiveRef.current) return;
      setState((current) => tickAnnunciatorWatchdog(current, {
        nowMs: monotonicNow(),
        missionTime: missionTimeRef.current,
        connectionState: connectionStateRef.current,
        flightActive: true,
      }));
    }, 250);
    return () => window.clearInterval(interval);
  }, [watchdog]);

  const acknowledge = useCallback(() => {
    setState((current) => acknowledgeAnnunciator(current));
  }, []);

  return {
    state,
    summary: useMemo(() => summarizeAnnunciator(state), [state]),
    acknowledge,
  };
}

export function useFixtureFlightAnnunciator(snapshot: TelemetrySnapshot) {
  return useFlightAnnunciator({
    connectionState: "linked",
    frameCount: 1,
    lastFrameAt: 0,
    snapshot,
    watchdog: false,
  });
}
