import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { isFiniteNumber } from "../formatting/numbers";
import { formatMissionDuration } from "../telemetry/formatters";
import type { DamageLossEventTelemetry } from "../telemetry/types";
import { isKerbinTime, useTimeSystem } from "../timeSystem";
import { useDialogFocus } from "../deltaV/useDialogFocus";
import type { AnnunciatorEpisode, AnnunciatorSummary } from "./engine";
import type { FlightAnnunciatorController } from "./useFlightAnnunciator";

const FIXED_INDICATORS = ["HEAT", "REACTOR", "COMMS", "POWER", "DAMAGE"] as const;
type FixedIndicator = typeof FIXED_INDICATORS[number];
type IndicatorState = "clear" | "new" | "acknowledged";
type HistoryView = "all" | FixedIndicator;

function indicatorState(summary: AnnunciatorSummary, subsystem: FixedIndicator): IndicatorState {
  const matching = [...summary.active, ...summary.cleared].filter((episode) => episode.subsystem === subsystem);
  if (matching.some((episode) => !episode.seen)) return "new";
  return summary.active.some((episode) => episode.subsystem === subsystem) ? "acknowledged" : "clear";
}

function indicatorLabel(summary: AnnunciatorSummary, subsystem: FixedIndicator, state: IndicatorState, hasHistory = false) {
  if (state === "clear") {
    return subsystem === "DAMAGE" && hasHistory
      ? "DAMAGE clear. Show recorded part-loss history."
      : `${subsystem} clear`;
  }
  const relevant = (state === "new" ? [...summary.active, ...summary.cleared] : summary.active).filter((episode) => (
    episode.subsystem === subsystem && (state !== "new" || !episode.seen)
  ));
  const level = relevant.some((episode) => episode.tier === "warning") ? "warning" : "caution";
  if (subsystem === "DAMAGE") {
    return state === "new"
      ? `DAMAGE new ${level}. Acknowledge and show affected craft parts.`
      : `DAMAGE ${level} acknowledged. Show affected craft parts.`;
  }
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

function validLossEvent(value: DamageLossEventTelemetry) {
  return value
    && typeof value.eventId === "string"
    && value.eventId.trim().length > 0
    && Number.isSafeInteger(value.partId)
    && value.partId > 0
    && typeof value.name === "string"
    && value.name.trim().length > 0
    && typeof value.kind === "string"
    && typeof value.cause === "string"
    && (value.state === "active" || value.state === "cleared")
    && isFiniteNumber(value.occurrenceUt)
    && isFiniteNumber(value.occurrenceMet)
    && (value.state !== "cleared" || isFiniteNumber(value.clearedUt));
}

function LossEventRow({ event }: { event: DamageLossEventTelemetry }) {
  const { system } = useTimeSystem();
  const kerbin = isKerbinTime(system);
  const occurred = event.occurrenceMet >= 0
    ? `MET ${formatMissionDuration(event.occurrenceMet, kerbin)}`
    : `UT ${event.occurrenceUt.toFixed(1)}`;
  const status = event.state === "cleared"
    ? event.clearReason === "intentional_separation"
      ? "Cleared · branch intentionally separated"
      : `Cleared · ${event.clearReason || "reason unavailable"}`
    : "Active loss";
  return (
    <li className={`annunciator-loss ${event.state}`}>
      <div className="annunciator-episode-head">
        <strong>{event.name}</strong>
        <span>{event.state}</span>
      </div>
      <p>{status}{event.tag?.trim() ? ` · ${event.tag.trim()}` : ""}</p>
      <small>{occurred} · part {event.partId} · {event.kind.replaceAll("_", " ")}</small>
    </li>
  );
}

function AnnunciatorHistory({
  controller,
  filter,
  onClose,
}: {
  controller: FlightAnnunciatorController;
  filter?: FixedIndicator;
  onClose(): void;
}) {
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);
  const active = filter
    ? controller.summary.active.filter((episode) => episode.subsystem === filter)
    : controller.summary.active;
  const cleared = filter
    ? controller.summary.cleared.filter((episode) => episode.subsystem === filter)
    : controller.summary.cleared;
  const title = filter === "DAMAGE" ? "Damage report" : "Master caution history";
  const recordedLosses = controller.damageLossEvents.filter(validLossEvent);
  return createPortal(
    <div className="annunciator-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }} role="presentation">
      <aside aria-labelledby="annunciator-history-title" aria-modal="true" className="annunciator-history" ref={dialogRef} role="dialog" tabIndex={-1}>
        <header>
          <div>
            <span className="label">{filter === "DAMAGE" ? "Craft condition" : "Flight safety record"}</span>
            <h2 id="annunciator-history-title">{title}</h2>
          </div>
          <button aria-label={`Close ${title.toLocaleLowerCase()}`} onClick={onClose} type="button">×</button>
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
          {filter === "DAMAGE" && <section aria-labelledby="annunciator-loss-title">
            <h3 id="annunciator-loss-title">Recorded part loss <span>{recordedLosses.length}</span></h3>
            {controller.damageLossStatus === "known"
              ? recordedLosses.length > 0
                ? <ol>{recordedLosses.map((event) => <LossEventRow event={event} key={event.eventId} />)}</ol>
                : <p className="annunciator-empty">No part-loss events recorded for this vessel.</p>
              : <p className="annunciator-empty">
                {controller.damageLossStatus === "loading"
                  ? "Recorded loss history is loading from the KSP save."
                  : controller.damageLossStatus === "incomplete"
                    ? "Recorded loss history is incomplete."
                    : "Recorded loss history requires WoobiesControlStats 0.2.11 or newer."}
              </p>}
          </section>}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

export function FlightAnnunciator({ controller }: { controller: FlightAnnunciatorController }) {
  const [historyView, setHistoryView] = useState<HistoryView | null>(null);
  const open = historyView !== null;
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
          setHistoryView((current) => current === "all" ? null : "all");
        }}
        type="button"
      >
        <span>MASTER</span>
        <strong>{tier === "warning" ? "WARNING" : "CAUTION"}</strong>
      </button>
      <div aria-label="Flight alert indicators" className="annunciator-indicators" role="group">
        {FIXED_INDICATORS.map((subsystem) => {
          const state = indicatorState(controller.summary, subsystem);
          const hasDamageHistory = subsystem === "DAMAGE" && controller.damageLossEvents.length > 0;
          const opensDamage = subsystem === "DAMAGE" && (state !== "clear" || hasDamageHistory);
          return <button
            aria-label={indicatorLabel(controller.summary, subsystem, state, hasDamageHistory)}
            className={`annunciator-indicator ${state}`}
            disabled={state !== "new" && !opensDamage}
            key={subsystem}
            onClick={() => {
              if (state === "new") controller.acknowledgeSubsystem(subsystem);
              if (opensDamage) setHistoryView("DAMAGE");
            }}
            type="button"
          >{subsystem}</button>;
        })}
      </div>
      {historyView && <AnnunciatorHistory
        controller={controller}
        filter={historyView === "all" ? undefined : historyView}
        onClose={() => setHistoryView(null)}
      />}
    </div>
  );
}
