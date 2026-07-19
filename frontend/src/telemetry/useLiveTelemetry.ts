import { useCallback, useRef, useSyncExternalStore } from "react";
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
) {
  const selectorRef = useRef(selector);
  const equalityRef = useRef(isEqual);
  selectorRef.current = selector;
  equalityRef.current = isEqual;
  const cacheRef = useRef<{ hasValue: boolean; value: T }>({
    hasValue: false,
    value: undefined as T,
  });

  const getSelection = useCallback(() => {
    const next = selectorRef.current(liveTelemetryStore.getSnapshot());
    const cached = cacheRef.current;
    if (cached.hasValue && equalityRef.current(cached.value, next)) return cached.value;
    cacheRef.current = { hasValue: true, value: next };
    return next;
  }, []);

  return useSyncExternalStore(
    liveTelemetryStore.subscribe,
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
