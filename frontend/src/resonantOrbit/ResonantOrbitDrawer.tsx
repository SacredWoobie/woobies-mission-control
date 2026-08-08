import { useEffect, useMemo, useRef, useState } from "react";
import type { CelestialBodyTelemetry, SceneMode, TelemetrySnapshot } from "../telemetry/types";
import { useLiveTelemetrySelector } from "../telemetry/useLiveTelemetry";
import {
  DISTANCE_UNITS,
  STOCK_BODIES,
  calculateResonantOrbit,
  distanceFromUnit,
  distanceToUnit,
  formatDistance,
  formatDuration,
  type BodyDefinition,
  type ResonanceMode,
  type ResonantOrbitPlan,
} from "./calculations";
import { useDialogFocus } from "../deltaV/useDialogFocus";
import { useResonantOrbitState } from "./state";

function bodyCatalogEqual(left: CelestialBodyTelemetry[], right: CelestialBodyTelemetry[]) {
  if (left.length !== right.length) return false;
  return left.every((body, index) => {
    const other = right[index];
    return body.name === other?.name
      && body.gravitationalParameter === other.gravitationalParameter
      && body.radius === other.radius
      && body.rotationPeriod === other.rotationPeriod
      && body.atmosphereDepth === other.atmosphereDepth
      && body.sphereOfInfluence === other.sphereOfInfluence;
  });
}

function suggestedPlanName(plan: ResonantOrbitPlan | null) {
  if (!plan) return "";
  const ratio = plan.mode === "raise"
    ? `${plan.satelliteCount + 1}:${plan.satelliteCount}`
    : `${plan.satelliteCount - 1}:${plan.satelliteCount}`;
  return `${plan.body.name} ${ratio} ${plan.mode} orbit`;
}

function OrbitPlot({ plan }: { plan: ResonantOrbitPlan }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    function draw(targetCanvas: HTMLCanvasElement) {
      const bounds = targetCanvas.getBoundingClientRect();
      const width = Math.max(320, bounds.width);
      const height = Math.max(180, bounds.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      targetCanvas.width = Math.round(width * dpr);
      targetCanvas.height = Math.round(height * dpr);
      const context = targetCanvas.getContext("2d");
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = plan.body.radius;
      const targetRadius = radius + plan.targetAltitude;
      const apoRadius = radius + plan.carrierApoapsis;
      const periRadius = radius + plan.carrierPeriapsis;
      const losRadius = plan.minimumLosAltitude > 0 ? radius + plan.minimumLosAltitude : 0;
      const maximumRadius = Math.max(targetRadius, apoRadius, periRadius, losRadius);
      const scale = Math.min((width * .39) / maximumRadius, (height * .41) / maximumRadius);
      const bodyPixels = Math.max(18, radius * scale);

      context.save();
      context.strokeStyle = "rgba(78,201,224,.08)";
      for (let ring = 1; ring <= 3; ring += 1) {
        context.beginPath();
        context.arc(centerX, centerY, maximumRadius * scale * ring / 3, 0, Math.PI * 2);
        context.stroke();
      }
      context.restore();

      if (losRadius > 0) {
        context.save();
        context.strokeStyle = plan.targetAltitude < plan.minimumLosAltitude ? "rgba(255,180,84,.95)" : "rgba(126,231,135,.72)";
        context.setLineDash([2, 5]);
        context.beginPath();
        context.arc(centerX, centerY, losRadius * scale, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }

      context.save();
      context.strokeStyle = "#4ec9e0";
      context.shadowColor = "rgba(78,201,224,.5)";
      context.shadowBlur = 6;
      context.beginPath();
      context.arc(centerX, centerY, targetRadius * scale, 0, Math.PI * 2);
      context.stroke();
      context.restore();

      const semiMajor = ((apoRadius + periRadius) / 2) * scale;
      const eccentricity = Math.abs(apoRadius - periRadius) / (apoRadius + periRadius);
      const semiMinor = semiMajor * Math.sqrt(Math.max(0, 1 - eccentricity ** 2));
      const focus = semiMajor * eccentricity;
      context.save();
      context.strokeStyle = "#ffb454";
      context.setLineDash([7, 5]);
      context.beginPath();
      context.ellipse(centerX - focus, centerY, semiMajor, semiMinor, 0, 0, Math.PI * 2);
      context.stroke();
      context.restore();

      const gradient = context.createRadialGradient(centerX - bodyPixels * .3, centerY - bodyPixels * .3, 2, centerX, centerY, bodyPixels);
      gradient.addColorStop(0, "#426a78");
      gradient.addColorStop(.58, "#18313b");
      gradient.addColorStop(1, "#071018");
      context.fillStyle = gradient;
      context.strokeStyle = "#2a3a4e";
      context.beginPath();
      context.arc(centerX, centerY, bodyPixels, 0, Math.PI * 2);
      context.fill();
      context.stroke();

      const start = plan.releaseAt === "periapsis" ? 0 : Math.PI;
      for (let index = 0; index < plan.satelliteCount; index += 1) {
        const angle = start + index * Math.PI * 2 / plan.satelliteCount;
        context.fillStyle = index === 0 ? "#7ee787" : "#4ec9e0";
        context.shadowColor = context.fillStyle;
        context.shadowBlur = index === 0 ? 9 : 4;
        context.beginPath();
        context.arc(centerX + Math.cos(angle) * targetRadius * scale, centerY + Math.sin(angle) * targetRadius * scale, index === 0 ? 4 : 2.7, 0, Math.PI * 2);
        context.fill();
      }
      context.shadowBlur = 0;
      context.fillStyle = "#7d8ba0";
      context.font = '10px ui-monospace, "Cascadia Code", monospace';
      context.textAlign = "center";
      context.fillText(plan.body.name.toUpperCase(), centerX, centerY + 4);
    }
    draw(canvasElement);
    const observer = new ResizeObserver(() => draw(canvasElement));
    observer.observe(canvasElement);
    return () => observer.disconnect();
  }, [plan]);
  return <canvas ref={canvasRef} />;
}

export function ResonantOrbitDrawer({ mode, snapshot }: { mode: SceneMode; snapshot?: TelemetrySnapshot }) {
  const {
    activeSavedPlanId,
    closeDrawer,
    deletePlan,
    drawerOpen,
    linkPlansToSave,
    loadPlan,
    pinPlan,
    pinned,
    savedPlans,
    savePlan,
    setUnit,
    unit,
  } = useResonantOrbitState();
  const liveBodies = useLiveTelemetrySelector(
    (state): CelestialBodyTelemetry[] => state.snapshot?.["catalog.bodies"] ?? [],
    bodyCatalogEqual,
  );
  const liveContextBodyName = useLiveTelemetrySelector((state) => {
    const snapshot = state.snapshot;
    return String(snapshot?.["v.body"] ?? snapshot?.["editor.body"] ?? "");
  });
  const liveSaveFolder = useLiveTelemetrySelector((state) => {
    const value = state.snapshot?.["game.saveFolder"];
    return typeof value === "string" ? value.trim() : "";
  });
  const availableTelemetryBodies = snapshot?.["catalog.bodies"] ?? liveBodies;
  const contextBodyName = snapshot
    ? String(snapshot["v.body"] ?? snapshot["editor.body"] ?? "")
    : liveContextBodyName;
  const snapshotSaveFolder = snapshot?.["game.saveFolder"];
  const currentSaveFolder = snapshot
    ? typeof snapshotSaveFolder === "string" ? snapshotSaveFolder.trim() : ""
    : liveSaveFolder;
  const availableBodies = useMemo(() => {
    const merged = new Map<string, BodyDefinition>();
    Object.values(STOCK_BODIES).forEach((definition) => merged.set(definition.name, definition));
    availableTelemetryBodies.forEach((definition) => merged.set(definition.name, { ...definition }));
    return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [availableTelemetryBodies]);
  const [bodyChoice, setBodyChoice] = useState("Minmus");
  const [body, setBody] = useState<BodyDefinition>({ ...STOCK_BODIES.Minmus });
  const [customBody, setCustomBody] = useState<BodyDefinition>({ ...STOCK_BODIES.Kerbin, name: "Custom body" });
  const [satelliteCount, setSatelliteCount] = useState(3);
  const [targetAltitude, setTargetAltitude] = useState(100_000);
  const [resonanceMode, setResonanceMode] = useState<ResonanceMode>("auto");
  const [useOcclusion, setUseOcclusion] = useState(true);
  const [planName, setPlanName] = useState("");
  const [savedNotice, setSavedNotice] = useState("");
  const [saveError, setSaveError] = useState(false);
  const [savedPlansOpen, setSavedPlansOpen] = useState(false);
  const [loadFromAllSaves, setLoadFromAllSaves] = useState(false);
  const appliedContextBody = useRef("");
  const currentSavePlans = useMemo(
    () => savedPlans.filter((record) => record.saveFolder === currentSaveFolder),
    [currentSaveFolder, savedPlans],
  );
  const unlinkedSavedPlans = useMemo(
    () => savedPlans.filter((record) => !record.saveFolder),
    [savedPlans],
  );
  const visibleSavedPlans = useMemo(() => {
    const visible = loadFromAllSaves ? savedPlans : currentSavePlans;
    return [...visible].sort((left, right) => loadFromAllSaves
      ? left.saveFolder.localeCompare(right.saveFolder)
        || Date.parse(right.updatedAt || "1970-01-01") - Date.parse(left.updatedAt || "1970-01-01")
        || left.name.localeCompare(right.name)
      : Date.parse(right.updatedAt || "1970-01-01") - Date.parse(left.updatedAt || "1970-01-01")
        || left.name.localeCompare(right.name));
  }, [currentSavePlans, loadFromAllSaves, savedPlans]);
  const activeSavedPlan = useMemo(
    () => savedPlans.find((record) => record.id === activeSavedPlanId) ?? null,
    [activeSavedPlanId, savedPlans],
  );
  const savedPlanGroups = useMemo(() => {
    const groups = new Map<string, typeof savedPlans>();
    visibleSavedPlans.forEach((record) => {
      const group = groups.get(record.saveFolder) ?? [];
      group.push(record);
      groups.set(record.saveFolder, group);
    });
    return [...groups.entries()];
  }, [visibleSavedPlans]);
  const savedPlansDialogRef = useDialogFocus<HTMLElement>(savedPlansOpen, () => setSavedPlansOpen(false));
  const drawerDialogRef = useDialogFocus<HTMLElement>(drawerOpen, closeDrawer);

  const calculation = useMemo(() => {
    try {
      return { error: "", plan: calculateResonantOrbit({ body, satelliteCount, targetAltitude, mode: resonanceMode, useOcclusionModifiers: useOcclusion }) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Unable to calculate this orbit.", plan: null };
    }
  }, [body, resonanceMode, satelliteCount, targetAltitude, useOcclusion]);

  useEffect(() => {
    if (savedPlansOpen) return;
    setLoadFromAllSaves(false);
  }, [savedPlansOpen]);

  useEffect(() => {
    if (!savedNotice) return;
    const noticeTimeout = window.setTimeout(() => setSavedNotice(""), 7_000);
    return () => window.clearTimeout(noticeTimeout);
  }, [savedNotice]);

  useEffect(() => {
    if (!drawerOpen || !contextBodyName || appliedContextBody.current === contextBodyName) return;
    const matchingBody = availableBodies.find((candidate) => candidate.name === contextBodyName);
    if (!matchingBody) return;
    appliedContextBody.current = contextBodyName;
    setBodyChoice(matchingBody.name);
    setBody({ ...matchingBody });
  }, [availableBodies, contextBodyName, drawerOpen]);

  useEffect(() => {
    if (!drawerOpen || !activeSavedPlan) return;
    const saved = activeSavedPlan.plan;
    const knownBody = availableBodies.find((candidate) => candidate.name === saved.body.name);
    setBodyChoice(knownBody ? knownBody.name : "custom");
    setBody({ ...saved.body });
    setCustomBody({ ...saved.body });
    setSatelliteCount(saved.satelliteCount);
    setTargetAltitude(saved.targetAltitude);
    setResonanceMode(saved.requestedMode);
    setUseOcclusion(activeSavedPlan.useOcclusionModifiers);
    setPlanName(activeSavedPlan.name);
    setSaveError(false);
    setSavedNotice("");
  }, [activeSavedPlan, availableBodies, drawerOpen]);

  if (!drawerOpen) return null;
  const plan = calculation.plan;

  function selectBody(value: string) {
    setBodyChoice(value);
    const selected = availableBodies.find((candidate) => candidate.name === value);
    setBody(value === "custom" ? { ...customBody } : { ...(selected ?? STOCK_BODIES.Kerbin) });
  }

  function updateBody(field: keyof BodyDefinition, value: string) {
    const next = { ...body, [field]: field === "name" ? value : Number(value) } as BodyDefinition;
    setBody(next);
    setCustomBody(next);
    setBodyChoice("custom");
  }

  function loadSavedPlan(id: string) {
    const record = loadPlan(id);
    if (!record) return;
    const saved = record.plan;
    const knownBody = availableBodies.find((candidate) => candidate.name === saved.body.name);
    setBodyChoice(knownBody ? knownBody.name : "custom");
    setBody({ ...saved.body });
    setCustomBody({ ...saved.body });
    setSatelliteCount(saved.satelliteCount);
    setTargetAltitude(saved.targetAltitude);
    setResonanceMode(saved.requestedMode);
    setUseOcclusion(record.useOcclusionModifiers);
    setPlanName(record.name);
    setSaveError(false);
    setSavedNotice(`Loaded ${record.name}`);
  }

  function saveCurrentPlan(asNew = false) {
    if (!plan) return;
    const name = planName.trim() || suggestedPlanName(plan);
    const result = savePlan(plan, name, {
      asNew,
      saveFolder: currentSaveFolder,
      useOcclusionModifiers: useOcclusion,
    });
    if (result.status === "duplicate") {
      setSaveError(true);
      setSavedNotice(`A saved plan named ${result.name} already exists. Update it or choose another name.`);
      return;
    }
    setPlanName(result.name);
    setSaveError(false);
    setSavedNotice(result.status === "updated" ? `Updated ${result.name}` : `Saved ${result.name}`);
  }

  const ratioText = plan ? `${plan.mode === "raise" ? plan.satelliteCount + 1 : plan.satelliteCount - 1}:${plan.satelliteCount}` : "—";
  const losConflict = !!plan && plan.minimumLosAltitude > 0 && plan.targetAltitude < plan.minimumLosAltitude;

  function renderSavedPlan(record: (typeof savedPlans)[number]) {
    const recordRatio = record.plan.mode === "raise"
      ? `${record.plan.satelliteCount + 1}:${record.plan.satelliteCount}`
      : `${record.plan.satelliteCount - 1}:${record.plan.satelliteCount}`;
    const isPinned = pinned?.id === record.id && record.saveFolder === currentSaveFolder;
    const isLoaded = activeSavedPlanId === record.id;
    const canPin = !!currentSaveFolder && (!record.saveFolder || record.saveFolder === currentSaveFolder);
    return <article className={[isPinned ? "pinned" : "", isLoaded ? "loaded" : ""].filter(Boolean).join(" ")} key={record.id}>
      <div><strong>{record.name}</strong><span>{record.plan.body.name} · {recordRatio} {record.plan.mode} · {formatDistance(record.plan.targetAltitude, unit)} final</span></div>
      <div className="resonant-library-actions">
        <button onClick={() => { loadSavedPlan(record.id); setSavedPlansOpen(false); }} type="button">Load</button>
        {mode !== "inactive" && <button className={isPinned ? "active" : ""} disabled={isPinned || !canPin} onClick={() => pinPlan(record.id, currentSaveFolder)} title={!canPin ? `Switch to ${record.saveFolder || "the plan's save"} to pin this plan.` : undefined} type="button">{isPinned ? "Pinned" : !canPin ? "Other save" : mode === "editor" ? "Pin in Editor" : "Pin to Flight"}</button>}
        <button aria-label={`Delete ${record.name}`} className="delete" onClick={() => deletePlan(record.id)} type="button">Delete</button>
      </div>
    </article>;
  }

  return (
    <>
      <div aria-hidden="true" className="resonant-drawer-backdrop" onMouseDown={closeDrawer} />
      <aside aria-label="Resonant orbit planner" aria-modal="true" className="resonant-drawer resonant-orbit-drawer" id="resonant-orbit-drawer" ref={drawerDialogRef} role="dialog" tabIndex={-1}>
        <header className="resonant-orbit-header">
          <div className="resonant-orbit-title"><span>MISSION PLANNING · RESONANT ORBIT</span><h2>Resonant Orbit Plan</h2><p>{mode === "flight" ? "Adjust or reference a constellation plan during Flight." : mode === "editor" ? "Build a constellation plan beside the VAB/SPH craft summary." : "Build or review constellation plans from Mission Control."}</p></div>
          <div className="resonant-orbit-header-controls">
            <div className="resonant-orbit-header-actions">
              <button className="resonant-saved-plans-button" onClick={() => setSavedPlansOpen(true)} type="button"><span>LOAD SAVED PLANS</span><strong>{currentSavePlans.length}</strong></button>
              <button aria-label="Close resonant orbit planner" className="resonant-close-button" onClick={closeDrawer} type="button">×</button>
            </div>
            <div className="resonant-header-save-bar">
              <label><span>PLAN NAME:</span><input aria-label="Plan name" placeholder={suggestedPlanName(plan)} value={planName} onChange={(event) => { setPlanName(event.target.value); setSaveError(false); setSavedNotice(""); }} /></label>
              <div className="resonant-orbit-header-actions">
                <button disabled={!plan} onClick={() => saveCurrentPlan(false)} type="button">{activeSavedPlanId ? "UPDATE PLAN" : "SAVE PLAN"}</button>
                {activeSavedPlanId && <button disabled={!plan} onClick={() => saveCurrentPlan(true)} type="button">SAVE AS NEW</button>}
              </div>
              {savedNotice && <small role={saveError ? "alert" : "status"}>{savedNotice}</small>}
            </div>
          </div>
        </header>
        <div className="resonant-drawer-body">
          <section className="resonant-controls">
            <label className="resonant-control-body"><span>Central body</span><select value={bodyChoice} onChange={(event) => selectBody(event.target.value)}>{availableBodies.map((definition) => <option key={definition.name} value={definition.name}>{definition.name}</option>)}<option value="custom">Custom body</option></select><small className={liveBodies.length ? "resonant-catalog-live" : ""}>{liveBodies.length ? `LIVE KSP CATALOG · ${liveBodies.length} BODIES` : "STOCK CATALOG · WAITING FOR KSP"}</small></label>
            <label className="resonant-control-satellites"><span>Satellites</span><input min="2" max="99" step="1" type="number" value={satelliteCount} onChange={(event) => setSatelliteCount(Number(event.target.value))} /></label>
            <label className="resonant-control-altitude"><span>Final circular altitude</span><div className="resonant-input-unit"><input min={1 / DISTANCE_UNITS[unit].factor} step={1 / DISTANCE_UNITS[unit].factor} type="number" value={Number(distanceToUnit(targetAltitude, unit).toFixed(DISTANCE_UNITS[unit].inputDecimals))} onChange={(event) => setTargetAltitude(distanceFromUnit(Number(event.target.value), unit))} /><span>{unit}</span></div></label>
            <fieldset className="resonant-carrier-control"><legend>Carrier orbit</legend><div className="resonant-segments">{(["auto", "raise", "dive"] as ResonanceMode[]).map((value) => <label key={value}><input checked={resonanceMode === value} name="resonanceMode" type="radio" value={value} onChange={() => setResonanceMode(value)} /><span>{value}</span></label>)}</div></fieldset>
            <fieldset className="resonant-unit-control"><legend>Altitude input units</legend><div className="resonant-segments">{(Object.keys(DISTANCE_UNITS) as (keyof typeof DISTANCE_UNITS)[]).map((value) => <label key={value}><input checked={unit === value} name="distanceUnit" type="radio" value={value} onChange={() => setUnit(value)} /><span>{value}</span></label>)}</div></fieldset>
          </section>

          <details className="resonant-advanced">
            <summary>Body data &amp; signal assumptions</summary>
            <div>{(["name", "gravitationalParameter", "radius", "rotationPeriod", "atmosphereDepth", "sphereOfInfluence"] as (keyof BodyDefinition)[]).map((field) => <label key={field}><span>{field.replace(/([A-Z])/g, " $1")}</span><input type={field === "name" ? "text" : "number"} value={body[field]} onChange={(event) => updateBody(field, event.target.value)} /></label>)}<label className="resonant-check"><input checked={useOcclusion} type="checkbox" onChange={(event) => setUseOcclusion(event.target.checked)} /><span>CommNet occlusion modifiers</span></label></div>
          </details>

          {calculation.error && <div className="resonant-error" role="alert">{calculation.error}</div>}
          {plan && <>
            <section className="resonant-plot">
              <div className="resonant-plot-visual">
                <OrbitPlot plan={plan} />
                <div className="resonant-plot-legend"><span className="final">Final orbit</span><span className="carrier">Carrier orbit</span><span className="los">Minimum LOS</span></div>
              </div>
              <div className="resonant-plot-hud"><strong>{ratioText} {plan.mode.toUpperCase()} ORBIT</strong><div className={losConflict ? "warning" : ""}><span>MINIMUM LOS ALTITUDE</span><b>{plan.minimumLosAltitude > 0 ? formatDistance(plan.minimumLosAltitude, unit) : "SURFACE CLEAR"}</b><small>{losConflict ? "TARGET BELOW LOS REFERENCE" : "CONTINUOUS COVERAGE REFERENCE"}</small></div></div>
            </section>

            <section className="resonant-results">
              <div className="resonant-result-head"><div><span>CALCULATED PROFILE</span><h3>Carrier insertion</h3></div><strong className={plan.warnings.some((warning) => warning.level === "danger") ? "danger" : losConflict ? "warning" : "nominal"}>{plan.warnings.some((warning) => warning.level === "danger") ? "PLAN CONFLICT" : losConflict ? "REVIEW PLAN" : "NOMINAL"}</strong></div>
              <div className="resonant-result-grid">
                <article><span>Carrier apoapsis</span><strong>{formatDistance(plan.carrierApoapsis, unit)}</strong><small>{plan.releaseAt === "apoapsis" ? "Release point" : "High point"}</small></article>
                <article><span>Carrier periapsis</span><strong>{formatDistance(plan.carrierPeriapsis, unit)}</strong><small>{plan.releaseAt === "periapsis" ? "Release point" : "Low point"}</small></article>
                <article className="delta"><span>Injection Δv</span><strong>{plan.injectionDeltaV.toFixed(2)} m/s</strong><small>Circularization burn</small></article>
                <article className="duration"><span>Final period</span><strong>{formatDuration(plan.finalPeriod)}</strong><small>Deployed satellites</small></article>
                <article className="duration"><span>Carrier period</span><strong>{formatDuration(plan.carrierPeriod)}</strong><small>{ratioText} resonance</small></article>
                <article><span>Minimum LOS altitude</span><strong>{plan.minimumLosAltitude > 0 ? formatDistance(plan.minimumLosAltitude, unit) : "Surface clear"}</strong><small>{losConflict ? "Below LOS estimate" : "Target clears estimate"}</small></article>
              </div>
              {plan.warnings.length > 0 && <div className="resonant-warnings">{plan.warnings.map((warning) => <div className={warning.level} key={warning.code}>{warning.message}</div>)}</div>}
            </section>
          </>}
        </div>

        <footer className="resonant-attribution">
          <span>Calculation lineage:</span>
          <a href="https://meyerweb.com/eric/ksp/resonant-orbits/" rel="noreferrer" target="_blank">Eric Meyer’s original calculator</a>
          <span aria-hidden="true">·</span>
          <a href="https://github.com/linuxgurugamer/ResonantOrbitCalculator" rel="noreferrer" target="_blank">ResonantOrbitCalculator</a>
        </footer>

        {savedPlansOpen && <div className="delta-v-modal-backdrop" onMouseDown={() => setSavedPlansOpen(false)}>
          <section aria-labelledby="resonant-saved-plans-title" aria-modal="true" className="delta-v-modal delta-v-plan-library-modal resonant-plan-library-modal" onMouseDown={(event) => event.stopPropagation()} ref={savedPlansDialogRef} role="dialog" tabIndex={-1}>
            <header><div><span>PLAN LIBRARY</span><h3 id="resonant-saved-plans-title">Saved Resonant Orbit plans</h3></div><div className="delta-v-plan-library-header-actions"><button aria-label="Close saved plans" onClick={() => setSavedPlansOpen(false)} type="button">×</button><label><input checked={loadFromAllSaves} type="checkbox" onChange={(event) => setLoadFromAllSaves(event.target.checked)} /><span>LOAD FROM ALL SAVES</span></label></div></header>
            <p>{mode === "flight" ? "Load a constellation or pin it to Flight for reference." : mode === "editor" ? "Load a constellation or pin it beside the Editor craft summary." : "Saved constellations remain in this dashboard browser until deleted."}</p>
            {visibleSavedPlans.length === 0
              ? <div className="delta-v-plan-library-empty">
                <span>{loadFromAllSaves ? "No saved Resonant Orbit plans yet." : `No saved Resonant Orbit plans for ${currentSaveFolder || "the active save"}.`}</span>
                {!loadFromAllSaves && currentSaveFolder && unlinkedSavedPlans.length > 0 && <button onClick={() => linkPlansToSave(unlinkedSavedPlans.map((record) => record.id), currentSaveFolder)} type="button">LINK {unlinkedSavedPlans.length} UNLINKED PLAN{unlinkedSavedPlans.length === 1 ? "" : "S"} TO {currentSaveFolder}</button>}
              </div>
              : loadFromAllSaves
                ? <div className="resonant-library-list grouped">{savedPlanGroups.map(([saveFolder, records]) => <section className="delta-v-plan-library-group" key={saveFolder || "unlinked"}>
                  <div className="delta-v-plan-library-group-heading"><h4>{saveFolder || "UNLINKED"}</h4>{!saveFolder && currentSaveFolder && <button onClick={() => linkPlansToSave(records.map((record) => record.id), currentSaveFolder)} type="button">LINK ALL TO {currentSaveFolder}</button>}</div>
                  {records.map(renderSavedPlan)}
                </section>)}</div>
                : <div className="resonant-library-list">{visibleSavedPlans.map(renderSavedPlan)}</div>}
          </section>
        </div>}
      </aside>
    </>
  );
}
