import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  formatDistance,
  formatEccentricity,
  formatAttitudeDegrees,
  formatHeadingDegrees,
  formatInclination,
  formatOrbitApoapsisCountdown,
  formatOrbitPeriapsisCountdown,
  formatOrbitPeriod,
  formatPercent,
  formatSpeed,
  formatTelemetryNumber,
  isFiniteNumber,
} from "../formatting/numbers";
import type { TelemetrySnapshot } from "../telemetry/types";
import { isKerbinTime, useTimeSystem } from "../timeSystem";
import { buildNavballGeometry } from "./navballGeometry";
import { Panel } from "./Panel";

function normalHeading(value: number | undefined) {
  return isFiniteNumber(value) ? ((value % 360) + 360) % 360 : undefined;
}

function HeadingTape({ heading }: { heading?: number }) {
  const width = 196;
  const center = width / 2;
  const normalized = normalHeading(heading);
  if (normalized === undefined) return <svg aria-label="Heading tape awaiting telemetry" viewBox={`0 0 ${width} 20`} />;
  const marks = [];
  for (let delta = -40; delta <= 40; delta += 10) {
    const mark = Math.round((normalized + delta) / 10) * 10;
    const x = center + (mark - normalized) * 2.4;
    if (x < 0 || x > width) continue;
    const label = ((mark % 360) + 360) % 360;
    const cardinal = ({ 0: "N", 90: "E", 180: "S", 270: "W" } as Record<number, string>)[label];
    marks.push(<g key={`${mark}-${x}`}><line x1={x} x2={x} y1="12" y2="20" /><text className={cardinal ? "cardinal" : ""} x={x} y="9">{cardinal ?? label}</text></g>);
  }
  return <svg aria-label={`Heading ${Math.round(normalized)} degrees`} viewBox={`0 0 ${width} 20`}><rect width={width} height="20" />{marks}<path className="tape-pointer" d={`M${center} 20 l-4 -5 h8 z`} /></svg>;
}

function Navball({ heading, pitch, roll }: { heading?: number; pitch?: number; roll?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const geometry = useMemo(
    () => buildNavballGeometry({ heading, pitch, roll }),
    [heading, pitch, roll],
  );
  if (!isFiniteNumber(pitch) || !isFiniteNumber(roll)) {
    return <svg aria-label="Attitude indicator awaiting telemetry" className="navball" viewBox="0 0 168 168"><circle className="nav-empty" cx="84" cy="84" r="78" /><path className="aircraft" d="M52 84 h18 v6 M98 84 h18 v6" /><circle className="aircraft-dot" cx="84" cy="84" r="2.5" /></svg>;
  }
  const skyGradientId = `navball-sky-${id}`;
  const clipId = `navball-clip-${id}`;
  return (
    <svg aria-label={`Navball at heading ${Math.round(geometry.heading)}, pitch ${Math.round(geometry.pitch)}, roll ${Math.round(geometry.roll)}`} className="navball" role="img" viewBox="0 0 168 168">
      <defs>
        <linearGradient id={skyGradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#63a9dd" />
          <stop offset=".72" stopColor="#3577b0" />
          <stop offset="1" stopColor="#28618f" />
        </linearGradient>
        <clipPath id={clipId}><circle cx="84" cy="84" r="78" /></clipPath>
      </defs>
      <circle className="nav-sphere-bezel" cx="84" cy="84" r="82" />
      <circle className="nav-sphere-ground" cx="84" cy="84" r="78" />
      <g className="nav-sphere-world" clipPath={`url(#${clipId})`}>
        {geometry.skyPath && <path className="nav-sphere-sky" d={geometry.skyPath} fill={`url(#${skyGradientId})`} />}
        <g className="nav-spherical-grid">
          {geometry.grid.map((line, index) => <path d={line.path} key={index} opacity={line.opacity} />)}
        </g>
        {geometry.horizonPath && <path className="nav-spherical-horizon" d={geometry.horizonPath} />}
        <g className="nav-cardinals">
          {geometry.cardinals.map((cardinal) => <text key={cardinal.label} x={cardinal.x.toFixed(1)} y={cardinal.y.toFixed(1)}>{cardinal.label}</text>)}
        </g>
      </g>
      <circle className="nav-sphere-rim" cx="84" cy="84" r="78" />
      <g className="aircraft">
        <line x1="52" x2="70" y1="84" y2="84" />
        <line x1="98" x2="116" y1="84" y2="84" />
        <line x1="70" x2="70" y1="84" y2="90" />
        <line x1="116" x2="116" y1="84" y2="90" />
      </g>
      <circle className="aircraft-dot" cx="84" cy="84" r="2.5" />
    </svg>
  );
}

function Stat({ label, subtitle, title, value }: { label: string; subtitle?: string; title?: string; value: string }) {
  return <div className="stat"><span className="label">{label}</span><span className="v" title={title}>{value}</span>{subtitle && <span className="stat-subtitle">{subtitle}</span>}</div>;
}

function FlightMetric({
  className = "",
  label,
  subtitle,
  title,
  value,
}: {
  className?: string;
  label: string;
  subtitle?: string;
  title?: string;
  value: string;
}) {
  return (
    <div className={`asc-flight-metric ${className}`.trim()}>
      <span className="label">{label}</span>
      <span className="asc-flight-value" title={title}>{value}</span>
      {subtitle && <span className="asc-flight-subtitle" title={subtitle}>{subtitle}</span>}
    </div>
  );
}

interface SasDisplay {
  mode: string;
  source: "mj" | "stock" | "off";
}

function sasModeLabel(value: string | undefined) {
  return value?.split(".").pop()?.replaceAll("_", " ").toUpperCase() ?? "OFF";
}

export function resolveSasDisplay(snapshot: TelemetrySnapshot): SasDisplay {
  const mjMode = sasModeLabel(snapshot["mj.sasMode"]);
  const mjActive = snapshot["mj.sasActive"] ?? (mjMode !== "OFF");
  if (mjActive) return { mode: mjMode, source: "mj" };
  if (snapshot["krpc.sas"] === true) {
    return { mode: sasModeLabel(snapshot["krpc.sasMode"]), source: "stock" };
  }
  return { mode: "OFF", source: "off" };
}

function useStableSasDisplay(snapshot: TelemetrySnapshot) {
  const raw = resolveSasDisplay(snapshot);
  const [display, setDisplay] = useState(raw);
  const displayRef = useRef(display);
  useEffect(() => { displayRef.current = display; }, [display]);
  useEffect(() => {
    if (raw.source === "mj" || displayRef.current.source !== "mj") {
      setDisplay(raw);
      return;
    }
    const timer = window.setTimeout(() => setDisplay(raw), 750);
    return () => window.clearTimeout(timer);
  }, [raw.mode, raw.source]);
  return display;
}

function verticalMotion(value: number | undefined) {
  if (!isFiniteNumber(value)) return "vertical trend unavailable";
  if (value > .05) return "climbing";
  if (value < -.05) return "descending";
  return "level";
}

function trajectoryDisplay(snapshot: TelemetrySnapshot) {
  const eccentricity = snapshot["o.eccentricity"];
  const situation = typeof snapshot["v.situationString"] === "string"
    ? snapshot["v.situationString"].trim().toUpperCase()
    : "";
  const body = typeof snapshot["v.body"] === "string"
    ? snapshot["v.body"].trim().toUpperCase()
    : "";
  const kind = isFiniteNumber(eccentricity) && eccentricity >= 1
    ? "HYPERBOLIC"
    : situation.includes("SUB ORBITAL")
      ? "SUBORBITAL"
      : isFiniteNumber(eccentricity)
        ? "ELLIPTIC"
        : "TRAJECTORY";
  const context = [situation, body].filter(Boolean).join(" ");
  return { kind, label: context ? `${kind} \u00b7 ${context}` : kind };
}

export function AscensionPanel({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const { system } = useTimeSystem();
  const kerbinTime = isKerbinTime(system);
  const throttle = isFiniteNumber(snapshot["krpc.throttle"]) ? Math.round(snapshot["krpc.throttle"] * 100) : 0;
  const heading = snapshot["n.heading"];
  const pitch = snapshot["n.pitch"];
  const roll = snapshot["n.roll"];
  const sas = useStableSasDisplay(snapshot);
  const targetName = snapshot["tar.name"]?.trim();
  const trajectory = trajectoryDisplay(snapshot);
  const hyperbolic = isFiniteNumber(snapshot["o.eccentricity"])
    && snapshot["o.eccentricity"] >= 1;
  const periapsisSubtitle = hyperbolic && isFiniteNumber(snapshot["v.verticalSpeed"])
    ? Math.abs(snapshot["v.verticalSpeed"]) <= .05
      ? "at periapsis"
      : snapshot["v.verticalSpeed"] > 0
        ? "passed"
        : "approaching"
    : undefined;
  const sasHint = sas.source === "mj"
    ? "autopilot holding"
    : sas.source === "stock"
      ? "SAS holding"
      : "SAS disengaged";
  const exactAltitude = isFiniteNumber(snapshot["v.altitude"])
    ? `Exact: ${formatTelemetryNumber(snapshot["v.altitude"])} m` : undefined;
  const altitudeContext = [
    snapshot["v.body"] ? `above ${snapshot["v.body"]}` : undefined,
    verticalMotion(snapshot["v.verticalSpeed"]),
  ].filter(Boolean).join(" \u00b7 ");

  return (
    <Panel
      compact
      id="asc"
      tag={<span className={`asc-trajectory ${trajectory.kind.toLowerCase()}`}><span aria-hidden="true" className="asc-trajectory-dot" />{trajectory.label}</span>}
      title="Ascension"
    >
      <div className="asc-cockpit">
        <div className="asc-instrument-column">
          <div className="heading-tape"><HeadingTape heading={heading} /></div>
          <div className="navball-stage"><Navball heading={heading} pitch={pitch} roll={roll} /></div>
          <div aria-label="Attitude readout" className="attitude-strip">
            <div><span className="label">HDG</span><span>{formatHeadingDegrees(heading)}&deg;</span></div>
            <div><span className="label">PIT</span><span>{formatAttitudeDegrees(pitch, true)}&deg;</span></div>
            <div><span className="label">ROL</span><span>{formatAttitudeDegrees(roll)}&deg;</span></div>
          </div>
        </div>
        <div className="throttle-col"><span className="label">THR</span><div aria-label="Throttle" aria-valuemax={100} aria-valuemin={0} aria-valuenow={throttle} className="thr-track" role="meter"><span className="thr-fill" style={{ "--throttle-width": `${throttle}%`, height: `${throttle}%` } as CSSProperties} /></div><span className="thr-pct">{formatPercent(throttle)}</span></div>
        <div className="asc-flight-state">
          <div className="sas-box">
            <div className="sas-primary"><span className="label">SAS</span><span className={`sas-val ${sas.source === "off" ? "off" : ""}`} title={sas.source === "mj" ? "MechJeb Smart A.S.S" : sas.source === "stock" ? "Stock SAS" : "SAS off"}>{sas.mode}</span></div>
            <span className="sas-hint">{sasHint}</span>
          </div>
          <div className="asc-flight-layout">
            <FlightMetric className="hero altitude-hero" label="Altitude" subtitle={altitudeContext} title={exactAltitude} value={formatDistance(snapshot["v.altitude"], "live")} />
            <div className={`asc-speed-grid${targetName ? " has-target" : ""}`}>
              <FlightMetric label="Vertical speed" value={formatSpeed(snapshot["v.verticalSpeed"])} />
              <FlightMetric label="Orbital velocity" value={formatSpeed(snapshot["v.orbitalVelocity"])} />
              <FlightMetric label="Surface speed" value={formatSpeed(snapshot["v.surfaceSpeed"])} />
              {targetName && <FlightMetric className="target-metric" label="Target relative" subtitle={targetName} value={formatSpeed(snapshot["tar.o.relativeVelocity"])} />}
            </div>
          </div>
        </div>
      </div>
      <div className="orbit-rail stats-grid"><Stat label="Apoapsis" value={formatDistance(snapshot["o.ApA"], "live")} /><Stat label="Periapsis" value={formatDistance(snapshot["o.PeA"], "live")} /><Stat label="Inclination" value={formatInclination(snapshot["o.inclination"])} /><Stat label="Eccentricity" value={formatEccentricity(snapshot["o.eccentricity"])} /><Stat label={"T \u2192 AP"} subtitle={hyperbolic ? "never \u2014 escape" : undefined} value={formatOrbitApoapsisCountdown(snapshot["o.timeToAp"], snapshot["o.eccentricity"], kerbinTime)} /><Stat label={"T \u2192 PE"} subtitle={periapsisSubtitle} value={formatOrbitPeriapsisCountdown(snapshot["o.timeToPe"], snapshot["o.eccentricity"], snapshot["v.verticalSpeed"], kerbinTime)} /><Stat label="Period" subtitle={hyperbolic ? "open orbit" : undefined} value={formatOrbitPeriod(snapshot["o.period"], snapshot["o.eccentricity"], kerbinTime)} /></div>
    </Panel>
  );
}
