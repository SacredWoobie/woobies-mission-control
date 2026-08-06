import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatMissionDuration } from "../telemetry/formatters";
import { isKerbinTime, useTimeSystem } from "../timeSystem";
import { useDialogFocus } from "../deltaV/useDialogFocus";
import type { AnnunciatorEpisode } from "./engine";
import type { FlightAnnunciatorController } from "./useFlightAnnunciator";

const TOKEN_GAP_PX = 5;

export function fitAnnunciatorTokenCount(
  availableWidth: number,
  tokenWidths: number[],
  overflowWidth: number,
  gap = TOKEN_GAP_PX,
) {
  if (tokenWidths.length === 0 || availableWidth <= 0) return 0;
  let used = 0;
  for (let count = 1; count <= tokenWidths.length; count += 1) {
    used += (count > 1 ? gap : 0) + tokenWidths[count - 1];
    if (count === tokenWidths.length && used <= availableWidth) return count;
    const remainingWidth = gap + overflowWidth;
    if (used + remainingWidth > availableWidth) return Math.max(0, count - 1);
  }
  return tokenWidths.length;
}

function episodeTime(episode: AnnunciatorEpisode, kerbin: boolean) {
  return episode.onsetMissionTime === undefined
    ? "MET unavailable"
    : `MET ${formatMissionDuration(episode.onsetMissionTime, kerbin)}`;
}

function episodeDuration(episode: AnnunciatorEpisode, kerbin: boolean) {
  if (episode.clearedAtMs === null) return null;
  const seconds = episode.onsetMissionTime !== undefined && episode.clearedAtMissionTime !== undefined
    ? Math.max(0, episode.clearedAtMissionTime - episode.onsetMissionTime)
    : Math.max(0, (episode.clearedAtMs - episode.onsetAtMs) / 1_000);
  return formatMissionDuration(seconds, kerbin);
}

function EpisodeRow({ episode }: { episode: AnnunciatorEpisode }) {
  const { system } = useTimeSystem();
  const kerbin = isKerbinTime(system);
  const duration = episodeDuration(episode, kerbin);
  return (
    <li className={`annunciator-episode ${episode.tier}`}>
      <div className="annunciator-episode-head">
        <strong>{episode.subsystem}</strong>
        <span>{episode.tier}{episode.isBlip ? " · BLIP" : ""}</span>
      </div>
      <p>{episode.message}</p>
      <small>{episodeTime(episode, kerbin)}{duration ? ` · duration ${duration}` : ""}</small>
    </li>
  );
}

function AnnunciatorHistory({
  controller,
  onClose,
}: {
  controller: FlightAnnunciatorController;
  onClose(): void;
}) {
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);
  const { active, cleared } = controller.summary;
  return createPortal(
    <div className="annunciator-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }} role="presentation">
      <aside aria-labelledby="annunciator-history-title" aria-modal="true" className="annunciator-history" ref={dialogRef} role="dialog" tabIndex={-1}>
        <header>
          <div>
            <span className="label">Flight safety record</span>
            <h2 id="annunciator-history-title">Master caution history</h2>
          </div>
          <button aria-label="Close master caution history" onClick={onClose} type="button">×</button>
        </header>
        <div className="annunciator-history-body">
          <section aria-labelledby="annunciator-active-title">
            <h3 id="annunciator-active-title">Active <span>{active.length}</span></h3>
            {active.length > 0
              ? <ol>{active.map((episode) => <EpisodeRow episode={episode} key={episode.id} />)}</ol>
              : <p className="annunciator-empty">No active conditions.</p>}
          </section>
          <section aria-labelledby="annunciator-cleared-title">
            <h3 id="annunciator-cleared-title">Cleared <span>{cleared.length}</span></h3>
            {cleared.length > 0
              ? <ol>{cleared.map((episode) => <EpisodeRow episode={episode} key={episode.id} />)}</ol>
              : <p className="annunciator-empty">No cleared episodes recorded.</p>}
          </section>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

export function FlightAnnunciator({ controller }: { controller: FlightAnnunciatorController }) {
  const [open, setOpen] = useState(false);
  const tokenFieldRef = useRef<HTMLDivElement>(null);
  const measurementRef = useRef<HTMLDivElement>(null);
  const [visibleTokenCount, setVisibleTokenCount] = useState(controller.summary.tokens.length);
  const { lamp, tier, tokens } = controller.summary;
  const tokenKey = tokens.join("\u0000");

  useLayoutEffect(() => {
    const tokenField = tokenFieldRef.current;
    const measurements = measurementRef.current;
    if (!tokenField || !measurements) return undefined;
    const measure = () => {
      const tokenElements = Array.from(measurements.querySelectorAll<HTMLElement>("[data-token-measure]"));
      const overflowElement = measurements.querySelector<HTMLElement>("[data-overflow-measure]");
      const tokenWidths = tokenElements.map((element) => element.getBoundingClientRect().width);
      const overflowWidth = overflowElement?.getBoundingClientRect().width ?? 0;
      setVisibleTokenCount(fitAnnunciatorTokenCount(tokenField.clientWidth, tokenWidths, overflowWidth));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(tokenField);
    return () => observer.disconnect();
  }, [tokenKey]);

  const visibleTokens = tokens.slice(0, visibleTokenCount);
  const hiddenCount = Math.max(0, tokens.length - visibleTokens.length);
  const label = useMemo(() => {
    if (lamp === "dark") return "Master caution clear. Open history.";
    const level = tier === "warning" ? "warning" : "caution";
    return `Master ${level}, ${lamp === "blinking" ? "unacknowledged" : "acknowledged"}. Open history.`;
  }, [lamp, tier]);

  return (
    <div className="flight-annunciator">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        className={`annunciator-lamp ${lamp} ${tier ?? "clear"}`}
        onClick={() => {
          if (!open) controller.acknowledge();
          setOpen((current) => !current);
        }}
        type="button"
      >
        <span>MASTER</span>
        <strong>{tier === "warning" ? "WARNING" : "CAUTION"}</strong>
      </button>
      <div aria-label={tokens.length > 0 ? `Conditions: ${tokens.join(", ")}` : "No outstanding conditions"} className="annunciator-token-field" ref={tokenFieldRef} role="status">
        {visibleTokens.map((token) => <span className="annunciator-token" key={token}>{token}</span>)}
        {hiddenCount > 0 && <span className="annunciator-token overflow">+{hiddenCount}</span>}
        <div aria-hidden="true" className="annunciator-token-measure" ref={measurementRef}>
          {tokens.map((token) => <span className="annunciator-token" data-token-measure key={token}>{token}</span>)}
          <span className="annunciator-token overflow" data-overflow-measure>+99</span>
        </div>
      </div>
      {open && <AnnunciatorHistory controller={controller} onClose={() => setOpen(false)} />}
    </div>
  );
}
