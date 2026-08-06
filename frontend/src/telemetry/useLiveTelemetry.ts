import { useCallback, useRef, useSyncExternalStore } from "react";
import { useFlightPanelActivity } from "../flight/FlightPanelHost";
import { liveTelemetryStore, type LiveTelemetryState } from "./store";

type Equality<T> = (left: T, right: T) => boolean;
type Selector<T> = (state: LiveTelemetryState) => T;

export function shallowEqual<T extends Record<string, unknown>>(left: T, right: T) {
  if (Object.is(left, right)) return true;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every(
    (key) => Object.is(left[key], right[key]),
  );
}

export function useLiveTelemetrySelector<T>(
  selector: Selector<T>,
  isEqual: Equality<T> = Object.is,
  enabled = true,
) {
  const panelActive = useFlightPanelActivity();
  const subscriptionEnabled = enabled && panelActive;
  const selectorRef = useRef(selector);
  const equalityRef = useRef(isEqual);
  selectorRef.current = selector;
  equalityRef.current = isEqual;
  const cacheRef = useRef<{ hasValue: boolean; value: T }>({
    hasValue: false,
    value: undefined as T,
  });
  const enabledRef = useRef(subscriptionEnabled);
  enabledRef.current = subscriptionEnabled;

  const getSelection = useCallback(() => {
    const cached = cacheRef.current;
    if (!enabledRef.current && cached.hasValue) return cached.value;
    const next = selectorRef.current(liveTelemetryStore.getSnapshot());
    if (cached.hasValue && equalityRef.current(cached.value, next)) return cached.value;
    cacheRef.current = { hasValue: true, value: next };
    return next;
  }, []);

  const subscribe = useCallback((listener: () => void) => (
    subscriptionEnabled ? liveTelemetryStore.subscribe(listener) : () => {}
  ), [subscriptionEnabled]);

  return useSyncExternalStore(
    subscribe,
    getSelection,
    getSelection,
  );
}

export function useLiveConnectionStatus() {
  return useLiveTelemetrySelector((state) => ({
    endpoint: state.endpoint,
    message: state.message,
    status: state.status,
  }), shallowEqual);
}

export function useLiveDiagnostics() {
  return useLiveTelemetrySelector((state) => ({
    endpoint: state.endpoint,
    frameCount: state.frameCount,
    lastFrameAt: state.lastFrameAt,
    message: state.message,
    status: state.status,
  }), shallowEqual);
}
