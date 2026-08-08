import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { bodiesForSystem } from "../deltaV/calculations";
import { useDialogFocus } from "../deltaV/useDialogFocus";
import {
  formatDistance,
  formatEccentricity,
  formatInclination,
  formatMissionDuration,
  formatOrbitPeriod,
  formatTelemetryNumber,
  formatUniversalTime,
  isFiniteNumber,
} from "../telemetry/formatters";
import type {
  OverviewAlarmTelemetry,
  CelestialBodyTelemetry,
  OverviewContractTelemetry,
  OverviewCrewTelemetry,
  OverviewVesselEditResult,
  OverviewVesselLifecycleAction,
  OverviewVesselLifecycleResult,
  OverviewVesselTelemetry,
  OverviewVesselSwitchResult,
  TelemetryCommand,
  TelemetrySnapshot,
} from "../telemetry/types";
import { isKerbinTime, useTimeSystem } from "../timeSystem";
import { TransferWindowsPanel } from "./TransferWindowsPanel";

type SortDirection = "asc" | "desc";

const trackedVesselTypes = [
  "Debris", "Probe", "Rover", "Lander", "Ship", "Station", "Base", "Plane", "Relay",
] as const;
const trackedVesselTypeSet = new Set<string>(trackedVesselTypes);
const crewStatusOrder = new Map([
  ["assigned", 0],
  ["available", 1],
  ["missing", 2],
  ["dead", 3],
]);
const fallbackBodyCatalog = bodiesForSystem("stock").map(({ name, parent, semiMajorAxis }) => ({ name, parent, semiMajorAxis }));

function celestialBodyOrder(catalog: Array<Pick<CelestialBodyTelemetry, "name" | "parent" | "semiMajorAxis">>) {
  const byName = new Map(catalog.map((body) => [body.name, body]));
  const children = new Map<string, typeof catalog>();
  const compareOrbit = (left: typeof catalog[number], right: typeof catalog[number]) => (
    (isFiniteNumber(left.semiMajorAxis) ? left.semiMajorAxis : Number.POSITIVE_INFINITY)
    - (isFiniteNumber(right.semiMajorAxis) ? right.semiMajorAxis : Number.POSITIVE_INFINITY)
    || left.name.localeCompare(right.name)
  );
  catalog.forEach((body) => {
    const parent = body.parent?.trim() ?? "";
    const siblings = children.get(parent) ?? [];
    siblings.push(body);
    children.set(parent, siblings);
  });
  children.forEach((siblings) => siblings.sort(compareOrbit));

  const ordered: string[] = [];
  const visited = new Set<string>();
  const visit = (body: typeof catalog[number]) => {
    if (visited.has(body.name)) return;
    visited.add(body.name);
    ordered.push(body.name);
    (children.get(body.name) ?? []).forEach(visit);
  };
  catalog
    .filter((body) => !body.parent || !byName.has(body.parent))
    .sort(compareOrbit)
    .forEach(visit);
  catalog.filter((body) => !visited.has(body.name)).sort(compareOrbit).forEach(visit);
  return new Map(ordered.map((name, index) => [name, index]));
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function compareValues(left: string | number, right: string | number, direction: SortDirection) {
  const result = typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
  return direction === "asc" ? result : -result;
}

function vesselKey(row: OverviewVesselTelemetry) {
  if (row.objectId) return `object:${row.objectId}`;
  if (row.guid) return `guid:${row.guid}`;
  return `legacy:${row.name}\u0000${row.type}\u0000${row.body}`;
}

function ContractRewards({ contract }: { contract: OverviewContractTelemetry }) {
  const rewards = [
    ["Funds", contract.fundsCompletion],
    ["Rep", contract.reputationCompletion],
    ["Science", contract.scienceCompletion],
  ].filter((entry): entry is [string, number] => isFiniteNumber(entry[1]) && entry[1] > 0);
  if (rewards.length === 0) return null;
  return <div aria-label="Completion rewards" className="overview-contract-rewards">
    {rewards.map(([label, value]) => <span key={label}>{label} <strong>+{formatTelemetryNumber(value)}</strong></span>)}
  </div>;
}

function FilterSelect({ label, value, values, onChange }: {
  label: string;
  value: string;
  values: string[];
  onChange(value: string): void;
}) {
  return <label><span>{label}</span><select aria-label={label} onChange={(event) => onChange(event.target.value)} value={value}><option value="all">All</option>{values.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>;
}

function SectionHeader({ children, count, title }: { children?: ReactNode; count?: number; title: string }) {
  return <header className="overview-section-head"><h2>{title}</h2><div className="overview-section-actions">{children}{count !== undefined && <strong>{count}</strong>}</div></header>;
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

const maxVesselNameLength = 80;

function FleetSection({ alarms, bodyCatalog, commandEnabled, editResult, kerbin, lifecycleResult, onSendCommand, roster, rows, switchResult, terminationAvailable, universalTime }: {
  alarms: OverviewAlarmTelemetry[];
  bodyCatalog: CelestialBodyTelemetry[];
  commandEnabled: boolean;
  editResult?: OverviewVesselEditResult;
  kerbin: boolean;
  lifecycleResult?: OverviewVesselLifecycleResult;
  onSendCommand(command: TelemetryCommand): boolean;
  roster: OverviewCrewTelemetry[];
  rows: OverviewVesselTelemetry[];
  switchResult?: OverviewVesselSwitchResult;
  terminationAvailable: boolean;
  universalTime?: number;
}) {
  const [query, setQuery] = useState("");
  const [excludedTypes, setExcludedTypes] = useState<Set<string>>(() => new Set(["Debris"]));
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [body, setBody] = useState("all");
  const [scope, setScope] = useState("missions");
  const [sort, setSort] = useState("name");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [collapsedBodies, setCollapsedBodies] = useState<Set<string>>(() => new Set());
  const [selectedVesselKey, setSelectedVesselKey] = useState("");
  const [switchError, setSwitchError] = useState("");
  const [switchRequestId, setSwitchRequestId] = useState("");
  const [switchingVesselKey, setSwitchingVesselKey] = useState("");
  const [switchAccepted, setSwitchAccepted] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameType, setRenameType] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renameNotice, setRenameNotice] = useState("");
  const [renameRequestId, setRenameRequestId] = useState("");
  const [lifecycleAction, setLifecycleAction] = useState<OverviewVesselLifecycleAction>("terminate");
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const [lifecycleError, setLifecycleError] = useState("");
  const [lifecycleNotice, setLifecycleNotice] = useState("");
  const [lifecycleRequestId, setLifecycleRequestId] = useState("");
  const [lifecycleTarget, setLifecycleTarget] = useState<OverviewVesselTelemetry | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const lifecycleCancelRef = useRef<HTMLButtonElement>(null);
  const closeRename = useCallback(() => {
    setRenameOpen(false);
    setRenameError("");
    setRenameRequestId("");
  }, []);
  const renameDialogRef = useDialogFocus<HTMLElement>(renameOpen, closeRename);
  const closeLifecycle = useCallback(() => {
    if (lifecycleRequestId) return;
    setLifecycleOpen(false);
    setLifecycleError("");
    setLifecycleTarget(null);
  }, [lifecycleRequestId]);
  const lifecycleDialogRef = useDialogFocus<HTMLElement>(lifecycleOpen, closeLifecycle);
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
  const groups = useMemo(() => {
    const next = new Map<string, OverviewVesselTelemetry[]>();
    visible.forEach((row) => {
      const group = next.get(row.body) ?? [];
      group.push(row);
      next.set(row.body, group);
    });
    const order = celestialBodyOrder(bodyCatalog.length > 0 ? bodyCatalog : fallbackBodyCatalog);
    return [...next.entries()].sort(([left], [right]) => (
      (order.get(left) ?? Number.POSITIVE_INFINITY) - (order.get(right) ?? Number.POSITIVE_INFINITY)
      || left.localeCompare(right)
    ));
  }, [bodyCatalog, visible]);
  const nearestAlarmVessel = [...alarms]
    .filter((alarm) => alarm.vessel && (!isFiniteNumber(universalTime) || alarm.time >= universalTime))
    .sort((left, right) => left.time - right.time)
    .map((alarm) => alarm.vessel)
    .find((vesselName) => visible.some((row) => row.name === vesselName));
  const preferred = visible.find((row) => row.name === nearestAlarmVessel) ?? visible[0];
  const selected = visible.find((row) => vesselKey(row) === selectedVesselKey) ?? preferred;
  const selectedHasPeriod = selected
    ? isFiniteNumber(selected.period) && (!isFiniteNumber(selected.eccentricity) || selected.eccentricity < 1)
    : false;
  const selectedHasOrbitFacts = selected ? [
    selected.apoapsisAltitude,
    selected.periapsisAltitude,
    selected.inclination,
    selected.eccentricity,
  ].some(isFiniteNumber) || selectedHasPeriod : false;
  const selectedKey = selected ? vesselKey(selected) : "";
  const selectedCrewTrusted = Boolean(
    selected
    && Array.isArray(selected.crewNames)
    && selected.crewNames.length === selected.crewCount,
  );
  const rosterByName = new Map(roster.map((crew) => [crew.name, crew]));
  const selectedCrewProfiles = selectedCrewTrusted
    ? selected!.crewNames!.slice(0, 12).map((name) => ({ name, crew: rosterByName.get(name) }))
    : [];
  const selectedNextAlarm = selected
    ? [...alarms]
      .filter((alarm) => alarm.vessel === selected.name && (!isFiniteNumber(universalTime) || alarm.time >= universalTime))
      .sort((left, right) => left.time - right.time)[0]
    : undefined;
  const commandBusy = Boolean(switchRequestId || renameRequestId || lifecycleRequestId);

  useEffect(() => {
    setSwitchError("");
    setSwitchRequestId("");
    setSwitchingVesselKey("");
    setSwitchAccepted(false);
    setRenameOpen(false);
    setRenameValue("");
    setRenameType("");
    setRenameError("");
    setRenameNotice("");
    setRenameRequestId("");
    setLifecycleOpen(false);
    setLifecycleError("");
    setLifecycleNotice("");
    setLifecycleRequestId("");
    setLifecycleTarget(null);
  }, [selectedKey]);

  useEffect(() => {
    if (!renameOpen) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renameOpen]);

  useEffect(() => {
    if (lifecycleOpen) lifecycleCancelRef.current?.focus();
  }, [lifecycleOpen]);

  useEffect(() => {
    if (!switchRequestId || switchResult?.requestId !== switchRequestId) return;
    if (switchResult.status === "accepted") {
      setSwitchAccepted(true);
      setSwitchError("");
    } else {
      setSwitchError(switchResult.message);
      setSwitchRequestId("");
      setSwitchingVesselKey("");
      setSwitchAccepted(false);
    }
  }, [switchRequestId, switchResult]);

  useEffect(() => {
    if (!switchRequestId) return;
    const timeout = globalThis.setTimeout(() => {
      setSwitchError("KSP did not complete the vessel switch. Refresh the fleet and try again.");
      setSwitchRequestId("");
      setSwitchingVesselKey("");
      setSwitchAccepted(false);
    }, 12_000);
    return () => globalThis.clearTimeout(timeout);
  }, [switchRequestId]);

  useEffect(() => {
    if (!renameRequestId || editResult?.requestId !== renameRequestId) return;
    if (editResult.status === "accepted") {
      setRenameNotice(editResult.message);
      setRenameOpen(false);
      setRenameError("");
      setRenameRequestId("");
    } else {
      setRenameError(editResult.message);
      setRenameRequestId("");
    }
  }, [editResult, renameRequestId]);

  useEffect(() => {
    if (!renameRequestId) return;
    const timeout = globalThis.setTimeout(() => {
      setRenameError("KSP did not answer the edit request. Check the vessel and try again.");
      setRenameRequestId("");
    }, 12_000);
    return () => globalThis.clearTimeout(timeout);
  }, [renameRequestId]);

  useEffect(() => {
    if (!lifecycleRequestId || lifecycleResult?.requestId !== lifecycleRequestId) return;
    if (lifecycleResult.status === "accepted") {
      setLifecycleNotice(lifecycleResult.message);
      setLifecycleOpen(false);
      setLifecycleError("");
      setLifecycleRequestId("");
      setLifecycleTarget(null);
    } else {
      setLifecycleError(lifecycleResult.message);
      setLifecycleRequestId("");
    }
  }, [lifecycleRequestId, lifecycleResult]);

  useEffect(() => {
    if (!lifecycleRequestId) return;
    const timeout = globalThis.setTimeout(() => {
      setLifecycleError("KSP did not answer the vessel request. Refresh the fleet and verify its current state.");
      setLifecycleRequestId("");
    }, 12_000);
    return () => globalThis.clearTimeout(timeout);
  }, [lifecycleRequestId]);

  const toggleType = (type: string) => setExcludedTypes((current) => {
    const next = new Set(current);
    if (next.has(type)) next.delete(type); else next.add(type);
    return next;
  });

  const switchToSelected = () => {
    if (!selected?.objectId || !commandEnabled || switchRequestId || renameRequestId) return;
    const requestId = globalThis.crypto?.randomUUID?.()
      ?? `vessel-switch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const sent = onSendCommand({
      type: "overview.vessel.switch",
      requestId,
      objectId: selected.objectId,
      expectedName: selected.name,
      ...(selected.guid ? { expectedGuid: selected.guid } : {}),
    });
    if (!sent) {
      setSwitchError("Mission Control is not connected to KSP.");
      return;
    }
    setSwitchError("");
    setSwitchAccepted(false);
    setSwitchRequestId(requestId);
    setSwitchingVesselKey(selectedKey);
  };

  const openRename = () => {
    if (!selected?.objectId || !commandEnabled || switchRequestId || renameRequestId) return;
    setRenameValue(selected.name);
    setRenameType(selected.type);
    setRenameError("");
    setRenameNotice("");
    setRenameOpen(true);
  };

  const submitRename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected?.objectId || !commandEnabled || renameRequestId) return;
    const newName = renameValue.trim();
    if (!newName || newName.length > maxVesselNameLength || /[\u0000-\u001f]/.test(newName)) {
      setRenameError(`Vessel names must be 1 to ${maxVesselNameLength} characters without line breaks or control characters.`);
      return;
    }
    if (newName === selected.name && renameType === selected.type) {
      setRenameError("Change the vessel name or type before saving.");
      return;
    }
    const requestId = globalThis.crypto?.randomUUID?.()
      ?? `vessel-edit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const sent = onSendCommand({
      type: "overview.vessel.edit",
      requestId,
      objectId: selected.objectId,
      expectedName: selected.name,
      expectedType: selected.type,
      newName,
      newType: renameType,
      ...(selected.guid ? { expectedGuid: selected.guid } : {}),
    });
    if (!sent) {
      setRenameError("Mission Control is not connected to KSP.");
      return;
    }
    setRenameError("");
    setRenameRequestId(requestId);
  };

  const openLifecycle = () => {
    if (
      !selected?.objectId
      || typeof selected.recoverable !== "boolean"
      || !selectedCrewTrusted
      || !commandEnabled
      || commandBusy
    ) return;
    const action: OverviewVesselLifecycleAction = selected.recoverable ? "recover" : "terminate";
    if (action === "terminate" && !terminationAvailable) return;
    setLifecycleAction(action);
    setLifecycleTarget({ ...selected, crewNames: [...(selected.crewNames ?? [])] });
    setLifecycleError("");
    setLifecycleNotice("");
    setLifecycleOpen(true);
  };

  const submitLifecycle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !lifecycleTarget?.objectId
      || typeof lifecycleTarget.recoverable !== "boolean"
      || !Array.isArray(lifecycleTarget.crewNames)
      || !commandEnabled
      || lifecycleRequestId
    ) return;
    const requestId = globalThis.crypto?.randomUUID?.()
      ?? `vessel-${lifecycleAction}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const sent = onSendCommand({
      type: "overview.vessel.lifecycle",
      requestId,
      action: lifecycleAction,
      objectId: lifecycleTarget.objectId,
      expectedName: lifecycleTarget.name,
      expectedRecoverable: lifecycleTarget.recoverable,
      expectedCrewNames: lifecycleTarget.crewNames,
      ...(lifecycleTarget.guid ? { expectedGuid: lifecycleTarget.guid } : {}),
    });
    if (!sent) {
      setLifecycleError("Mission Control is not connected to KSP.");
      return;
    }
    setLifecycleError("");
    setLifecycleRequestId(requestId);
  };

  return <section className="overview-section overview-fleet">
    <SectionHeader count={visible.length} title="Active vessels">
      <button
        aria-expanded={filtersExpanded}
        className="overview-header-button"
        onClick={() => setFiltersExpanded((value) => !value)}
        type="button"
      >
        Filters {excludedTypes.size > 0 ? excludedTypes.size : ""}
      </button>
    </SectionHeader>
    {filtersExpanded && <div className="overview-fleet-filter-tray">
      <div className="overview-controls fleet-controls">
        <label className="overview-search"><span>Search</span><input aria-label="Search vessels" onChange={(event) => setQuery(event.target.value)} placeholder="Craft, type, SOI..." value={query} /></label>
        <FilterSelect label="SOI" onChange={setBody} value={body} values={unique(trackedRows.map((row) => row.body))} />
        <label><span>Scope</span><select aria-label="Vessel scope" onChange={(event) => setScope(event.target.value)} value={scope}><option value="missions">Mission craft</option><option value="all">All tracked objects</option></select></label>
        <label><span>Sort</span><select aria-label="Sort vessels" onChange={(event) => setSort(event.target.value)} value={sort}><option value="name">Name</option><option value="type">Type</option><option value="met">MET</option><option value="body">SOI</option><option value="situation">Status</option></select></label>
        <button aria-label="Reverse vessel sort" className="overview-sort-direction" onClick={() => setDirection((value) => value === "asc" ? "desc" : "asc")} type="button">{direction === "asc" ? "ASC" : "DESC"}</button>
      </div>
      <VesselTypeFilter excluded={excludedTypes} onReset={() => setExcludedTypes(new Set())} onToggle={toggleType} rows={trackedRows} />
    </div>}
    <div className="overview-vessel-split">
      <div aria-label="Filtered vessels" className="overview-vessel-index">
        {groups.map(([groupBody, groupRows]) => {
          const collapsed = collapsedBodies.has(groupBody);
          const groupId = `overview-vessel-group-${groupBody.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
          return <section className={`overview-vessel-group${collapsed ? " collapsed" : ""}`} key={groupBody}>
            <h3><button aria-controls={groupId} aria-expanded={!collapsed} aria-label={`${collapsed ? "Expand" : "Collapse"} ${groupBody} vessels`} className="overview-vessel-group-toggle" onClick={() => setCollapsedBodies((current) => {
              const next = new Set(current);
              if (next.has(groupBody)) next.delete(groupBody);
              else next.add(groupBody);
              return next;
            })} type="button"><span className="overview-vessel-group-chevron" aria-hidden="true" /><span>{groupBody}</span><strong>{groupRows.length}</strong></button></h3>
            <div hidden={collapsed} id={groupId}>{groupRows.map((row) => {
              const key = vesselKey(row);
              const active = selected ? vesselKey(selected) === key : false;
              return <button aria-label={`Select ${row.name}`} aria-pressed={active} className="overview-vessel-row" key={key} onClick={() => setSelectedVesselKey(key)} type="button">
                <VesselTypeGlyph type={row.type} />
                <span>{row.name}</span>
                <small>{row.type}</small>
              </button>;
            })}</div>
          </section>;
        })}
        {visible.length === 0 && <p className="overview-empty">No vessels match these filters.</p>}
      </div>
      {selected ? <article aria-live="polite" className="overview-vessel-detail">
        <header className="overview-vessel-briefing-head">
          <span aria-hidden="true" className="overview-vessel-briefing-glyph"><VesselTypeGlyph type={selected.type} /></span>
          <div className="overview-vessel-briefing-copy"><strong>{selected.name}</strong><span>{selected.situation} · {selected.body}</span><small>MET {formatMissionDuration(selected.met)}</small></div>
          <div className="overview-vessel-briefing-type"><span>{selected.type}</span>{!selected.mission && <span className="overview-detail-badge">Tracked object</span>}</div>
        </header>
        {selectedHasOrbitFacts && <section className="overview-vessel-orbit-card">
          <div className="overview-vessel-orbit-data"><h3>Orbital parameters</h3><div className="overview-vessel-facts">
            {isFiniteNumber(selected.apoapsisAltitude) && <div><span>Apoapsis</span><strong>{formatDistance(selected.apoapsisAltitude, "live")}</strong></div>}
            {isFiniteNumber(selected.periapsisAltitude) && <div><span>Periapsis</span><strong>{formatDistance(selected.periapsisAltitude, "live")}</strong></div>}
            {isFiniteNumber(selected.inclination) && <div><span>Inclination</span><strong>{formatInclination(selected.inclination)}</strong></div>}
            {selectedHasPeriod && <div><span>Period</span><strong>{formatOrbitPeriod(selected.period, selected.eccentricity, kerbin)}</strong></div>}
            {isFiniteNumber(selected.eccentricity) && <div><span>Eccentricity</span><strong>{formatEccentricity(selected.eccentricity)}</strong></div>}
          </div></div>
        </section>}
        {!selectedHasOrbitFacts && <p className="overview-vessel-facts-empty">{selected.situation.toLocaleLowerCase().includes("landed") || selected.situation.toLocaleLowerCase().includes("splashed") ? "Surface asset · orbital parameters are not applicable." : "Orbital parameters are unavailable for this tracked craft."}</p>}
        {selectedCrewProfiles.length > 0 && <section aria-label="Crew manifest" className="overview-vessel-crew-summary"><header><span>Crew · {selected.crewNames!.length}</span></header><div>{selectedCrewProfiles.map(({ name, crew }) => <div className="overview-vessel-crew-member" key={name}><strong>{name}</strong><small>{crew?.trait || "Role unavailable"}</small></div>)}</div>{selected.crewNames!.length > selectedCrewProfiles.length && <p>+{selected.crewNames!.length - selectedCrewProfiles.length} additional</p>}</section>}
        {selectedNextAlarm && <section aria-labelledby="overview-vessel-next-event-title" className="overview-vessel-next-event">
          <header><span id="overview-vessel-next-event-title">Next event</span></header>
          <article className="overview-vessel-next-event-row">
            <strong>{formatLinkedAlarmTitle(selectedNextAlarm.title, selected.name)}</strong>
            <time dateTime={`UT ${selectedNextAlarm.time}`}><strong>T− {formatMissionDuration(Math.max(0, selectedNextAlarm.time - (universalTime ?? selectedNextAlarm.time)), kerbin)}</strong><span>UT {Math.floor(selectedNextAlarm.time).toLocaleString("en-US")}</span></time>
          </article>
        </section>}
        <div className={`overview-vessel-actions${typeof selected.recoverable === "boolean" ? " has-lifecycle" : ""}`}>
          <button aria-label={`Switch to ${selected.name}`} className="overview-switch-vessel" disabled={!commandEnabled || !selected.objectId || commandBusy} onClick={switchToSelected} type="button">{switchingVesselKey === selectedKey ? (switchAccepted ? "SWITCH REQUESTED" : "SWITCHING…") : "SWITCH TO VESSEL"}</button>
          <button aria-haspopup="dialog" aria-label={`Edit ${selected.name}`} className="overview-rename-vessel" disabled={!commandEnabled || !selected.objectId || commandBusy} onClick={openRename} type="button">EDIT IDENTITY</button>
          {typeof selected.recoverable === "boolean" && <button
            aria-haspopup="dialog"
            aria-label={`${selected.recoverable ? "Recover" : "Terminate"} ${selected.name}`}
            className={selected.recoverable ? "overview-recover-vessel" : "overview-terminate-vessel"}
            disabled={!commandEnabled || !selected.objectId || !selectedCrewTrusted || commandBusy || (!selected.recoverable && !terminationAvailable)}
            onClick={openLifecycle}
            title={!selectedCrewTrusted ? "Current crew list is unavailable" : !selected.recoverable && !terminationAvailable ? "Install the matching vessel-management service to terminate craft" : undefined}
            type="button"
          >{selected.recoverable ? "RECOVER VESSEL" : "TERMINATE VESSEL"}</button>}
        </div>
        <div className="overview-vessel-feedback">
          {switchError && <span className="overview-command-error" role="alert">{switchError}</span>}
          {renameNotice && <span className="overview-command-notice" role="status">{renameNotice}</span>}
          {lifecycleNotice && <span className="overview-command-notice" role="status">{lifecycleNotice}</span>}
        </div>
        {renameOpen && <div className="delta-v-modal-backdrop overview-vessel-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRename(); }}>
          <section aria-labelledby="overview-rename-title" aria-modal="true" className="overview-vessel-modal" onMouseDown={(event) => event.stopPropagation()} ref={renameDialogRef} role="dialog" tabIndex={-1}>
            <header><div><span>CRAFT MANAGEMENT</span><h3 id="overview-rename-title">Edit {selected.name}</h3></div><button aria-label="Close edit vessel dialog" onClick={closeRename} type="button">×</button></header>
            <form onSubmit={submitRename}>
              <label><span>Vessel name</span><input aria-describedby="overview-rename-hint" maxLength={maxVesselNameLength} onChange={(event) => setRenameValue(event.target.value)} ref={renameInputRef} value={renameValue} /></label>
              <fieldset><legend>Vessel type</legend><div className="overview-vessel-type-options">{trackedVesselTypes.map((type) => <button aria-pressed={renameType === type} key={type} onClick={() => setRenameType(type)} type="button"><VesselTypeGlyph type={type} /><span>{type}</span></button>)}</div></fieldset>
              <small id="overview-rename-hint">The selected craft keeps its current identity, mission time, and orbit.</small>
              {renameError && <p className="overview-vessel-modal-error" role="alert">{renameError}</p>}
              <footer><button onClick={closeRename} type="button">CANCEL</button><button disabled={Boolean(renameRequestId) || !renameValue.trim() || (renameValue.trim() === selected.name && renameType === selected.type)} type="submit">{renameRequestId ? "SAVING…" : "SAVE CHANGES"}</button></footer>
            </form>
          </section>
        </div>}
        {lifecycleOpen && lifecycleTarget && <div className="delta-v-modal-backdrop overview-vessel-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeLifecycle(); }}>
          <section aria-labelledby="overview-lifecycle-title" aria-modal="true" className={`overview-vessel-modal overview-vessel-lifecycle-modal ${lifecycleAction}`} onMouseDown={(event) => event.stopPropagation()} ref={lifecycleDialogRef} role="dialog" tabIndex={-1}>
            <header><div><span>{lifecycleAction === "recover" ? "VESSEL RECOVERY" : "DESTRUCTIVE ACTION"}</span><h3 id="overview-lifecycle-title">{lifecycleAction === "recover" ? "Recover" : "Terminate"} {lifecycleTarget.name}?</h3></div><button aria-label={`Close ${lifecycleAction} vessel dialog`} disabled={Boolean(lifecycleRequestId)} onClick={closeLifecycle} type="button">×</button></header>
            <form onSubmit={submitLifecycle}>
              {lifecycleAction === "recover" ? <>
                <p className="overview-vessel-lifecycle-summary">KSP will recover this vessel and process its crew, parts, and resources normally.</p>
                {lifecycleTarget.crewNames!.length > 0 && <section className="overview-vessel-recovery-crew"><strong>Crew returning safely</strong><ul>{lifecycleTarget.crewNames!.map((name) => <li key={name}>{name}</li>)}</ul></section>}
              </> : <>
                <p className="overview-vessel-lifecycle-summary">This permanently removes the vessel from the save and cannot be undone.</p>
                {lifecycleTarget.crewNames!.length > 0 ? <section aria-labelledby="overview-termination-crew-title" className="overview-vessel-termination-crew"><strong id="overview-termination-crew-title">The following Kerbals will be killed:</strong><ul>{lifecycleTarget.crewNames!.map((name) => <li key={name}>{name}</li>)}</ul></section> : <p className="overview-vessel-uncrewed">No crew are aboard this vessel.</p>}
              </>}
              {lifecycleError && <p className="overview-vessel-modal-error" role="alert">{lifecycleError}</p>}
              <footer><button disabled={Boolean(lifecycleRequestId)} onClick={closeLifecycle} ref={lifecycleCancelRef} type="button">CANCEL</button><button disabled={Boolean(lifecycleRequestId)} type="submit">{lifecycleRequestId ? (lifecycleAction === "recover" ? "RECOVERING…" : "TERMINATING…") : (lifecycleAction === "recover" ? "RECOVER VESSEL" : "TERMINATE VESSEL")}</button></footer>
            </form>
          </section>
        </div>}
      </article> : <div className="overview-vessel-detail overview-vessel-detail-empty"><span>Select a vessel to inspect its mission status.</span></div>}
    </div>
  </section>;
}

function groupCrewByStatus(rows: OverviewCrewTelemetry[]) {
  const groups = new Map<string, OverviewCrewTelemetry[]>();
  rows.forEach((row) => {
    const group = groups.get(row.status) ?? [];
    group.push(row);
    groups.set(row.status, group);
  });
  return [...groups.entries()].sort(([left], [right]) => (
    (crewStatusOrder.get(left.toLocaleLowerCase()) ?? 99)
    - (crewStatusOrder.get(right.toLocaleLowerCase()) ?? 99)
    || left.localeCompare(right)
  ));
}

function RosterSection({ available, rows }: { available: boolean; rows: OverviewCrewTelemetry[] }) {
  const [query, setQuery] = useState("");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
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
      (!needle || `${row.name} ${row.status} ${row.trait} ${row.assignment ?? ""}`.toLocaleLowerCase().includes(needle))
    )).sort((left, right) => {
      if (sort === "level") return compareValues(right.level, left.level, "asc");
      if (sort === "flights") return compareValues(right.flightCount, left.flightCount, "asc");
      const key = sort === "status" ? "status" : sort === "trait" ? "trait" : "name";
      return compareValues(left[key], right[key], "asc");
    });
  }, [level, query, rows, sort, status, trait]);
  const groups = useMemo(() => groupCrewByStatus(visible), [visible]);
  const statusSummary = useMemo(() => groupCrewByStatus(rows).map(([groupStatus, groupRows]) => ({
    count: groupRows.length,
    label: groupStatus.toLocaleLowerCase() === "dead" ? "Memorial" : groupStatus,
    status: groupStatus.toLocaleLowerCase(),
  })), [rows]);

  return <section className="overview-section overview-roster">
    <SectionHeader count={available ? visible.length : undefined} title="Astronaut roster">
      {available && <div aria-label="Roster status summary" className="overview-roster-summary">{statusSummary.map((item) => <span className={`overview-roster-summary-chip ${item.status}`} key={item.status}><span>{item.label}</span><strong>{item.count}</strong></span>)}</div>}
      {available && <button
        aria-expanded={filtersExpanded}
        aria-label="Roster filters"
        className="overview-header-button"
        onClick={() => setFiltersExpanded((value) => !value)}
        type="button"
      >
        Filters
      </button>}
    </SectionHeader>
    {!available ? <p className="overview-service-warning"><strong>Roster service unavailable</strong><span>Use Install / Repair so WoobiesControlStats can enumerate the complete roster after KSP restarts.</span></p> : <>
      {filtersExpanded && <div className="overview-roster-filter-tray"><div className="overview-controls compact roster-controls">
        <label className="overview-search"><span>Search</span><input aria-label="Search roster" onChange={(event) => setQuery(event.target.value)} placeholder="Kerbonaut..." value={query} /></label>
        <FilterSelect label="Roster status" onChange={setStatus} value={status} values={unique(rows.map((row) => row.status))} />
        <FilterSelect label="Job" onChange={setTrait} value={trait} values={unique(rows.map((row) => row.trait))} />
        <FilterSelect label="Level" onChange={setLevel} value={level} values={unique(rows.map((row) => String(row.level)))} />
        <label><span>Sort</span><select aria-label="Sort roster" onChange={(event) => setSort(event.target.value)} value={sort}><option value="name">Name</option><option value="status">Status</option><option value="trait">Job</option><option value="level">Level</option><option value="flights">Flights</option></select></label>
      </div></div>}
      <div className="overview-table-wrap overview-roster-table-wrap">
        {visible.length > 0 ? <table aria-label="Filtered Kerbonauts" className="overview-table overview-roster-table">
          <thead><tr><th>Name</th><th>Role</th><th>Level</th><th>Assignment</th><th>Flights</th></tr></thead>
          <tbody>{groups.flatMap(([groupStatus, groupRows]) => groupRows.map((row) => {
              const fallen = row.status.toLocaleLowerCase() === "dead";
              return <tr className={fallen ? "honor-row" : ""} key={`${row.name}\u0000${row.type}`}>
                <td className="overview-roster-name"><span aria-label={`${groupStatus} status`} className={`overview-roster-status-dot ${groupStatus.toLocaleLowerCase()}`} />{row.name}{row.veteran && <span aria-label="Orange suit" className="overview-orange-suit-dot" title="Orange suit" />}{fallen && <span aria-label="Fallen Kerbonaut" className="honor-star" title="Fallen Kerbonaut">&#9733;</span>}</td>
                <td>{row.trait || "\u2014"}</td>
                <td>{row.level}</td>
                <td className={row.assignment ? "" : "overview-roster-unassigned"} title={row.assignment}>{row.assignment || "\u2014"}</td>
                <td>{row.flightCount}</td>
              </tr>;
            }))}</tbody>
        </table> : <p className="overview-empty">No Kerbonauts match these filters.</p>}
      </div>
    </>}
  </section>;
}

function formatAlarmType(type: string) {
  const normalized = type.trim().toLocaleLowerCase();
  return normalized === "raw" || normalized === "date / time" ? "" : type;
}

function formatLinkedAlarmTitle(title: string, vesselName: string) {
  const trimmedTitle = title.trim();
  const trimmedVessel = vesselName.trim();
  if (!trimmedVessel || !trimmedTitle.toLocaleLowerCase().startsWith(trimmedVessel.toLocaleLowerCase())) return trimmedTitle;
  const suffix = trimmedTitle.slice(trimmedVessel.length);
  if (suffix && !/^[\s·:—-]/.test(suffix)) return trimmedTitle;
  const eventTitle = suffix.replace(/^[\s·:—-]+/, "").trim();
  return eventTitle ? `${eventTitle.charAt(0).toLocaleUpperCase()}${eventTitle.slice(1)}` : "Scheduled event";
}

function AlarmSection({ rows, universalTime, kerbin }: { rows: OverviewAlarmTelemetry[]; universalTime?: number; kerbin: boolean }) {
  const [source, setSource] = useState<"all" | "stock" | "kac">("all");
  const hasMultipleSources = new Set(rows.map((row) => row.source.toLocaleLowerCase())).size > 1;
  const activeSource = hasMultipleSources ? source : "all";
  const visible = rows
    .filter((row) => activeSource === "all" || row.source.toLocaleLowerCase() === activeSource)
    .sort((left, right) => left.time - right.time);
  return <section className="overview-section overview-alarms">
    <SectionHeader count={visible.length} title="Upcoming alarms">
      {hasMultipleSources && <div aria-label="Alarm source" className="overview-alarm-source-buttons" role="group">
        {(["all", "stock", "kac"] as const).map((option) => <button
          aria-label={`Show ${option === "all" ? "all" : option.toUpperCase()} alarms`}
          aria-pressed={activeSource === option}
          className="overview-header-button"
          key={option}
          onClick={() => setSource(option)}
          type="button"
        >{option.toUpperCase()}</button>)}
      </div>}
    </SectionHeader>
    {visible.length > 0 && <div className="overview-card-list">{visible.map((row, index) => {
      const alarmType = formatAlarmType(row.type);
      return <article className="overview-list-card overview-alarm-card" key={`${row.source}-${row.time}-${row.title}-${index}`}>
        <div><strong>{row.title}</strong>{row.vessel && <span>{row.vessel}</span>}</div>
        <div className="overview-alarm-badges">{alarmType && <span className="overview-alarm-type">{alarmType}</span>}<span className={`overview-source ${row.source.toLocaleLowerCase()}`}>{row.source}</span></div>
        <div className="overview-alarm-time"><strong>T- {formatMissionDuration(Math.max(0, row.time - (universalTime ?? row.time)), kerbin)}</strong><span>UT {Math.floor(row.time).toLocaleString("en-US")}</span></div>
      </article>;
    })}</div>}
    {rows.length > 0 && visible.length === 0 && <p className="overview-empty">No upcoming alarms from this source.</p>}
  </section>;
}

type ContractParameter = NonNullable<OverviewContractTelemetry["parameters"]>[number];

function contractKey(contract: OverviewContractTelemetry, index: number) {
  const objectId = contract.objectId?.trim();
  return objectId
    ? `object:${objectId}`
    : `legacy:${contract.title}\u0000${contract.type}\u0000${contract.deadline ?? "none"}\u0000${index}`;
}

function formatContractType(type: string) {
  const normalized = type.trim().replace(/[\s_-]+/g, "").toLocaleLowerCase();
  if (normalized === "configuredcontract") return "Mission contract";
  if (normalized === "explorationcontract") return "Exploration";
  if (normalized === "parttest") return "Part test";
  const spaced = type.trim()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/contract$/i, " contract")
    .replace(/test$/i, " test")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return spaced ? `${spaced.charAt(0).toLocaleUpperCase()}${spaced.slice(1)}` : "Contract";
}

function formatContractCountdown(deadline: number | null | undefined, universalTime: number | undefined, kerbin: boolean) {
  if (!isFiniteNumber(deadline) || !isFiniteNumber(universalTime)) return null;
  const remaining = Math.max(0, deadline - universalTime);
  if (remaining === 0) return "DUE";
  const secondsPerDay = kerbin ? 21_600 : 86_400;
  if (remaining >= secondsPerDay) {
    const days = Math.floor(remaining / secondsPerDay);
    const hours = Math.floor((remaining % secondsPerDay) / 3_600);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (remaining < 60) return "<1m";
  const totalMinutes = Math.floor(remaining / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function ContractParameterList({ className, depthOffset = 0, parameters }: { className?: string; depthOffset?: number; parameters: ContractParameter[] }) {
  return <ul className={className}>{parameters.map((parameter, parameterIndex) => <li className={parameter.status} key={`${parameter.title}-${parameterIndex}`} style={{ "--contract-depth": Math.max(0, (parameter.depth ?? 0) - depthOffset) } as CSSProperties}>
    <span aria-label={parameter.status} className="overview-contract-parameter-status" />
    <span><strong>{parameter.title}</strong>{parameter.optional && <small>Optional</small>}{parameter.notes && <small>{parameter.notes}</small>}</span>
  </li>)}</ul>;
}

function ContractFocusDetail({ contract, detailsId, kerbin }: { contract: OverviewContractTelemetry; detailsId: string; kerbin: boolean }) {
  const due = isFiniteNumber(contract.deadline) ? formatUniversalTime(contract.deadline, kerbin) : null;
  const parameters = contract.parameters ?? [];
  const shallowParameters = parameters.filter((parameter) => (parameter.depth ?? 0) <= 1);
  const primaryParameters = shallowParameters.length > 0 ? shallowParameters : parameters;
  const technicalParameters = shallowParameters.length > 0 ? parameters.filter((parameter) => (parameter.depth ?? 0) > 1) : [];
  const hasBriefing = Boolean(contract.synopsis || contract.description || contract.notes || parameters.length > 0);
  return <article aria-labelledby={`${detailsId}-title`} className="overview-contract-focus-reader" id={detailsId}>
    <header className="overview-contract-focus-head">
      <div><span>Contract briefing</span><h3 id={`${detailsId}-title`}>{contract.title}</h3></div>
    </header>
    <div className="overview-contract-focus-scroll">
      {contract.synopsis && <p className="overview-contract-synopsis">{contract.synopsis}</p>}
      <div className="overview-contract-focus-overview">
        <div><span>Category</span><strong>{formatContractType(contract.type)}</strong></div>
        {due && <div><span>Due date</span><strong>{due.big}</strong><small>{due.sub}</small></div>}
        <ContractRewards contract={contract} />
      </div>
      {contract.description && contract.description !== contract.synopsis && <details className="overview-contract-more"><summary>More briefing</summary><p>{contract.description}</p></details>}
      {primaryParameters.length > 0 && <section className="overview-contract-parameters overview-contract-primary-parameters"><h3>Objectives</h3><ContractParameterList parameters={primaryParameters} /></section>}
      {technicalParameters.length > 0 && <details className="overview-contract-technical"><summary>Technical details <span>{technicalParameters.length}</span></summary><div className="overview-contract-parameters overview-contract-technical-parameters"><ContractParameterList depthOffset={2} parameters={technicalParameters} /></div></details>}
      {contract.notes && <details className="overview-contract-more"><summary>Contract notes</summary><p>{contract.notes}</p></details>}
      {!hasBriefing && <p className="overview-contract-unavailable">No additional briefing details are available from KSP.</p>}
    </div>
  </article>;
}

function ContractSection({ rows, universalTime, kerbin, onFocusChange }: { rows: OverviewContractTelemetry[]; universalTime?: number; kerbin: boolean; onFocusChange(focused: boolean): void }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusKey = useRef<string | null>(null);
  const focusedIndex = rows.findIndex((contract, index) => contractKey(contract, index) === expandedKey);
  const focusedContract = focusedIndex >= 0 ? rows[focusedIndex] : undefined;
  const closeFocus = useCallback((restoreFocus = true) => {
    restoreFocusKey.current = restoreFocus ? expandedKey : null;
    setExpandedKey(null);
    onFocusChange(false);
  }, [expandedKey, onFocusChange]);
  useLayoutEffect(() => {
    if (expandedKey || !restoreFocusKey.current) return;
    const key = restoreFocusKey.current;
    restoreFocusKey.current = null;
    const frame = requestAnimationFrame(() => triggerRefs.current.get(key)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [expandedKey]);
  useEffect(() => {
    if (expandedKey && !focusedContract) closeFocus(false);
  }, [closeFocus, expandedKey, focusedContract]);
  useEffect(() => {
    if (!focusedContract) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !sectionRef.current?.contains(target)) closeFocus();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeFocus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeFocus, focusedContract]);
  const contractList = <div className={focusedContract ? "overview-contract-focus-list" : "overview-contract-list"}>{rows.map((contract, index) => {
    const key = contractKey(contract, index);
    const expanded = expandedKey === key;
    const detailsId = `overview-contract-${index}-details`;
    const countdown = formatContractCountdown(contract.deadline, universalTime, kerbin);
    return <article className={`overview-contract-card${expanded ? " expanded" : ""}`} key={key}>
      <button
        aria-controls={expanded ? detailsId : undefined}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} contract ${contract.title}`}
        className="overview-contract-summary"
        onClick={() => {
          if (expanded) closeFocus();
          else { setExpandedKey(key); onFocusChange(true); }
        }}
        ref={(node) => {
          if (node) triggerRefs.current.set(key, node);
          else triggerRefs.current.delete(key);
        }}
        type="button"
      >
        <span aria-hidden="true" className="overview-contract-chevron" />
        <span className="overview-contract-title"><strong>{contract.title}</strong></span>
        {countdown && <span className="overview-contract-time"><strong>T− {countdown}</strong></span>}
      </button>
    </article>;
  })}</div>;
  return <section className={`overview-section overview-contracts${focusedContract ? " focused" : ""}`} ref={sectionRef}>
    <SectionHeader count={rows.length} title="Active contracts">{focusedContract && <button aria-label="Return to contract list" className="overview-header-button" onClick={() => closeFocus()} type="button">BACK</button>}</SectionHeader>
    {rows.length > 0 && (focusedContract
      ? <div className="overview-contract-focus-body">{contractList}<ContractFocusDetail contract={focusedContract} detailsId={`overview-contract-${focusedIndex}-details`} kerbin={kerbin} key={expandedKey} /></div>
      : contractList)}
  </section>;
}

export function MissionOverview({
  commandEnabled = false,
  editResult,
  lifecycleResult,
  onSendCommand = () => false,
  snapshot,
  switchResult,
}: {
  commandEnabled?: boolean;
  editResult?: OverviewVesselEditResult;
  lifecycleResult?: OverviewVesselLifecycleResult;
  onSendCommand?(command: TelemetryCommand): boolean;
  snapshot: TelemetrySnapshot;
  switchResult?: OverviewVesselSwitchResult;
}) {
  const { system, toggleSystem } = useTimeSystem();
  const kerbin = isKerbinTime(system);
  const capabilities = snapshot["overview.capabilities"] ?? { funds: false, science: false, reputation: false, contracts: false };
  const ut = formatUniversalTime(snapshot["t.universalTime"], kerbin);
  const contracts = snapshot["overview.contracts"] ?? [];
  const counts = snapshot["overview.contractCounts"];
  const [contractFocused, setContractFocused] = useState(false);
  useEffect(() => {
    if (!capabilities.contracts) setContractFocused(false);
  }, [capabilities.contracts]);
  const rosterDisplayed = !contractFocused;
  const alarmsDisplayed = !contractFocused;
  return <div className="mission-overview">
    <header className="mission-overview-header">
      <div className="mission-overview-identity"><span>{snapshot["overview.scene"] ?? "SPACE CENTER"} · {snapshot["overview.gameMode"] ?? "UNKNOWN SAVE"}</span><h1>Woobie's Mission Control</h1></div>
      <section className="overview-metrics" aria-label="Program status">
        <div className="overview-metric-time"><span>Game time <button aria-label={`Time system: ${kerbin ? "Kerbin" : "Earth"}`} className="calendar-toggle" onClick={toggleSystem} type="button">[{kerbin ? "KERBIN" : "EARTH"}]</button></span><strong>{ut.big}</strong><small>{ut.sub}</small></div>
        {capabilities.funds && <div className="overview-metric-funds"><span>Funds</span><strong>{formatTelemetryNumber(snapshot["overview.funds"])}</strong><small>AVAILABLE</small></div>}
        {capabilities.science && <div className="overview-metric-science"><span>Science</span><strong>{formatTelemetryNumber(snapshot["overview.science"])}</strong><small>BANKED</small></div>}
        {capabilities.reputation && <div className="overview-metric-reputation"><span>Reputation</span><strong>{formatTelemetryNumber(snapshot["overview.reputation"])}</strong><small>{isFiniteNumber(snapshot["overview.reputation"]) ? "CURRENT" : "UNAVAILABLE"}</small></div>}
        {capabilities.contracts && <div className="overview-metric-contracts"><span>Contracts</span><strong>{counts?.active ?? 0} active</strong><small>{counts?.offered ?? 0} offered / {counts?.completed ?? 0} complete / {counts?.failed ?? 0} failed</small></div>}
      </section>
    </header>
    <div className="overview-command-grid">
      <TransferWindowsPanel commandEnabled={commandEnabled} onSendCommand={onSendCommand} snapshot={snapshot} />
      <div className={[
        "overview-data-grid",
        contractFocused ? "contracts-focused" : "",
        rosterDisplayed ? "" : "without-roster",
        alarmsDisplayed ? "" : "without-alarms",
        capabilities.contracts ? "" : "without-contracts",
        (snapshot["overview.alarms"]?.length ?? 0) > 0 ? "" : "alarms-empty",
        contracts.length > 0 ? "" : "contracts-empty",
      ].filter(Boolean).join(" ")}>
        <FleetSection alarms={snapshot["overview.alarms"] ?? []} bodyCatalog={snapshot["catalog.bodies"] ?? []} commandEnabled={commandEnabled} editResult={editResult} kerbin={kerbin} lifecycleResult={lifecycleResult} onSendCommand={onSendCommand} roster={snapshot["overview.roster"] ?? []} rows={snapshot["overview.vessels"] ?? []} switchResult={switchResult} terminationAvailable={snapshot["overview.vesselTerminationAvailable"] === true} universalTime={snapshot["t.universalTime"]} />
        {rosterDisplayed && <RosterSection available={snapshot["overview.rosterAvailable"] === true} rows={snapshot["overview.roster"] ?? []} />}
        {alarmsDisplayed && <AlarmSection kerbin={kerbin} rows={snapshot["overview.alarms"] ?? []} universalTime={snapshot["t.universalTime"]} />}
        {capabilities.contracts && <ContractSection kerbin={kerbin} onFocusChange={setContractFocused} rows={contracts} universalTime={snapshot["t.universalTime"]} />}
      </div>
    </div>
    {snapshot["overview.vesselsTruncated"] && <p className="overview-truncated">Fleet list limited to the first 500 tracked objects.</p>}
  </div>;
}
