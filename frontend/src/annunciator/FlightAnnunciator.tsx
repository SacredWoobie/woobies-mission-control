import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { formatMissionDuration } from "../telemetry/formatters";
import { isKerbinTime, useTimeSystem } from "../timeSystem";
import { useDialogFocus } from "../deltaV/useDialogFocus";
import type { AnnunciatorEpisode, AnnunciatorSummary } from "./engine";
import type { FlightAnnunciatorController } from "./useFlightAnnunciator";

const FIXED_INDICATORS = ["HEAT", "REACTOR", "POWER", "COMMS", "DATALINK"] as const;
type FixedIndicator = typeof FIXED_INDICATORS[number];
type IndicatorState = "clear" | "new" | "acknowledged";

function indicatorState(summary: AnnunciatorSummary, subsystem: FixedIndicator): IndicatorState {
  const matching = [...summary.active, ...summary.cleared].filter((episode) => episode.subsystem === subsystem);
  if (matching.some((episode) => !episode.seen)) return "new";
  return summary.active.some((episode) => episode.subsystem === subsystem) ? "acknowledged" : "clear";
}

function indicatorLabel(summary: AnnunciatorSummary, subsystem: FixedIndicator, state: IndicatorState) {
  if (state === "clear") return `${subsystem} clear`;
  const relevant = (state === "new" ? [...summary.active, ...summary.cleared] : summary.active).filter((episode) => (
    episode.subsystem === subsystem && (state !== "new" || !episode.seen)
  ));
  const level = relevant.some((episode) => episode.tier === "warning") ? "warning" : "caution";
  return state === "new"
    ? `${subsystem} new ${level}. Acknowledge.`
    : `${subsystem} ${level} acknowledged and still active`;
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
  const { lamp, tier } = controller.summary;
  const label = useMemo(() => {
    if (lamp === "dark") return "Master caution clear. Open history.";
    const level = tier === "warning" ? "warning" : "caution";
    return `Master ${level}, unacknowledged. Open history.`;
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
      <div aria-label="Flight alert indicators" className="annunciator-indicators" role="group">
        {FIXED_INDICATORS.map((subsystem) => {
          const state = indicatorState(controller.summary, subsystem);
          return <button
            aria-label={indicatorLabel(controller.summary, subsystem, state)}
            className={`annunciator-indicator ${state}`}
            disabled={state !== "new"}
            key={subsystem}
            onClick={() => controller.acknowledgeSubsystem(subsystem)}
            type="button"
          >{subsystem}</button>;
        })}
      </div>
      {open && <AnnunciatorHistory controller={controller} onClose={() => setOpen(false)} />}
    </div>
  );
}
