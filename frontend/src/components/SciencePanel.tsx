import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useDialogFocus } from "../deltaV/useDialogFocus";
import { formatScienceColumn, formatScienceInline, isFiniteNumber } from "../formatting/numbers";
import type {
  ScienceAlarmAction,
  ScienceAlarmProvider,
  ScienceAlarmProviderPreference,
  ScienceAlarmResult,
  ScienceExperimentTelemetry,
  ScienceLabResearchResult,
  ScienceLabTransmitResult,
  TelemetryCommand,
  TelemetrySnapshot,
} from "../telemetry/types";
import { Panel } from "./Panel";
import { selectScience, type ScienceLabViewModel } from "./scienceModel";

const SCIENCE_ALARM_SETTINGS_KEY = "wmc-science-alarm-defaults-v1";
type ScienceAlarmLead = 1800 | 3600;
type SciencePanelCommand = Extract<TelemetryCommand, { type: "science.alarm.create" | "science.lab.research" | "science.lab.transmit" }>;

interface ScienceAlarmDefaults {
  provider: ScienceAlarmProviderPreference;
  leadSeconds: ScienceAlarmLead;
  kacAction: ScienceAlarmAction;
}

const defaultScienceAlarmSettings: ScienceAlarmDefaults = {
  provider: "auto",
  leadSeconds: 3600,
  kacAction: "kill_warp",
};

const scienceAlarmActions: Array<{ label: string; value: ScienceAlarmAction }> = [
  { label: "KILL WARP", value: "kill_warp" },
  { label: "PAUSE GAME", value: "pause_game" },
  { label: "MESSAGE ONLY", value: "message_only" },
  { label: "DO NOTHING", value: "do_nothing" },
];

function readScienceAlarmSettings(): ScienceAlarmDefaults {
  if (typeof localStorage === "undefined") return defaultScienceAlarmSettings;
  try {
    const parsed = JSON.parse(localStorage.getItem(SCIENCE_ALARM_SETTINGS_KEY) ?? "null") as Partial<ScienceAlarmDefaults> | null;
    return {
      provider: parsed?.provider === "kac" || parsed?.provider === "stock" ? parsed.provider : "auto",
      leadSeconds: parsed?.leadSeconds === 1800 ? 1800 : 3600,
      kacAction: scienceAlarmActions.some(({ value }) => value === parsed?.kacAction)
        ? parsed!.kacAction as ScienceAlarmAction
        : "kill_warp",
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
  researchResult,
  snapshot,
  transmitResult,
}: {
  alarmResult?: ScienceAlarmResult;
  commandEnabled?: boolean;
  onSendCommand?(command: SciencePanelCommand): boolean;
  researchResult?: ScienceLabResearchResult;
  snapshot: TelemetrySnapshot;
  transmitResult?: ScienceLabTransmitResult;
}) {
  const model = selectScience(snapshot);
  const [alarmSettings, setAlarmSettings] = useState(readScienceAlarmSettings);
  const [draftProvider, setDraftProvider] = useState<ScienceAlarmProviderPreference>(alarmSettings.provider);
  const [draftLeadSeconds, setDraftLeadSeconds] = useState<ScienceAlarmLead>(alarmSettings.leadSeconds);
  const [draftKacAction, setDraftKacAction] = useState<ScienceAlarmAction>(alarmSettings.kacAction);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [experimentDetailOpen, setExperimentDetailOpen] = useState(false);
  const [scienceSlotHeight, setScienceSlotHeight] = useState<number>();
  const [pending, setPending] = useState<{ labId: string; requestId: string } | null>(null);
  const [researchPending, setResearchPending] = useState<{ labId: string; requestId: string; enabled: boolean } | null>(null);
  const [transmitPending, setTransmitPending] = useState<{ labId: string; requestId: string } | null>(null);
  const [feedback, setFeedback] = useState<{ labId: string; message: string; status: "accepted" | "error" } | null>(null);
  const providers = snapshot["sci.alarmProviders"] ?? { kac: false, stock: false };
  const selectedProvider = resolvedAlarmProvider(alarmSettings.provider, providers);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const settingsDialogRef = useDialogFocus<HTMLElement>(settingsOpen, closeSettings);
  const experimentButtonRef = useRef<HTMLButtonElement>(null);
  const experimentBackRef = useRef<HTMLButtonElement>(null);
  const scienceBaselineRef = useRef<HTMLDivElement>(null);
  const experimentDetailWasOpenRef = useRef(false);

  useEffect(() => {
    if (model.experiments.length === 0 && experimentDetailOpen) {
      setExperimentDetailOpen(false);
      setScienceSlotHeight(undefined);
    }
  }, [experimentDetailOpen, model.experiments.length]);

  useEffect(() => {
    if (experimentDetailOpen) {
      experimentBackRef.current?.focus();
    } else if (experimentDetailWasOpenRef.current) {
      experimentButtonRef.current?.focus();
    }
    experimentDetailWasOpenRef.current = experimentDetailOpen;
  }, [experimentDetailOpen]);

  useEffect(() => {
    if (!pending || alarmResult?.requestId !== pending.requestId) return;
    setFeedback({ labId: alarmResult.labId, message: alarmResult.message, status: alarmResult.status });
    setPending(null);
  }, [alarmResult, pending]);

  useEffect(() => {
    if (!researchPending || researchResult?.requestId !== researchPending.requestId) return;
    setFeedback({ labId: researchResult.labId, message: researchResult.message, status: researchResult.status });
    setResearchPending(null);
  }, [researchPending, researchResult]);

  useEffect(() => {
    if (!transmitPending || transmitResult?.requestId !== transmitPending.requestId) return;
    setFeedback({ labId: transmitResult.labId, message: transmitResult.message, status: transmitResult.status });
    setTransmitPending(null);
  }, [transmitPending, transmitResult]);

  useEffect(() => {
    if (!pending) return;
    const timer = globalThis.setTimeout(() => {
      setFeedback({ labId: pending.labId, message: "The alarm request did not receive a response.", status: "error" });
      setPending(null);
    }, 10_000);
    return () => globalThis.clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    if (!researchPending) return;
    const timer = globalThis.setTimeout(() => {
      setFeedback({ labId: researchPending.labId, message: "The research request did not receive a response.", status: "error" });
      setResearchPending(null);
    }, 10_000);
    return () => globalThis.clearTimeout(timer);
  }, [researchPending]);

  useEffect(() => {
    if (!transmitPending) return;
    const timer = globalThis.setTimeout(() => {
      setFeedback({ labId: transmitPending.labId, message: "The transmit request did not receive a response.", status: "error" });
      setTransmitPending(null);
    }, 10_000);
    return () => globalThis.clearTimeout(timer);
  }, [transmitPending]);

  useEffect(() => {
    if (!feedback) return;
    const timer = globalThis.setTimeout(() => setFeedback(null), 10_000);
    return () => globalThis.clearTimeout(timer);
  }, [feedback]);

  const openSettings = () => {
    setDraftProvider(alarmSettings.provider);
    setDraftLeadSeconds(alarmSettings.leadSeconds);
    setDraftKacAction(alarmSettings.kacAction);
    setSettingsOpen(true);
  };

  const saveSettings = () => {
    const next = { provider: draftProvider, leadSeconds: draftLeadSeconds, kacAction: draftKacAction };
    setAlarmSettings(next);
    try {
      localStorage.setItem(SCIENCE_ALARM_SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // The in-memory choice still applies when browser storage is unavailable.
    }
    setSettingsOpen(false);
  };

  const createAlarm = (lab: ScienceLabViewModel) => {
    if (!commandEnabled || !selectedProvider || !["finite", "depleted"].includes(lab.etaKind) || !isFiniteNumber(lab.etaSeconds) || pending) return;
    const requestId = globalThis.crypto?.randomUUID?.()
      ?? `science-alarm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const command: Extract<TelemetryCommand, { type: "science.alarm.create" }> = {
      type: "science.alarm.create",
      requestId,
      labId: lab.id,
      provider: alarmSettings.provider,
      leadSeconds: alarmSettings.leadSeconds,
      kacAction: alarmSettings.kacAction,
    };
    setFeedback(null);
    if (onSendCommand(command)) {
      setPending({ labId: lab.id, requestId });
    } else {
      setFeedback({ labId: lab.id, message: "The dashboard command link is unavailable.", status: "error" });
    }
  };

  const transmitLabScience = (lab: ScienceLabViewModel) => {
    if (!commandEnabled || !isFiniteNumber(lab.scienceStored) || lab.scienceStored <= 1 || researchPending || transmitPending) return;
    const requestId = globalThis.crypto?.randomUUID?.()
      ?? `science-transmit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const command: Extract<TelemetryCommand, { type: "science.lab.transmit" }> = {
      type: "science.lab.transmit",
      requestId,
      labId: lab.id,
    };
    setFeedback(null);
    if (onSendCommand(command)) {
      setTransmitPending({ labId: lab.id, requestId });
    } else {
      setFeedback({ labId: lab.id, message: "The dashboard command link is unavailable.", status: "error" });
    }
  };

  const setLabResearch = (lab: ScienceLabViewModel) => {
    if (!commandEnabled || !lab.converterAvailable || typeof lab.researchEnabled !== "boolean" || researchPending || transmitPending) return;
    const enabled = !lab.researchEnabled;
    const requestId = globalThis.crypto?.randomUUID?.()
      ?? `science-research-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const command: Extract<TelemetryCommand, { type: "science.lab.research" }> = {
      type: "science.lab.research",
      requestId,
      labId: lab.id,
      enabled,
    };
    setFeedback(null);
    if (onSendCommand(command)) {
      setResearchPending({ labId: lab.id, requestId, enabled });
    } else {
      setFeedback({ labId: lab.id, message: "The dashboard command link is unavailable.", status: "error" });
    }
  };

  const summary = isFiniteNumber(model.recoverable)
    ? formatScienceInline(model.recoverable)
    : "awaiting kRPC link";
  const priorityLab = model.labs.find((lab) => lab.tone === "danger")
    ?? model.labs.find((lab) => lab.tone === "warn")
    ?? model.labs[0];
  const railStatus = `${model.experimentCount} EXP${priorityLab ? ` · ${priorityLab.statusLabel}` : ""}`;
  const hasScienceBaseline = model.labs.length > 0 || !model.labTelemetryAvailable;
  const openExperimentDetail = () => {
    const height = model.labs.length > 0
      ? scienceBaselineRef.current?.getBoundingClientRect().height
      : undefined;
    setScienceSlotHeight(height && height > 0 ? height : undefined);
    setExperimentDetailOpen(true);
  };
  const closeExperimentDetail = () => {
    setExperimentDetailOpen(false);
    setScienceSlotHeight(undefined);
  };
  return (
    <Panel collapsible compact id="sci" tag={railStatus} title="Science">
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
        {(model.experiments.length > 0 || isFiniteNumber(model.banked)) && <div className={`sci-banked ${model.experiments.length > 0 ? "has-detail" : ""}`}>
          {model.experiments.length > 0 && <button
            aria-expanded={experimentDetailOpen}
            aria-label={experimentDetailOpen ? "Close experiment detail" : "Open experiment detail"}
            className="sci-experiment-open"
            onClick={experimentDetailOpen ? closeExperimentDetail : openExperimentDetail}
            ref={experimentButtonRef}
            type="button"
          >
            <span>Experiment detail</span>
            <span>{model.experiments.length}</span>
            <span aria-hidden="true">›</span>
          </button>}
          {isFiniteNumber(model.banked) && <span className="sci-banked-value">{formatScienceInline(model.banked)} science banked at KSC</span>}
        </div>}
      </div>

      {(hasScienceBaseline || model.experiments.length > 0) && <div
        className={`sci-content-slot ${experimentDetailOpen ? "detail-open" : ""} ${hasScienceBaseline ? "has-baseline" : ""} ${model.labs.length > 0 ? "has-labs" : ""}`}
        style={scienceSlotHeight ? { height: `${scienceSlotHeight}px` } : undefined}
      >
        {hasScienceBaseline && <div className="sci-baseline-view" hidden={experimentDetailOpen} ref={scienceBaselineRef}>
          {model.labTelemetryAvailable ? (
            <div className="sci-lab-list" aria-label="Science laboratories">{model.labs.map((lab) => {
            const alarmEligible = (lab.etaKind === "finite" || lab.etaKind === "depleted") && isFiniteNumber(lab.etaSeconds);
            const waiting = pending?.labId === lab.id;
            const changingResearch = researchPending?.labId === lab.id;
            const transmitting = transmitPending?.labId === lab.id;
            const canTransmitScience = isFiniteNumber(lab.scienceStored) && lab.scienceStored > 1;
            const canControlResearch = lab.converterAvailable === true && typeof lab.researchEnabled === "boolean";
            const researchLabel = changingResearch
              ? researchPending.enabled ? "STARTINGâ€¦" : "STOPPINGâ€¦"
              : canControlResearch
                ? lab.researchEnabled ? "STOP RESEARCH" : "START RESEARCH"
                : "RESEARCH UNAVAILABLE";
            const labFeedback = feedback?.labId === lab.id ? feedback : null;
            return <LabCard
              alarmControls={<div className="sci-lab-controls">
                <button
                  className="sci-research-toggle"
                  disabled={!commandEnabled || !canControlResearch || Boolean(researchPending) || Boolean(transmitPending)}
                  onClick={() => setLabResearch(lab)}
                  title={canControlResearch ? `Invoke this lab's stock ${lab.researchEnabled ? "Stop" : "Start"} Research action` : "Research control is unavailable for this lab"}
                  type="button"
                >{researchLabel}</button>
                <button
                  className="sci-transmit-science"
                  disabled={!commandEnabled || !canTransmitScience || Boolean(researchPending) || Boolean(transmitPending)}
                  onClick={() => transmitLabScience(lab)}
                  title="Invoke this lab's stock Transmit Science action"
                  type="button"
                >{transmitting ? "TRANSMITTING…" : canTransmitScience ? "TRANSMIT SCIENCE" : "NEED MORE SCIENCE"}</button>
                <div className="sci-alarm-controls">
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
                </div>
              </div>}
              alarmFeedback={labFeedback && <div className={`sci-alarm-feedback ${labFeedback.status}`} role={labFeedback.status === "error" ? "alert" : "status"}>{labFeedback.message}</div>}
              key={lab.id}
              lab={lab}
            />;
            })}</div>
          ) : (
            <div className="sci-lab-empty unavailable">Lab telemetry unavailable · service update required</div>
          )}
        </div>}

        {model.experiments.length > 0 && <section aria-label="Experiment detail" className="sci-experiment-view" hidden={!experimentDetailOpen}>
          <button
            aria-label={model.labs.length > 0 ? "Back to lab data" : "Back to science summary"}
            className="sci-experiment-back"
            onClick={closeExperimentDetail}
            ref={experimentBackRef}
            type="button"
          >
            <span aria-hidden="true">‹</span>
            <span>{model.labs.length > 0 ? "Lab data" : "Science"}</span>
            <span>{model.experiments.length}</span>
          </button>
          <div className="sci-experiment-scroll"><div className="sci-list">{model.experiments.map((row, index) => {
            const source = experimentSource(row);
            return (
              <div className="sl-row" key={`${row.title}-${row.subjectId ?? index}`}>
                <span className="sl-copy"><span className="t" title={row.title}>{row.title}</span>{source && <small>{source}</small>}</span>
                <span className="v">{formatScienceColumn(row.value)} <span className="label-muted">/ {formatScienceColumn(row.transmit)} tx</span></span>
              </div>
            );
          })}</div></div>
        </section>}
      </div>}

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
            <fieldset><legend>KAC alarm action</legend><div className="sci-alarm-options action">
              {scienceAlarmActions.map(({ label, value }) => <button aria-pressed={draftKacAction === value} key={value} onClick={() => setDraftKacAction(value)} type="button">{label}</button>)}
            </div></fieldset>
            <small>Alarms are created once from the current estimate and are not rescheduled automatically. Stock alarms always stop time warp.</small>
          </div>
          <footer><button onClick={closeSettings} type="button">CANCEL</button><button onClick={saveSettings} type="button">SAVE DEFAULTS</button></footer>
        </section>
      </div>}
    </Panel>
  );
}
