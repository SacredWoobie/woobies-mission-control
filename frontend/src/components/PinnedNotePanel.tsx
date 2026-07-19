import { useState } from "react";
import type { TelemetryCommand, TelemetrySnapshot } from "../telemetry/types";
import { Panel } from "./Panel";

export function PinnedNotePanel({
  commandEnabled,
  onSendCommand,
  snapshot,
}: {
  commandEnabled: boolean;
  onSendCommand(command: TelemetryCommand): boolean;
  snapshot: TelemetrySnapshot;
}) {
  const [fontSize, setFontSize] = useState(10);
  const note = snapshot["notes.pinned"];
  if (!note) return null;
  const details = [note.relativePath, `${(note.size / 1024).toFixed(1)} KB`, `updated ${new Date(note.modified * 1000).toLocaleString()}`, note.truncated ? "latest 32 KiB shown" : ""].filter(Boolean).join(" / ");
  return (
    <Panel
      headingActions={
        <>
          <span className="flight-note-name" title={note.name}>{note.name}</span>
          <span aria-label="Pinned note text size" className="notes-font-controls">
            <button aria-label="Decrease pinned note text size" disabled={fontSize <= 8} onClick={() => setFontSize((value) => Math.max(8, value - 1))} type="button">A-</button>
            <button aria-label="Reset pinned note text size" className="notes-font-value" onClick={() => setFontSize(10)} title="Reset to default" type="button">{fontSize}px</button>
            <button aria-label="Increase pinned note text size" disabled={fontSize >= 18} onClick={() => setFontSize((value) => Math.min(18, value + 1))} type="button">A+</button>
          </span>
          <button className="flight-note-unpin" disabled={!commandEnabled} onClick={() => onSendCommand({ type: "notes.pin", relativePath: null })} type="button">Unpin</button>
        </>
      }
      hideable
      id="flightNote"
      title="Pinned note"
    >
      <div className="flight-note-meta" title={details}>{details}</div>
      <pre className="flight-note-log" style={{ fontSize }}>{note.text.trim() || "(empty note)"}</pre>
    </Panel>
  );
}
