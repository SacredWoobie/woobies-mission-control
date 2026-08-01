import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useDialogFocus } from "../deltaV/useDialogFocus";
import { formatScienceColumn, formatScienceInline, isFiniteNumber } from "../formatting/numbers";
import type {
  ScienceAlarmProvider,
  ScienceAlarmProviderPreference,
  ScienceAlarmResult,
  ScienceExperimentTelemetry,
  TelemetryCommand,
  TelemetrySnapshot,
} from "../telemetry/types";
import { Panel } from "./Panel";
import { selectScience, type ScienceLabViewModel } from "./scienceModel";

const SCIENCE_ALARM_SETTINGS_KEY = "wmc-science-alarm-defaults-v1";
type ScienceAlarmLead = 1800 | 3600;

interface ScienceAlarmDefaults {
  provider: ScienceAlarmProviderPreference;
  leadSeconds: ScienceAlarmLead;
}

const defaultScienceAlarmSettings: ScienceAlarmDefaults = {
  provider: "auto",
  leadSeconds: 3600,
};

function readScienceAlarmSettings(): ScienceAlarmDefaults {
  if (typeof localStorage === "undefined") return defaultScienceAlarmSettings;
  try {
    const parsed = JSON.parse(localStorage.getItem(SCIENCE_ALARM_SETTINGS_KEY) ?? "null") as Partial<ScienceAlarmDefaults> | null;
    return {
      provider: parsed?.provider === "kac" || parsed?.provider === "stock" ? parsed.provider : "auto",
      leadSeconds: parsed?.leadSeconds === 1800 ? 1800 : 3600,
    };
  } catch {
    return defaultScienceAlarmSettings;
  }
}

function resolvedAlarmProvider(
  preference: ScienceAlarmProviderPreference,
  providers: Record<ScienceAlarmProvider, boolean>,
): ScienceAlarmProvider | undefined {
  if (preference === "kac" || preference === "stock") return providers[preference] ? preference : undefined;
  if (providers.kac) return "kac";
  return providers.stock ? "stock" : undefined;
}

function capacityPair(current: number | undefined, capacity: number | undefined) {
  if (!isFiniteNumber(current) || !isFiniteNumber(capacity)) return "—";
  const compact = (value: number) => Math.abs(value) >= 100
    ? Math.round(value).toLocaleString("en-US")
    : formatScienceInline(value);
  return `${compact(current)} / ${compact(capacity)}`;
}

function LabMeter({
  capacity,
  current,
  fraction,
  kind,
  label,
  title,
}: {
  capacity: number | undefined;
  current: number | undefined;
  fraction: number | undefined;
  kind: "data" | "science";
  label: string;
  title: string;
}) {
  const percent = isFiniteNumber(fraction) ? Math.round(fraction * 100) : 0;
  return (
    <div className="sci-lab-meter">
      <span className="sci-meter-label">{label}</span>
      <div
        aria-label={isFiniteNumber(fraction) ? `${title} ${label.toLowerCase()} ${percent}% full` : `${title} ${label.toLowerCase()} unavailable`}
        aria-valuemax={isFiniteNumber(capacity) ? capacity : undefined}
        aria-valuemin={0}
        aria-valuenow={isFiniteNumber(current) ? current : undefined}
        className="sci-meter-track"
        role="meter"
      >
        <span className={`sci-meter-fill ${kind}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="sci-meter-value">{capacityPair(current, capacity)}</span>
    </div>
  );
}

function LabCard({ alarmControls, alarmFeedback, lab }: {
  alarmControls?: ReactNode;
  alarmFeedback?: ReactNode;
  lab: ScienceLabViewModel;
}) {
  return (
    <article className={`sci-lab-card ${lab.tone}`}>
      <header className="sci-lab-head">
        <div className="sci-lab-identity">
          <span className="sci-label sci-lab-title" title={lab.title}>Lab · {lab.title}</span>
          <strong className="sci-lab-rate">{formatScienceColumn(lab.sciencePerDay)} <small>sci/day</small></strong>
        </div>
        <div className="sci-lab-status">
          <span className="sci-label">Status</span>
          <strong>{lab.statusLabel}</strong>
          <small>{lab.crewLabel}</small>
        </div>
      </header>
      <LabMeter capacity={lab.dataCapacity} current={lab.dataStored} fraction={lab.dataFraction} kind="data" label="Data" title={lab.title} />
      <LabMeter capacity={lab.scienceCapacity} current={lab.scienceStored} fraction={lab.scienceFraction} kind="science" label="Science" title={lab.title} />
      <footer className="sci-lab-caption">
        <div><span>{lab.activityLabel}</span><span>{lab.guidance}</span></div>
        {alarmControls}
      </footer>
      {alarmFeedback}
    </article>
  );
}

function experimentSource(row: ScienceExperimentTelemetry) {
  return [
    row.sourcePart?.trim(),
    isFiniteNumber(row.data) ? `${formatScienceInline(row.data)} data` : "",
  ].filter(Boolean).join(" · ");
}

export function SciencePanel({
  alarmResult,
  commandEnabled = false,
  onSendCommand = () => false,
  snapshot,
}: {
  alarmResult?: ScienceAlarmResult;
  commandEnabled?: boolean;
  onSendCommand?(command: Extract<TelemetryCommand, { type: "science.alarm.create" }>): boolean;
  snapshot: TelemetrySnapshot;
}) {
  const model = selectScience(snapshot);
  const [alarmSettings, setAlarmSettings] = useState(readScienceAlarmSettings);
  const [draftProvider, setDraftProvider] = useState<ScienceAlarmProviderPreference>(alarmSettings.provider);
  const [draftLeadSeconds, setDraftLeadSeconds] = useState<ScienceAlarmLead>(alarmSettings.leadSeconds);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pending, setPending] = useState<{ labId: string; requestId: string } | null>(null);
  const [feedback, setFeedback] = useState<{ labId: string; message: string; status: "accepted" | "error" } | null>(null);
  const providers = snapshot["sci.alarmProviders"] ?? { kac: false, stock: false };
  const selectedProvider = resolvedAlarmProvider(alarmSettings.provider, providers);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const settingsDialogRef = useDialogFocus<HTMLElement>(settingsOpen, closeSettings);

  useEffect(() => {
    if (!pending || alarmResult?.requestId !== pending.requestId) return;
    setFeedback({ labId: alarmResult.labId, message: alarmResult.message, status: alarmResult.status });
    setPending(null);
  }, [alarmResult, pending]);

  useEffect(() => {
    if (!pending) return;
    const timer = globalThis.setTimeout(() => {
      setFeedback({ labId: pending.labId, message: "The alarm request did not receive a response.", status: "error" });
      setPending(null);
    }, 10_000);
    return () => globalThis.clearTimeout(timer);
  }, [pending]);

  const openSettings = () => {
    setDraftProvider(alarmSettings.provider);
    setDraftLeadSeconds(alarmSettings.leadSeconds);
    setSettingsOpen(true);
  };

  const saveSettings = () => {
    const next = { provider: draftProvider, leadSeconds: draftLeadSeconds };
    setAlarmSettings(next);
    try {
      localStorage.setItem(SCIENCE_ALARM_SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // The in-memory choice still applies when browser storage is unavailable.
    }
    setSettingsOpen(false);
  };

  const createAlarm = (lab: ScienceLabViewModel) => {
    if (!commandEnabled || !selectedProvider || lab.etaKind !== "finite" || !isFiniteNumber(lab.etaSeconds) || pending) return;
    const requestId = globalThis.crypto?.randomUUID?.()
      ?? `science-alarm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const command: Extract<TelemetryCommand, { type: "science.alarm.create" }> = {
      type: "science.alarm.create",
      requestId,
      labId: lab.id,
      provider: alarmSettings.provider,
      leadSeconds: alarmSettings.leadSeconds,
    };
    setFeedback(null);
    if (onSendCommand(command)) {
      setPending({ labId: lab.id, requestId });
    } else {
      setFeedback({ labId: lab.id, message: "The dashboard command link is unavailable.", status: "error" });
    }
  };

  const summary = isFiniteNumber(model.recoverable)
    ? formatScienceInline(model.recoverable)
    : "awaiting kRPC link";
  return (
    <Panel hideable id="sci" title="Science">
      <div className="sci-overview-card">
        <div className="sci-overview-row">
          <div className="sci-overview-hero">
            <span className="sci-label">Recoverable</span>
            <strong className={!isFiniteNumber(model.recoverable) ? "blocked" : ""}>{summary}</strong>
            <small>{model.experimentCount} experiment{model.experimentCount === 1 ? "" : "s"} · {formatScienceInline(model.transmit)} by transmit</small>
          </div>
          <div className="sci-location">
            <span className="sci-label">Location</span>
            <strong>{model.locationPrimary || "—"}</strong>
            <small>{model.locationDetail || "location unavailable"}</small>
          </div>
        </div>
        {isFiniteNumber(model.banked) && <div className="sci-banked">{formatScienceInline(model.banked)} science banked at KSC</div>}
      </div>

      {model.labTelemetryAvailable ? (
        model.labs.length > 0
          ? <div className="sci-lab-list" aria-label="Science laboratories">{model.labs.map((lab) => {
            const alarmEligible = lab.etaKind === "finite" && isFiniteNumber(lab.etaSeconds);
            const waiting = pending?.labId === lab.id;
            const labFeedback = feedback?.labId === lab.id ? feedback : null;
            return <LabCard
              alarmControls={<div className="sci-alarm-controls">
                <button
                  className="sci-alarm-create"
                  disabled={!commandEnabled || !selectedProvider || !alarmEligible || Boolean(pending)}
                  onClick={() => createAlarm(lab)}
                  title={!alarmEligible ? "A finite completion estimate is required" : !selectedProvider ? "No selected alarm provider is available" : "Create a one-shot science capacity alarm"}
                  type="button"
                >{waiting ? "SETTING…" : "SET ALARM"}</button>
                <button aria-haspopup="dialog" aria-label="Science alarm settings" className="sci-alarm-settings" onClick={openSettings} title="Science alarm defaults" type="button">
                  <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M9.7 2h4.6l.6 2.1 1.5.9 2.1-.5 2.3 4-1.5 1.6v1.8l1.5 1.6-2.3 4-2.1-.5-1.5.9-.6 2.1H9.7l-.6-2.1-1.5-.9-2.1.5-2.3-4 1.5-1.6V9.1L3.2 7.5l2.3-4 2.1.5 1.5-.9L9.7 2Zm2.3 6.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z" /></svg>
                </button>
              </div>}
              alarmFeedback={labFeedback && <div className={`sci-alarm-feedback ${labFeedback.status}`} role={labFeedback.status === "error" ? "alert" : "status"}>{labFeedback.message}</div>}
              key={lab.id}
              lab={lab}
            />;
          })}</div>
          : <div className="sci-lab-empty">No research labs aboard</div>
      ) : (
        <div className="sci-lab-empty unavailable">Lab telemetry unavailable · service update required</div>
      )}

      {model.experiments.length > 0 && (
        <details className="sci-details">
          <summary><span>Experiment detail</span><span>{model.experiments.length}</span></summary>
          <div className="sci-list">{model.experiments.map((row, index) => {
            const source = experimentSource(row);
            return (
              <div className="sl-row" key={`${row.title}-${row.subjectId ?? index}`}>
                <span className="sl-copy"><span className="t" title={row.title}>{row.title}</span>{source && <small>{source}</small>}</span>
                <span className="v">{formatScienceColumn(row.value)} <span className="label-muted">/ {formatScienceColumn(row.transmit)} tx</span></span>
              </div>
            );
          })}</div>
        </details>
      )}

      {settingsOpen && <div className="delta-v-modal-backdrop sci-alarm-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSettings(); }}>
        <section aria-labelledby="science-alarm-settings-title" aria-modal="true" className="sci-alarm-modal" onMouseDown={(event) => event.stopPropagation()} ref={settingsDialogRef} role="dialog" tabIndex={-1}>
          <header><div><span>SCIENCE ALARMS</span><h3 id="science-alarm-settings-title">Alarm defaults</h3></div><button aria-label="Close science alarm settings" onClick={closeSettings} type="button">×</button></header>
          <div className="sci-alarm-modal-body">
            <fieldset><legend>Provider</legend><div className="sci-alarm-options">
              {(["auto", "kac", "stock"] as const).map((provider) => <button aria-pressed={draftProvider === provider} disabled={provider !== "auto" && !providers[provider]} key={provider} onClick={() => setDraftProvider(provider)} type="button">{provider.toUpperCase()}</button>)}
            </div></fieldset>
            <small>{draftProvider === "auto" ? "KAC is preferred when available; Stock is the fallback." : `${draftProvider.toUpperCase()} will be used when available.`}</small>
            <fieldset><legend>Lead time</legend><div className="sci-alarm-options lead">
              <button aria-pressed={draftLeadSeconds === 1800} onClick={() => setDraftLeadSeconds(1800)} type="button">30 MIN</button>
              <button aria-pressed={draftLeadSeconds === 3600} onClick={() => setDraftLeadSeconds(3600)} type="button">1 HOUR</button>
            </div></fieldset>
            <small>Alarms are created once from the current estimate and are not rescheduled automatically. KAC shows a message; Stock also stops time warp.</small>
          </div>
          <footer><button onClick={closeSettings} type="button">CANCEL</button><button onClick={saveSettings} type="button">SAVE DEFAULTS</button></footer>
        </section>
      </div>}
    </Panel>
  );
}
