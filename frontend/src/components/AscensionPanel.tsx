import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  formatAscensionDistance,
  formatCountdown,
  formatDegrees,
  formatSpeed,
  isFiniteNumber,
} from "../telemetry/formatters";
import type { TelemetrySnapshot } from "../telemetry/types";
import { Panel } from "./Panel";

function normalHeading(value: number | undefined) {
  return isFiniteNumber(value) ? ((value % 360) + 360) % 360 : undefined;
}

function HeadingTape({ heading }: { heading?: number }) {
  const normalized = normalHeading(heading);
  if (normalized === undefined) return <svg aria-label="Heading tape awaiting telemetry" viewBox="0 0 150 20" />;
  const marks = [];
  for (let delta = -40; delta <= 40; delta += 10) {
    const mark = Math.round((normalized + delta) / 10) * 10;
    const x = 75 + (mark - normalized) * 2;
    if (x < 0 || x > 150) continue;
    const label = ((mark % 360) + 360) % 360;
    const cardinal = ({ 0: "N", 90: "E", 180: "S", 270: "W" } as Record<number, string>)[label];
    marks.push(<g key={`${mark}-${x}`}><line x1={x} x2={x} y1="12" y2="20" /><text className={cardinal ? "cardinal" : ""} x={x} y="9">{cardinal ?? label}</text></g>);
  }
  return <svg aria-label={`Heading ${Math.round(normalized)} degrees`} viewBox="0 0 150 20"><rect width="150" height="20" />{marks}<path className="tape-pointer" d="M75 20 l-4 -5 h8 z" /></svg>;
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

function Sparkline({ signed = false, value }: { signed?: boolean; value?: number }) {
  const values = useRef<(number | null)[]>([]);
  values.current.push(isFiniteNumber(value) ? value : null);
  if (values.current.length > 120) values.current.shift();
  const finite = values.current.filter(isFiniteNumber);
  if (finite.length < 2) return <svg className="spark" preserveAspectRatio="none" viewBox="0 0 240 44" />;
  let low = Math.min(...finite);
  let high = Math.max(...finite);
  if (signed) { const magnitude = Math.max(Math.abs(low), Math.abs(high), 1); low = -magnitude; high = magnitude; }
  if (high - low < 1e-6) high = low + 1;
  const points = values.current.map((item, index) => item === null ? null : `${index / Math.max(1, values.current.length - 1) * 240},${40 - ((item - low) / (high - low)) * 36}`);
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((point) => { if (point) current.push(point); else if (current.length) { segments.push(current.join(" ")); current = []; } });
  if (current.length) segments.push(current.join(" "));
  const zeroY = 40 - ((0 - low) / (high - low)) * 36;
  return <svg className="spark" preserveAspectRatio="none" viewBox="0 0 240 44">{signed && <line className="spark-zero" x1="0" x2="240" y1={zeroY} y2={zeroY} />}{segments.map((segment, index) => <polyline key={index} points={segment} />)}</svg>;
}

function Stat({ label, title, value }: { label: string; title?: string; value: string }) {
  return <div className="stat"><span className="label">{label}</span><span className="v" title={title}>{value}</span></div>;
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

export function AscensionPanel({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const throttle = isFiniteNumber(snapshot["krpc.throttle"]) ? Math.round(snapshot["krpc.throttle"] * 100) : 0;
  const heading = snapshot["n.heading"];
  const pitch = snapshot["n.pitch"];
  const roll = snapshot["n.roll"];
  const sas = useStableSasDisplay(snapshot);
  const exactAltitude = isFiniteNumber(snapshot["v.altitude"])
    ? `Exact: ${snapshot["v.altitude"].toLocaleString("en-US", { maximumFractionDigits: 1 })} m` : undefined;

  return (
    <Panel hideable id="asc" title="Ascension" tag="Attitude · Throttle · Flight">
      <div className="asc-top">
        <div className="asc-left"><div className="sas-box"><span className="label">{sas.source === "mj" ? "Smart A.S.S (MechJeb)" : "SAS"}</span><span className={`sas-val ${sas.source === "off" ? "off" : ""}`}>{sas.mode}</span></div><div className="alt-box"><span className="label">Altitude</span><span className="alt-val" title={exactAltitude}>{formatAscensionDistance(snapshot["v.altitude"])}</span></div></div>
        <div className="navwrap"><div className="heading-tape"><HeadingTape heading={heading} /></div><Navball heading={heading} pitch={pitch} roll={roll} /><div className="hdg-readout">HDG {normalHeading(heading)?.toFixed(0).padStart(3, "0") ?? "---"}° · PIT {isFiniteNumber(pitch) ? `${pitch >= 0 ? "+" : ""}${Math.round(pitch)}` : "--"}° · ROL {isFiniteNumber(roll) ? Math.round(roll) : "--"}°</div></div>
        <div className="throttle-col"><span className="label">THR</span><div aria-label="Throttle" aria-valuemax={100} aria-valuemin={0} aria-valuenow={throttle} className="thr-track" role="meter"><span className="thr-fill" style={{ "--throttle-width": `${throttle}%`, height: `${throttle}%` } as CSSProperties} /></div><span className="thr-pct">{throttle}%</span></div>
      </div>
      <div className="stats-grid"><Stat label="Apoapsis" value={formatAscensionDistance(snapshot["o.ApA"])} /><Stat label="T→Ap" value={formatCountdown(snapshot["o.timeToAp"])} /><Stat label="Periapsis" value={formatAscensionDistance(snapshot["o.PeA"])} /><Stat label="T→Pe" value={formatCountdown(snapshot["o.timeToPe"])} /><Stat label="Vert Spd" value={formatSpeed(snapshot["v.verticalSpeed"])} /><Stat label="Surf Spd" value={formatSpeed(snapshot["v.surfaceSpeed"])} /><Stat label="Orb Vel" value={formatSpeed(snapshot["v.orbitalVelocity"])} /><Stat label="Inclination" value={formatDegrees(snapshot["o.inclination"])} /><Stat label="Eccentricity" value={isFiniteNumber(snapshot["o.eccentricity"]) ? snapshot["o.eccentricity"].toFixed(4) : "—"} /><Stat label="Period" value={formatCountdown(snapshot["o.period"])} /></div>
      <div className="spark-row"><div><div className="spark-lab">Altitude</div><Sparkline value={snapshot["v.altitude"]} /></div><div><div className="spark-lab">Vertical speed</div><Sparkline signed value={snapshot["v.verticalSpeed"]} /></div></div>
    </Panel>
  );
}
