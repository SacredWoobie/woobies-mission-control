import { useState } from "react";
import { PRODUCT_NAME, PRODUCT_VERSION } from "../buildIdentity";
import { useDialogFocus } from "../deltaV/useDialogFocus";
import {
  CURRENT_THEME_METADATA,
} from "../theme";
import type { TimeSystem } from "../timeSystem";
import type {
  DashboardCapabilitiesSnapshot,
  DashboardCapabilityEvidence,
  DashboardFeatureId,
  ScienceAlarmProvider,
} from "../telemetry/types";
import {
  SCIENCE_ALARM_ACTIONS,
  SCIENCE_ALARM_PROVIDERS,
  SETTINGS_SECTIONS,
  type ScienceAlarmDefaults,
  type SettingsSection,
} from "./state";

export type SettingsFeatureId = DashboardFeatureId;

export type SettingsFeatureStatus = "available" | "stock" | "unavailable" | "unknown";

export const SETTINGS_FEATURES: readonly {
  id: SettingsFeatureId;
  label: string;
  evidence: string;
}[] = [
  { id: "notes", label: "Notes", evidence: "Saved notes continuity across scenes" },
  { id: "science_telemetry", label: "Science telemetry", evidence: "Science lab and experiment telemetry" },
  { id: "science_alarms", label: "Science alarms", evidence: "KAC and Stock alarm providers" },
  { id: "communications", label: "Communications", evidence: "RemoteTech and stock communications" },
  { id: "stage_analysis", label: "Stage analysis", evidence: "Flight and editor staging analysis" },
  { id: "live_transfer_calculations", label: "Live transfer calculations", evidence: "MechJeb-backed transfer planning" },
  { id: "heat_monitoring", label: "Heat monitoring", evidence: "System Heat and stock thermal telemetry" },
  { id: "heat_controls", label: "Heat controls", evidence: "System Heat radiator-loop controls" },
  { id: "editor_electricity", label: "Editor electricity", evidence: "Editor electrical analysis" },
  { id: "damage_monitoring", label: "Damage monitoring", evidence: "Vessel damage and stock damage telemetry" },
];

export interface SettingsTelemetryInfo {
  capabilities?: DashboardCapabilitiesSnapshot | null;
  effectiveEndpoint?: string;
  persistenceStatus?: "shared" | "syncing" | "error" | "local";
}

export interface SettingsDrawerProps {
  buildLabel?: "Development" | "Production";
  effectiveEndpoint?: string;
  hiddenPanelCount?: number;
  issuesUrl?: string;
  launcherBoundary?: string;
  licenseUrl?: string;
  onClose(): void;
  onRestoreHiddenPanels?(): void;
  onScienceAlarmSettingsChange(next: Partial<ScienceAlarmDefaults>): void;
  onSectionChange(section: SettingsSection): void;
  onSetTimeSystem?(system: TimeSystem): void;
  open: boolean;
  paletteLabel?: string;
  productName?: string;
  productVersion?: string;
  releaseUrl?: string;
  repositoryUrl?: string;
  scienceAlarmProviders?: Partial<Record<ScienceAlarmProvider, boolean>>;
  scienceAlarmSettings: ScienceAlarmDefaults;
  section: SettingsSection;
  telemetry?: SettingsTelemetryInfo;
  timeSystem?: TimeSystem;
  wikiBaseUrl?: string;
}

const DEFAULT_WIKI_BASE = "https://github.com/SacredWoobie/woobies-mission-control/wiki";
const REPOSITORY_URL = "https://github.com/SacredWoobie/woobies-mission-control";
const RELEASE_URL = `${REPOSITORY_URL}/releases/tag/v${PRODUCT_VERSION}`;
const ISSUES_URL = `${REPOSITORY_URL}/issues`;
const LICENSE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`;

function wikiUrl(base: string, slug: string) {
  return `${base.replace(/\/$/, "")}/${slug}`;
}

function statusLabel(status: SettingsFeatureStatus) {
  if (status === "available") return "AVAILABLE";
  if (status === "stock") return "AVAILABLE · STOCK";
  if (status === "unavailable") return "UNAVAILABLE";
  return "DETECTION UNAVAILABLE";
}

const STOCK_CAPABILITY_FEATURES = new Set<SettingsFeatureId>([
  "science_telemetry",
  "science_alarms",
  "communications",
  "heat_monitoring",
  "editor_electricity",
  "damage_monitoring",
]);

function validCapabilitySnapshot(snapshot: DashboardCapabilitiesSnapshot | null | undefined): snapshot is DashboardCapabilitiesSnapshot {
  return !!snapshot
    && snapshot.schemaVersion === 1
    && !!snapshot.features
    && typeof snapshot.features === "object";
}

const EVIDENCE_LABELS: Record<string, string> = {
  notes: "Notes provider",
  vessel_science: "Vessel Science provider",
  stock_science: "Stock science provider",
  kac: "Kerbal Alarm Clock provider",
  stock: "Stock alarm provider",
  remote_tech: "RemoteTech provider",
  stock_commnet: "Stock CommNet provider",
  stage_stats: "StageStats service",
  woobies_mechjeb: "Woobies MechJeb bridge",
  mechjeb: "MechJeb compatibility",
  system_heat: "System Heat provider",
  stock_thermal: "Stock thermal fallback",
  dynamic_battery_storage: "Dynamic battery storage",
  stock_electricity: "Stock electricity fallback",
  vessel_damage: "Vessel damage provider",
  stock_damage: "Stock damage provider",
  wcs: "Woobies Control Stats service",
  system_heat_service: "Woobies System Heat service",
  system_heat_mod: "System Heat mod",
  compatibility_target: "Supported MechJeb target",
};

function evidenceLabel(evidence: DashboardCapabilityEvidence) {
  return EVIDENCE_LABELS[evidence.id] ?? "Known capability evidence";
}

function evidenceStatusLabel(status: DashboardCapabilityEvidence["status"]) {
  if (status === "active") return "ACTIVE";
  if (status === "detected") return "DETECTED";
  if (status === "missing") return "MISSING";
  if (status === "unavailable") return "UNAVAILABLE";
  return "UNKNOWN";
}

function evidenceVersion(evidence: DashboardCapabilityEvidence) {
  return typeof evidence.version === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(evidence.version)
    ? ` / v${evidence.version}`
    : "";
}

function externalLink(href: string, children: string) {
  return <a href={href} rel="noreferrer" target="_blank">{children}</a>;
}

function LinkList({ base, links }: { base: string; links: readonly { label: string; slug: string }[] }) {
  return <ul className="settings-link-list">
    {links.map(({ label, slug }) => <li key={slug}>{externalLink(wikiUrl(base, slug), label)}</li>)}
  </ul>;
}

function PreferencesSection({
  heading = "Preferences",
  hiddenPanelCount,
  onRestoreHiddenPanels,
  onScienceAlarmSettingsChange,
  onSetTimeSystem,
  scienceAlarmProviders,
  scienceAlarmSettings,
  scienceOnly = false,
  timeSystem,
}: Pick<SettingsDrawerProps, "hiddenPanelCount" | "onRestoreHiddenPanels" | "onScienceAlarmSettingsChange" | "onSetTimeSystem" | "scienceAlarmProviders" | "scienceAlarmSettings" | "timeSystem"> & { heading?: string; scienceOnly?: boolean }) {
  return <section aria-labelledby="settings-preferences-heading" className="settings-section">
    <h3 id="settings-preferences-heading">{heading}</h3>
    {!scienceOnly && <fieldset className="settings-fieldset">
      <legend>Time system</legend>
      <div className="settings-choice-row">
        {(["kerbin", "earth"] as const).map((candidate) => <button
          aria-pressed={timeSystem === candidate}
          key={candidate}
          onClick={() => onSetTimeSystem?.(candidate)}
          type="button"
        >{candidate === "kerbin" ? "KERBIN TIME" : "EARTH TIME"}</button>)}
      </div>
      <small>Applies immediately to dashboard clocks and planning dates.</small>
    </fieldset>}

    <fieldset className="settings-fieldset">
      <legend>Science alarm defaults</legend>
      <div className="settings-choice-row">
        {SCIENCE_ALARM_PROVIDERS.map(({ label, value }) => {
          const available = value === "auto" || scienceAlarmProviders?.[value as ScienceAlarmProvider] === true;
          return <button
            aria-pressed={scienceAlarmSettings.provider === value}
            disabled={!available}
            key={value}
            onClick={() => onScienceAlarmSettingsChange({ provider: value })}
            title={available ? undefined : "Provider availability is unknown or unavailable."}
            type="button"
          >{label}</button>;
        })}
      </div>
      <div className="settings-choice-row">
        {[1800, 3600].map((seconds) => <button
          aria-pressed={scienceAlarmSettings.leadSeconds === seconds}
          key={seconds}
          onClick={() => onScienceAlarmSettingsChange({ leadSeconds: seconds as 1800 | 3600 })}
          type="button"
        >{seconds === 1800 ? "30 MIN" : "1 HOUR"}</button>)}
      </div>
      <div className="settings-choice-row settings-choice-row-wrap">
        {SCIENCE_ALARM_ACTIONS.map(({ label, value }) => <button
          aria-pressed={scienceAlarmSettings.kacAction === value}
          key={value}
          onClick={() => onScienceAlarmSettingsChange({ kacAction: value })}
          type="button"
        >{label}</button>)}
      </div>
      <small>Selections are stored in this browser and apply immediately to new alarms.</small>
    </fieldset>

    {!scienceOnly && <fieldset className="settings-fieldset">
      <legend>Panel visibility</legend>
      <p>{hiddenPanelCount ? `${hiddenPanelCount} panel${hiddenPanelCount === 1 ? "" : "s"} hidden.` : "No hidden panels."}</p>
      <button disabled={!hiddenPanelCount || !onRestoreHiddenPanels} onClick={onRestoreHiddenPanels} type="button">RESTORE HIDDEN PANELS</button>
      <small>This restores dashboard panels only; it does not change telemetry, plans, or KSP state.</small>
    </fieldset>}
  </section>;
}

function FeaturesSection({ telemetry }: { telemetry?: SettingsTelemetryInfo }) {
  const [expanded, setExpanded] = useState<SettingsFeatureId | null>(null);
  return <section aria-labelledby="settings-features-heading" className="settings-section">
    <h3 id="settings-features-heading">Features &amp; Mods</h3>
    <p className="settings-section-intro">Dashboard-wide status is based on the configured KSP installation, not the current game scene. AVAILABLE means the required known integrations were detected. AVAILABLE · STOCK means the feature remains available through Mission Control&apos;s built-in stock path. DETECTION UNAVAILABLE means the installation could not be checked.</p>
    <div className="settings-feature-list">
      {SETTINGS_FEATURES.map((feature) => {
        const capability = validCapabilitySnapshot(telemetry?.capabilities)
          ? telemetry.capabilities.features[feature.id]
          : undefined;
        const installationEvidence = capability && Array.isArray(capability.evidence)
          ? capability.evidence.filter((item): item is DashboardCapabilityEvidence => !!item && typeof item === "object" && (item.status === "active" || item.status === "detected" || item.status === "missing" || item.status === "unavailable" || item.status === "unknown") && (item.source === "runtime" || item.source === "root_scan") && typeof item.id === "string")
            .filter((item) => item.source === "root_scan")
          : [];
        const detected = installationEvidence.length > 0 && installationEvidence.every((item) => item.status === "detected");
        const missing = installationEvidence.some((item) => item.status === "missing");
        const status: SettingsFeatureStatus = detected
          ? "available"
          : missing
            ? STOCK_CAPABILITY_FEATURES.has(feature.id) ? "stock" : "unavailable"
            : "unknown";
        const open = expanded === feature.id;
        return <article className={`settings-feature settings-feature-${status}`} key={feature.id}>
          <button
            aria-controls={`settings-feature-evidence-${feature.id}`}
            aria-expanded={open}
            className="settings-feature-toggle"
            onClick={() => setExpanded(open ? null : feature.id)}
            type="button"
          >
            <span>{feature.label}</span><strong>{statusLabel(status)}</strong>
          </button>
          {open && <div id={`settings-feature-evidence-${feature.id}`} className="settings-feature-evidence">
            <p>{feature.evidence}</p>
            {installationEvidence.length > 0 && <ul>{installationEvidence.map((item, index) => <li key={`${item.source}-${item.id}-${index}`}>{evidenceLabel(item)} / {evidenceStatusLabel(item.status)} / Installation scan{evidenceVersion(item)}</li>)}</ul>}
          </div>}
        </article>;
      })}
    </div>
    <dl className="settings-diagnostics">
      <div><dt>Effective endpoint</dt><dd>{telemetry?.effectiveEndpoint || "Unknown"}</dd></div>
      <div><dt>Plan persistence</dt><dd>{telemetry?.persistenceStatus === "shared" ? "Shared file" : telemetry?.persistenceStatus === "syncing" ? "Syncing" : telemetry?.persistenceStatus === "error" ? "Storage error" : telemetry?.persistenceStatus === "local" ? "Local until linked" : "Unknown"}</dd></div>
    </dl>
  </section>;
}

function HelpSection({ wikiBaseUrl }: { wikiBaseUrl: string }) {
  return <section aria-labelledby="settings-help-heading" className="settings-section">
    <h3 id="settings-help-heading">Help</h3>
    <h4>Start &amp; setup</h4>
    <LinkList base={wikiBaseUrl} links={[
      { label: "Getting Started", slug: "Getting-Started" },
      { label: "Installation Options", slug: "Installation-Options" },
      { label: "Launcher and Service Maintenance", slug: "Launcher-and-Service-Maintenance" },
    ]} />
    <h4>Dashboard</h4>
    <LinkList base={wikiBaseUrl} links={[
      { label: "Mission Control Overview", slug: "Mission-Control-Overview" },
      { label: "Flight Dashboard", slug: "Flight-Dashboard" },
      { label: "VAB and SPH", slug: "VAB-and-SPH" },
      { label: "Mission Planning", slug: "Mission-Planning" },
      { label: "Notes and Panel Customization", slug: "Notes-and-Panel-Customization" },
    ]} />
    <h4>Support</h4>
    <LinkList base={wikiBaseUrl} links={[
      { label: "Mods and Compatibility", slug: "Mods-and-Compatibility" },
      { label: "Network and Safety", slug: "Network-and-Safety" },
      { label: "Troubleshooting", slug: "Troubleshooting" },
      { label: "ESP32 Controlpad", slug: "ESP32-Controlpad" },
    ]} />
  </section>;
}

function AboutSection({
  buildLabel,
  effectiveEndpoint,
  issuesUrl,
  launcherBoundary,
  licenseUrl,
  paletteLabel,
  productName,
  productVersion,
  releaseUrl,
  repositoryUrl,
  wikiBaseUrl,
}: {
  buildLabel: "Development" | "Production";
  effectiveEndpoint?: string;
  issuesUrl: string;
  launcherBoundary: string;
  licenseUrl: string;
  paletteLabel: string;
  productName: string;
  productVersion: string;
  releaseUrl: string;
  repositoryUrl: string;
  wikiBaseUrl: string;
}) {
  return <section aria-labelledby="settings-about-heading" className="settings-section">
    <h3 id="settings-about-heading">About</h3>
    <dl className="settings-about-list">
      <div><dt>Product</dt><dd>{productName}</dd></div>
      <div><dt>Release</dt><dd>v{productVersion}</dd></div>
      <div><dt>Build</dt><dd>{buildLabel}</dd></div>
      <div><dt>Palette</dt><dd>{paletteLabel} (read-only)</dd></div>
      <div><dt>Loopback endpoint</dt><dd>{effectiveEndpoint || "Unknown"}</dd></div>
      <div><dt>Launcher boundary</dt><dd>{launcherBoundary}</dd></div>
    </dl>
    <ul className="settings-link-list">
      <li>{externalLink(repositoryUrl, "Repository")}</li>
      <li>{externalLink(wikiBaseUrl, "Project wiki")}</li>
      <li>{externalLink(releaseUrl, `v${productVersion} release`)}</li>
      <li>{externalLink(issuesUrl, "Issues")}</li>
      <li>{externalLink(licenseUrl, "License")}</li>
    </ul>
  </section>;
}

export function SettingsDrawer({
  buildLabel = "Production",
  effectiveEndpoint,
  hiddenPanelCount = 0,
  issuesUrl = ISSUES_URL,
  launcherBoundary = "The launcher selects the KSP folder, installs or repairs services, checks updates, and starts or stops the feed. This browser owns dashboard-local preferences only.",
  licenseUrl = LICENSE_URL,
  onClose,
  onRestoreHiddenPanels,
  onScienceAlarmSettingsChange,
  onSectionChange,
  onSetTimeSystem,
  open,
  paletteLabel = CURRENT_THEME_METADATA.label,
  productName = PRODUCT_NAME,
  productVersion = PRODUCT_VERSION,
  releaseUrl = RELEASE_URL,
  repositoryUrl = REPOSITORY_URL,
  scienceAlarmProviders,
  scienceAlarmSettings,
  section,
  telemetry,
  timeSystem,
  wikiBaseUrl = DEFAULT_WIKI_BASE,
}: SettingsDrawerProps) {
  const dialogRef = useDialogFocus<HTMLElement>(open, onClose);
  if (!open) return null;

  const effectiveTelemetry = {
    ...telemetry,
    effectiveEndpoint: effectiveEndpoint ?? telemetry?.effectiveEndpoint,
  };

  return <>
    <div aria-hidden="true" className="resonant-drawer-backdrop settings-drawer-backdrop" onMouseDown={onClose} />
    <aside aria-label="Mission Control Settings" aria-modal="true" className="resonant-drawer settings-drawer" id="settings-drawer" ref={dialogRef} role="dialog" tabIndex={-1}>
      <header>
        <div><span>MISSION CONTROL / SETTINGS</span><h2>Settings</h2><p>Browser-local preferences and integration guidance.</p></div>
        <button aria-label="Close Settings" onClick={onClose} type="button">{"\u00d7"}</button>
      </header>
      <div className="settings-drawer-body resonant-drawer-body">
        <nav aria-label="Settings sections" className="settings-section-nav">
          {SETTINGS_SECTIONS.map(({ id, label }) => {
            const active = section === id || (section === "science-alarms" && id === "preferences");
            return <button aria-current={active ? "page" : undefined} className={active ? "active" : undefined} key={id} onClick={() => onSectionChange(id)} type="button">{label}</button>;
          })}
        </nav>
        {section === "preferences" && <PreferencesSection
          hiddenPanelCount={hiddenPanelCount}
          onRestoreHiddenPanels={onRestoreHiddenPanels}
          onScienceAlarmSettingsChange={onScienceAlarmSettingsChange}
          onSetTimeSystem={onSetTimeSystem}
          scienceAlarmProviders={scienceAlarmProviders}
          scienceAlarmSettings={scienceAlarmSettings}
          timeSystem={timeSystem}
        />}
        {section === "science-alarms" && <PreferencesSection
          heading="Science alarm defaults"
          hiddenPanelCount={hiddenPanelCount}
          onRestoreHiddenPanels={onRestoreHiddenPanels}
          onScienceAlarmSettingsChange={onScienceAlarmSettingsChange}
          onSetTimeSystem={onSetTimeSystem}
          scienceAlarmProviders={scienceAlarmProviders}
          scienceAlarmSettings={scienceAlarmSettings}
          scienceOnly
          timeSystem={timeSystem}
        />}
        {section === "features-mods" && <FeaturesSection telemetry={effectiveTelemetry} />}
        {section === "help" && <HelpSection wikiBaseUrl={wikiBaseUrl} />}
        {section === "about" && <AboutSection
          buildLabel={buildLabel}
          effectiveEndpoint={effectiveEndpoint ?? telemetry?.effectiveEndpoint}
          issuesUrl={issuesUrl}
          launcherBoundary={launcherBoundary}
          licenseUrl={licenseUrl}
          paletteLabel={paletteLabel}
          productName={productName}
          productVersion={productVersion}
          releaseUrl={releaseUrl}
          repositoryUrl={repositoryUrl}
          wikiBaseUrl={wikiBaseUrl}
        />}
      </div>
      <footer><span>Preferences apply in this browser. KSP and the launcher remain outside the browser settings boundary.</span></footer>
    </aside>
  </>;
}
