import { useEffect, useRef, useState, type CSSProperties } from "react";
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
  if (!isFiniteNumber(pitch) || !isFiniteNumber(roll)) {
    return <svg aria-label="Attitude indicator awaiting telemetry" className="navball" viewBox="0 0 168 168"><circle className="nav-empty" cx="84" cy="84" r="72" /><path className="aircraft" d="M54 84 h20 v6 M114 84 h-20 v6" /><circle className="aircraft-dot" cx="84" cy="84" r="2.4" /></svg>;
  }
  const offset = pitch * .8;
  return (
    <svg aria-label={`Pitch ${Math.round(pitch)}, roll ${Math.round(roll)}, heading ${Math.round(normalHeading(heading) ?? 0)}`} className="navball" viewBox="0 0 168 168">
      <defs><clipPath id="react-navball-clip"><circle cx="84" cy="84" r="72" /></clipPath><radialGradient id="react-navball-shade" cx="38%" cy="34%" r="75%"><stop offset="0%" stopColor="#fff" stopOpacity=".14" /><stop offset="60%" stopColor="#000" stopOpacity="0" /><stop offset="100%" stopColor="#000" stopOpacity=".45" /></radialGradient></defs>
      <g clipPath="url(#react-navball-clip)"><g transform={`rotate(${-roll} 84 84)`}><g transform={`translate(0 ${offset})`}><rect className="nav-sky" x="12" y="-132" width="144" height="216" /><rect className="nav-ground" x="12" y="84" width="144" height="216" /><line className="nav-horizon" x1="12" x2="156" y1="84" y2="84" />{[-60,-30,30,60].map((degree) => <g key={degree}><line className="pitch-line" x1={degree % 60 === 0 ? 58 : 68} x2={degree % 60 === 0 ? 110 : 100} y1={84 - degree * .8} y2={84 - degree * .8} /><text className="pitch-label" x="54" y={87 - degree * .8}>{Math.abs(degree)}</text></g>)}</g></g><circle cx="84" cy="84" fill="url(#react-navball-shade)" r="72" /></g>
      <circle className="nav-ring" cx="84" cy="84" r="72" /><path className="aircraft" d="M54 84 h20 v6 M114 84 h-20 v6" /><circle className="aircraft-dot" cx="84" cy="84" r="2.4" /><path className="roll-pointer" d="M84 14 l-5 -8 h10 z" transform={`rotate(${-roll} 84 84)`} />
    </svg>
  );
}

function Stat({ label, title, value }: { label: string; title?: string; value: string }) {
  return <div className="stat"><span className="label">{label}</span><span className="v" title={title}>{value}</span></div>;
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

export function AscensionPanel({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const { system } = useTimeSystem();
  const kerbinTime = isKerbinTime(system);
  const throttle = isFiniteNumber(snapshot["krpc.throttle"]) ? Math.round(snapshot["krpc.throttle"] * 100) : 0;
  const heading = snapshot["n.heading"];
  const pitch = snapshot["n.pitch"];
  const roll = snapshot["n.roll"];
  const sas = useStableSasDisplay(snapshot);
  const targetName = snapshot["tar.name"]?.trim();
  const exactAltitude = isFiniteNumber(snapshot["v.altitude"])
    ? `Exact: ${formatTelemetryNumber(snapshot["v.altitude"])} m` : undefined;
  const altitudeContext = [
    snapshot["v.body"] ? `above ${snapshot["v.body"]}` : undefined,
    verticalMotion(snapshot["v.verticalSpeed"]),
  ].filter(Boolean).join(" \u00b7 ");

  return (
    <Panel compact id="asc" title="Ascension">
      <div className="asc-cockpit">
        <div className="asc-instrument-column">
          <div className="navwrap"><div className="heading-tape"><HeadingTape heading={heading} /></div><Navball heading={heading} pitch={pitch} roll={roll} /></div>
          <div aria-label="Attitude readout" className="attitude-strip">
            <div><span className="label">HDG</span><span>{formatHeadingDegrees(heading)}&deg;</span></div>
            <div><span className="label">PIT</span><span>{formatAttitudeDegrees(pitch, true)}&deg;</span></div>
            <div><span className="label">ROL</span><span>{formatAttitudeDegrees(roll)}&deg;</span></div>
          </div>
        </div>
        <div className="throttle-col"><span className="label">THR</span><div aria-label="Throttle" aria-valuemax={100} aria-valuemin={0} aria-valuenow={throttle} className="thr-track" role="meter"><span className="thr-fill" style={{ "--throttle-width": `${throttle}%`, height: `${throttle}%` } as CSSProperties} /></div><span className="thr-pct">{formatPercent(throttle)}</span></div>
        <div className="asc-flight-state">
          <div className="sas-box">
            <div className="sas-primary"><span className="label">{sas.source === "mj" ? "SMART A.S.S" : "SAS"}</span><span className={`sas-val ${sas.source === "off" ? "off" : ""}`}>{sas.mode}</span></div>
            <span className="sas-provider">{sas.source === "mj" ? "MECHJEB" : sas.source === "stock" ? "STOCK" : "INACTIVE"}</span>
          </div>
          <div className="asc-hero-grid">
            <FlightMetric className="hero" label="Altitude" subtitle={altitudeContext} title={exactAltitude} value={formatDistance(snapshot["v.altitude"], "live")} />
            <FlightMetric className="hero" label="Vertical speed" value={formatSpeed(snapshot["v.verticalSpeed"])} />
          </div>
          <div className={`asc-speed-grid${targetName ? " has-target" : ""}`}>
            <FlightMetric label="Surface speed" value={formatSpeed(snapshot["v.surfaceSpeed"])} />
            <FlightMetric label="Orbital velocity" value={formatSpeed(snapshot["v.orbitalVelocity"])} />
            {targetName && <FlightMetric label="Target relative" subtitle={targetName} value={formatSpeed(snapshot["tar.o.relativeVelocity"])} />}
          </div>
        </div>
      </div>
      <div className="orbit-rail stats-grid"><Stat label="Apoapsis" value={formatDistance(snapshot["o.ApA"], "live")} /><Stat label={"T\u2192Ap"} value={formatOrbitApoapsisCountdown(snapshot["o.timeToAp"], snapshot["o.eccentricity"], kerbinTime)} /><Stat label="Periapsis" value={formatDistance(snapshot["o.PeA"], "live")} /><Stat label={"T\u2192Pe"} value={formatOrbitPeriapsisCountdown(snapshot["o.timeToPe"], snapshot["o.eccentricity"], snapshot["v.verticalSpeed"], kerbinTime)} /><Stat label="Inclination" value={formatInclination(snapshot["o.inclination"])} /><Stat label="Eccentricity" value={formatEccentricity(snapshot["o.eccentricity"])} /><Stat label="Period" value={formatOrbitPeriod(snapshot["o.period"], snapshot["o.eccentricity"], kerbinTime)} /></div>
    </Panel>
  );
}
