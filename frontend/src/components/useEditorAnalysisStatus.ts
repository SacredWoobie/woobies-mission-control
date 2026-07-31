import { useEffect, useState } from "react";
import type { TelemetrySnapshot } from "../telemetry/types";

const LONG_RECALCULATION_SECONDS = 3;

function finiteRevision(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function useEditorAnalysisStatus(snapshot: TelemetrySnapshot) {
  const revision = finiteRevision(snapshot["editor.revision"]);
  const analysisRevision = finiteRevision(snapshot["editor.analysisRevision"]);
  const pending = snapshot["stage.pending"] === true || snapshot["editor.stable"] === false;
  const retained = pending && analysisRevision !== undefined;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    setElapsedSeconds(0);
    if (!pending) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [pending, revision]);

  const elapsedSuffix = elapsedSeconds >= LONG_RECALCULATION_SECONDS
    ? ` (${elapsedSeconds}s)`
    : "";

  return {
    analysisRevision,
    pending,
    retained,
    staleLabel: `Previous confirmed values — recalculating${elapsedSuffix}`,
  };
}
