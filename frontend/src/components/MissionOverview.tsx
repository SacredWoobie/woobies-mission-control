import { useMemo, useState } from "react";
import {
  formatMissionDuration,
  formatTelemetryNumber,
  formatUniversalTime,
  isFiniteNumber,
} from "../telemetry/formatters";
import type {
  OverviewAlarmTelemetry,
  OverviewCrewTelemetry,
  OverviewVesselTelemetry,
  TelemetrySnapshot,
} from "../telemetry/types";
import { PanelRestoreRail, usePanelVisibility, type DashboardPanelId } from "./PanelVisibility";

type SortDirection = "asc" | "desc";

const trackedVesselTypes = [
  "Debris", "Probe", "Rover", "Lander", "Ship", "Station", "Base", "Plane", "Relay",
] as const;
const trackedVesselTypeSet = new Set<string>(trackedVesselTypes);
const missionOverviewPanels = new Set<DashboardPanelId>(["overviewFleet", "overviewRoster", "overviewAlarms"]);

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function compareValues(left: string | number, right: string | number, direction: SortDirection) {
  const result = typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
  return direction === "asc" ? result : -result;
}

function FilterSelect({ label, value, values, onChange }: {
  label: string;
  value: string;
  values: string[];
  onChange(value: string): void;
}) {
  return <label><span>{label}</span><select aria-label={label} onChange={(event) => onChange(event.target.value)} value={value}><option value="all">All</option>{values.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>;
}

function SectionHeader({ count, panelId, title }: { count?: number; panelId?: DashboardPanelId; title: string }) {
  const { hidePanel } = usePanelVisibility();
  return <header className="overview-section-head"><div><span>MISSION CONTROL</span><h2>{title}</h2></div><div className="overview-section-actions">{count !== undefined && <strong>{count}</strong>}{panelId && <button aria-label={`Hide ${title} panel`} className="panel-hide-button" onClick={() => hidePanel(panelId)} title="Hide panel" type="button">‹</button>}</div></header>;
}

function VesselTypeGlyph({ type }: { type: string }) {
  const normalized = type.toLocaleLowerCase();
  if (normalized === "ship") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2c-2.4 2.5-3.7 5.6-3.7 9.4v4.2h7.4v-4.2C15.7 7.6 14.4 4.5 12 2Z"/><path d="m8.3 11.7-3 3.2v3.4l3-1.4m7.4-5.2 3 3.2v3.4l-3-1.4M10 18.2l2 3.3 2-3.3"/></svg>;
  if (normalized === "plane") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2.5 9.8 9 3 12.2v2l7.1-1.1.6 5.4-2.3 1.6v1.4l3.6-.7 3.6.7v-1.4l-2.3-1.6.6-5.4 7.1 1.1v-2L14.2 9 12 2.5Z"/></svg>;
  if (normalized === "lander") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 4-2.6 7.5h11.2L15 4H9Zm-1 7.5v4.2m8-4.2v4.2M8 14l-4 5m12-5 4 5M3 19h4m10 0h4"/></svg>;
  if (normalized === "rover") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 9h11l3 4v3H4v-5l1-2Zm3-3h5v3H8V6Z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>;
  if (normalized === "probe" || normalized === "relay") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 9h6v6H9V9ZM2 8h5v8H2V8Zm15 0h5v8h-5V8ZM7 11h2m6 0h2"/>{normalized === "relay" && <path d="M12 8V4m-3 2.2c1.7-1.7 4.3-1.7 6 0M7 4.3c2.8-2.8 7.2-2.8 10 0"/>}</svg>;
  if (normalized === "station") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 2h4v8h8v4h-8v8h-4v-8H2v-4h8V2Zm-5 4h3v2H5V6Zm11 10h3v2h-3v-2Z"/></svg>;
  if (normalized === "base") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 19h18M5 19v-5a7 7 0 0 1 14 0v5M9 19v-5h6v5M12 7V3m-2 0h4"/></svg>;
  if (normalized === "eva") return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="5" r="3"/><path d="M8 10h8l1 6-3 1v5h-4v-5l-3-1 1-6Zm0 2-4 3m12-3 4 3"/></svg>;
  if (normalized === "flag") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 22V3m1 1h11l-3 4 3 4H7M3 22h7"/></svg>;
  if (normalized === "debris" || normalized === "dropped part") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 8 5-4 3 5 6-2 2 6-5 2-2 6-5-3-4 2 1-6-3-3 2-3Z"/></svg>;
  if (normalized === "space object") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 3 7-1 6 5 2 7-5 7-8 1-6-5-1-7 5-7Zm1 5 3-2m3 5 3 2m-8 4 2 2"/></svg>;
  if (normalized.startsWith("deployed science")) return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 2h6M10 2v6l-5 9c-1 2 .2 4 2.5 4h9c2.3 0 3.5-2 2.5-4l-5-9V2M7 15h10m-8-3h6"/></svg>;
  return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><text x="12" y="16">?</text></svg>;
}

function VesselTypeFilter({ rows, excluded, onToggle, onReset }: {
  rows: OverviewVesselTelemetry[];
  excluded: Set<string>;
  onToggle(type: string): void;
  onReset(): void;
}) {
  const counts = rows.reduce<Record<string, number>>((result, row) => {
    result[row.type] = (result[row.type] ?? 0) + 1;
    return result;
  }, {});
  return <div aria-label="Craft type filters" className="vessel-type-filter" role="group">
    <span className="vessel-type-filter-label">Craft types</span>
    <button aria-label="Enable all craft types" aria-pressed={excluded.size === 0} className="vessel-type-button vessel-type-all" onClick={onReset} title="Show every craft type" type="button"><span>ALL</span></button>
    {trackedVesselTypes.map((type) => {
      const enabled = !excluded.has(type);
      return <button aria-label={`${type} craft type filter`} aria-pressed={enabled} className="vessel-type-button" key={type} onClick={() => onToggle(type)} title={`${enabled ? "Hide" : "Show"} ${type}`} type="button"><VesselTypeGlyph type={type} /><span className="vessel-type-count">{counts[type] ?? 0}</span></button>;
    })}
  </div>;
}

function FleetSection({ rows }: { rows: OverviewVesselTelemetry[] }) {
  const [query, setQuery] = useState("");
  const [excludedTypes, setExcludedTypes] = useState<Set<string>>(() => new Set(["Debris"]));
  const [body, setBody] = useState("all");
  const [scope, setScope] = useState("missions");
  const [sort, setSort] = useState("name");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const trackedRows = useMemo(() => rows.filter((row) => trackedVesselTypeSet.has(row.type)), [rows]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return trackedRows.filter((row) => (
      (scope === "all" || row.mission) &&
      !excludedTypes.has(row.type) &&
      (body === "all" || row.body === body) &&
      (!needle || `${row.name} ${row.type} ${row.situation} ${row.body}`.toLocaleLowerCase().includes(needle))
    )).sort((left, right) => {
      const leftValue = sort === "met" ? left.met : sort === "body" ? left.body : sort === "type" ? left.type : sort === "situation" ? left.situation : left.name;
      const rightValue = sort === "met" ? right.met : sort === "body" ? right.body : sort === "type" ? right.type : sort === "situation" ? right.situation : right.name;
      return compareValues(leftValue, rightValue, direction);
    });
  }, [body, direction, excludedTypes, query, scope, sort, trackedRows]);

  const toggleType = (type: string) => setExcludedTypes((current) => {
    const next = new Set(current);
    if (next.has(type)) next.delete(type); else next.add(type);
    return next;
  });

  return <section className="overview-section overview-fleet">
    <SectionHeader count={visible.length} panelId="overviewFleet" title="Active vessels" />
    <div className="overview-controls fleet-controls">
      <label className="overview-search"><span>Search</span><input aria-label="Search vessels" onChange={(event) => setQuery(event.target.value)} placeholder="Craft, type, SOI..." value={query} /></label>
      <FilterSelect label="SOI" onChange={setBody} value={body} values={unique(trackedRows.map((row) => row.body))} />
      <label><span>Scope</span><select aria-label="Vessel scope" onChange={(event) => setScope(event.target.value)} value={scope}><option value="missions">Mission craft</option><option value="all">All tracked objects</option></select></label>
      <label><span>Sort</span><select aria-label="Sort vessels" onChange={(event) => setSort(event.target.value)} value={sort}><option value="name">Name</option><option value="type">Type</option><option value="met">MET</option><option value="body">SOI</option><option value="situation">Status</option></select></label>
      <button aria-label="Reverse vessel sort" className="overview-sort-direction" onClick={() => setDirection((value) => value === "asc" ? "desc" : "asc")} type="button">{direction === "asc" ? "ASC" : "DESC"}</button>
    </div>
    <VesselTypeFilter excluded={excludedTypes} onReset={() => setExcludedTypes(new Set())} onToggle={toggleType} rows={trackedRows} />
    <div className="overview-table-wrap"><table className="overview-table"><thead><tr><th>Craft</th><th>Type</th><th>Status</th><th>SOI</th><th>MET</th><th>Crew</th></tr></thead><tbody>{visible.map((row) => <tr key={`${row.name}-${row.type}`}><td>{row.name}</td><td>{row.type}</td><td>{row.situation}</td><td>{row.body}</td><td>{formatMissionDuration(row.met)}</td><td>{row.crewCount}</td></tr>)}</tbody></table>{visible.length === 0 && <p className="overview-empty">No vessels match these filters.</p>}</div>
  </section>;
}

function RosterSection({ available, rows }: { available: boolean; rows: OverviewCrewTelemetry[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [trait, setTrait] = useState("all");
  const [level, setLevel] = useState("all");
  const [sort, setSort] = useState("name");
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return rows.filter((row) => (
      (status === "all" || row.status === status) &&
      (trait === "all" || row.trait === trait) &&
      (level === "all" || String(row.level) === level) &&
      (!needle || `${row.name} ${row.status} ${row.trait}`.toLocaleLowerCase().includes(needle))
    )).sort((left, right) => {
      if (sort === "level") return compareValues(right.level, left.level, "asc");
      if (sort === "experience") return compareValues(right.experience, left.experience, "asc");
      if (sort === "flights") return compareValues(right.flightCount, left.flightCount, "asc");
      const key = sort === "status" ? "status" : sort === "trait" ? "trait" : "name";
      return compareValues(left[key], right[key], "asc");
    });
  }, [level, query, rows, sort, status, trait]);

  return <section className="overview-section overview-roster">
    <SectionHeader count={available ? visible.length : undefined} panelId="overviewRoster" title="Astronaut roster" />
    {!available ? <p className="overview-service-warning"><strong>Roster service unavailable</strong><span>Use Install / Repair so WoobiesControlStats can enumerate the complete roster after KSP restarts.</span></p> : <>
      <div className="overview-controls compact">
        <label className="overview-search"><span>Search</span><input aria-label="Search roster" onChange={(event) => setQuery(event.target.value)} placeholder="Kerbonaut..." value={query} /></label>
        <FilterSelect label="Roster status" onChange={setStatus} value={status} values={unique(rows.map((row) => row.status))} />
        <FilterSelect label="Job" onChange={setTrait} value={trait} values={unique(rows.map((row) => row.trait))} />
        <FilterSelect label="Level" onChange={setLevel} value={level} values={unique(rows.map((row) => String(row.level)))} />
        <label><span>Sort</span><select aria-label="Sort roster" onChange={(event) => setSort(event.target.value)} value={sort}><option value="name">Name</option><option value="status">Status</option><option value="trait">Job</option><option value="level">Level</option><option value="experience">Experience</option><option value="flights">Flights</option></select></label>
      </div>
      <div className="overview-table-wrap"><table className="overview-table"><thead><tr><th>Kerbonaut</th><th>Status</th><th>Job</th><th>Level</th><th>XP</th><th>Flights</th></tr></thead><tbody>{visible.map((row) => <tr className={row.status.toLocaleLowerCase() === "dead" ? "honor-row" : ""} key={row.name}><td>{row.name}{row.status.toLocaleLowerCase() === "dead" && <span aria-label="Fallen Kerbonaut" className="honor-star" title="Fallen Kerbonaut">&#9733;</span>}</td><td>{row.status}</td><td>{row.trait}</td><td>{row.level}</td><td>{formatTelemetryNumber(row.experience)}</td><td>{row.flightCount}</td></tr>)}</tbody></table>{visible.length === 0 && <p className="overview-empty">No Kerbonauts match these filters.</p>}</div>
    </>}
  </section>;
}

function formatAlarmType(type: string) {
  return type.toLocaleLowerCase() === "raw" ? "Date / Time" : type;
}

function AlarmSection({ rows, universalTime, providers }: { rows: OverviewAlarmTelemetry[]; universalTime?: number; providers?: Record<"stock" | "kac", string> }) {
  const [source, setSource] = useState("all");
  const visible = rows.filter((row) => source === "all" || row.source === source).sort((left, right) => left.time - right.time);
  return <section className="overview-section overview-alarms">
    <SectionHeader count={visible.length} panelId="overviewAlarms" title="Upcoming alarms" />
    <div className="overview-controls compact"><FilterSelect label="Alarm source" onChange={setSource} value={source} values={unique(rows.map((row) => row.source))} /><span className="overview-provider-state">STOCK {providers?.stock ?? "unknown"} / KAC {providers?.kac ?? "unknown"}</span></div>
    <div className="overview-card-list">{visible.map((row, index) => <article className="overview-list-card overview-alarm-card" key={`${row.source}-${row.time}-${row.title}-${index}`}><div><strong>{row.title}</strong><span>{formatAlarmType(row.type)}{row.vessel ? ` / ${row.vessel}` : ""}</span></div><div className="overview-alarm-time"><strong>T- {formatMissionDuration(Math.max(0, row.time - (universalTime ?? row.time)))}</strong><span>UT {Math.floor(row.time).toLocaleString("en-US")}</span></div><span className={`overview-source ${row.source.toLocaleLowerCase()}`}>{row.source}</span></article>)}</div>
    {visible.length === 0 && <p className="overview-empty">No upcoming alarms from this source.</p>}
  </section>;
}

export function MissionOverview({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const { hiddenPanels } = usePanelVisibility();
  const capabilities = snapshot["overview.capabilities"] ?? { funds: false, science: false, reputation: false, contracts: false };
  const ut = formatUniversalTime(snapshot["t.universalTime"]);
  const contracts = snapshot["overview.contracts"] ?? [];
  const counts = snapshot["overview.contractCounts"];
  const fleetVisible = !hiddenPanels.has("overviewFleet");
  const rosterVisible = !hiddenPanels.has("overviewRoster");
  const alarmsVisible = !hiddenPanels.has("overviewAlarms");
  return <div className="mission-overview">
    <PanelRestoreRail available={missionOverviewPanels} />
    <header className="mission-overview-banner"><div><span>{snapshot["overview.scene"] ?? "SPACE CENTER"} / {snapshot["overview.gameMode"] ?? "UNKNOWN SAVE"}</span><h1>Woobie's Mission Control</h1></div></header>
    <section className="overview-metrics" aria-label="Program status">
      <div><span>Game time</span><strong>{ut.big}</strong><small>{ut.sub}</small></div>
      {capabilities.funds && <div><span>Funds</span><strong>{formatTelemetryNumber(snapshot["overview.funds"])}</strong><small>AVAILABLE</small></div>}
      {capabilities.science && <div><span>Science</span><strong>{formatTelemetryNumber(snapshot["overview.science"])}</strong><small>BANKED</small></div>}
      {capabilities.reputation && <div><span>Reputation</span><strong>{formatTelemetryNumber(snapshot["overview.reputation"])}</strong><small>{isFiniteNumber(snapshot["overview.reputation"]) ? "CURRENT" : "UNAVAILABLE"}</small></div>}
      {capabilities.contracts && <div><span>Contracts</span><strong>{counts?.active ?? 0} active</strong><small>{counts?.offered ?? 0} offered / {counts?.completed ?? 0} complete / {counts?.failed ?? 0} failed</small></div>}
    </section>
    {(fleetVisible || rosterVisible) && <div className={`overview-primary-grid ${fleetVisible !== rosterVisible ? "single" : ""}`}>{fleetVisible && <FleetSection rows={snapshot["overview.vessels"] ?? []} />}{rosterVisible && <RosterSection available={snapshot["overview.rosterAvailable"] === true} rows={snapshot["overview.roster"] ?? []} />}</div>}
    {(alarmsVisible || capabilities.contracts) && <div className="overview-secondary-grid">{alarmsVisible && <AlarmSection providers={snapshot["overview.alarmProviders"]} rows={snapshot["overview.alarms"] ?? []} universalTime={snapshot["t.universalTime"]} />}{capabilities.contracts && <section className="overview-section overview-contracts"><SectionHeader count={contracts.length} title="Active contracts" /><div className="overview-card-list">{contracts.map((contract, index) => <article className="overview-list-card" key={`${contract.title}-${index}`}><div><strong>{contract.title}</strong><span>{contract.type}</span></div><div className="overview-contract-time"><strong>{isFiniteNumber(contract.deadline) ? `T- ${formatMissionDuration(Math.max(0, contract.deadline - (snapshot["t.universalTime"] ?? contract.deadline)))}` : "NO DEADLINE"}</strong><span>{isFiniteNumber(contract.deadline) ? `UT ${Math.floor(contract.deadline).toLocaleString("en-US")}` : ""}</span></div></article>)}</div>{contracts.length === 0 && <p className="overview-empty">No active contracts.</p>}</section>}</div>}
    {snapshot["overview.vesselsTruncated"] && <p className="overview-truncated">Fleet list limited to the first 500 tracked objects.</p>}
  </div>;
}
