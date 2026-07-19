import { useEffect, useMemo, useRef, useState } from "react";
import type { NoteCatalogEntry, TelemetryCommand, TelemetrySnapshot } from "../telemetry/types";

interface NotesContinuityPreviewProps {
  commandEnabled?: boolean;
  open: boolean;
  snapshot: TelemetrySnapshot;
  onClose: () => void;
  onSendCommand?(command: TelemetryCommand): boolean;
}

function noteLabel(note: NoteCatalogEntry) {
  return `${note.name || note.relativePath}${note.isActiveLog ? " [ACTIVE]" : ""}`;
}

export function NotesContinuityPreview({
  commandEnabled = false,
  onClose,
  onSendCommand = () => false,
  open,
  snapshot,
}: NotesContinuityPreviewProps) {
  const [query, setQuery] = useState("");
  const [fontSize, setFontSize] = useState(10);
  const [autoFollow, setAutoFollow] = useState(true);
  const logRef = useRef<HTMLPreElement>(null);
  const available = snapshot["notes.available"] === true;
  const catalog = snapshot["notes.catalog"] ?? [];
  const selectedPath = snapshot["notes.selectedPath"] ?? "";
  const pinnedPath = snapshot["notes.pinnedPath"] ?? "";
  const selected = snapshot["notes.selected"] ?? snapshot["notes.active"];
  const mode = snapshot["context.mode"];
  const vessel = mode === "flight" ? snapshot["v.name"] || "Active vessel" : mode === "editor" ? "Available in the editor" : "Available in this KSP scene";
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return catalog.filter((note) => !search || `${note.name} ${note.relativePath}`.toLocaleLowerCase().includes(search));
  }, [catalog, query]);
  const selectedIndex = filtered.findIndex((note) => note.relativePath === selectedPath);

  useEffect(() => {
    if (open && autoFollow && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [autoFollow, open, selected?.modified, selected?.size, selected?.text]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  function select(relativePath: string | null) {
    if (commandEnabled) onSendCommand({ type: "notes.select", relativePath });
  }

  function cycle(direction: number) {
    if (!filtered.length) return;
    const start = selectedIndex < 0 ? (direction > 0 ? -1 : 0) : selectedIndex;
    const next = (start + direction + filtered.length) % filtered.length;
    select(filtered[next].relativePath);
  }

  const selectedIsPinned = !!selectedPath && selectedPath === pinnedPath;
  const metadata = selected ? [
    selected.relativePath,
    `${(selected.size / 1024).toFixed(1)} KB`,
    `updated ${new Date(selected.modified * 1000).toLocaleString()}`,
  ].join(" / ") : "";

  return (
    <>
      {open && <>
        <button aria-label="Close Notes drawer" className="notes-drawer-backdrop" onClick={onClose} type="button" />
        <aside aria-label="Notes continuity preview" className="notes-preview notes-drawer-full" id="notes-continuity-preview">
          <header>
            <div><span className="notes-preview-kicker">zer0Kerbal / Notes</span><h2>{mode === "flight" ? "Active vessel log" : "Notes reference"}</h2><p>{vessel}</p></div>
            <button aria-label="Close Notes preview" onClick={onClose} type="button">×</button>
          </header>
          {available ? <div className="notes-full-body">
            <div className="notes-browser">
              <div className="notes-browser-nav"><button aria-label="Previous saved note" disabled={!commandEnabled || !filtered.length} onClick={() => cycle(-1)} type="button">‹</button><button disabled={!commandEnabled || snapshot["notes.selectionMode"] !== "browse"} onClick={() => select(null)} type="button">Active</button><button aria-label="Next saved note" disabled={!commandEnabled || !filtered.length} onClick={() => cycle(1)} type="button">›</button><span>{selectedIndex >= 0 ? `${selectedIndex + 1} / ${filtered.length}` : `${filtered.length}${snapshot["notes.catalogTruncated"] ? "+" : ""} notes`}</span></div>
              <input aria-label="Search saved notes" className="notes-search" onChange={(event) => setQuery(event.target.value)} placeholder="Search saved notes" type="search" value={query} />
              <div aria-label="Saved Notes files" className="notes-list" role="list">{filtered.map((note) => <div className="notes-list-row" key={note.relativePath} role="listitem"><button className={`notes-item ${note.relativePath === selectedPath ? "active" : ""}`} disabled={!commandEnabled} onClick={() => select(note.relativePath)} title={note.relativePath} type="button">{noteLabel(note)}</button><button aria-label={`${note.isFavorite ? "Remove" : "Add"} ${noteLabel(note)} ${note.isFavorite ? "from" : "to"} favorites`} className={`notes-star ${note.isFavorite ? "favorite" : ""}`} disabled={!commandEnabled} onClick={() => onSendCommand({ type: "notes.favorite", relativePath: note.relativePath, favorite: !note.isFavorite })} type="button">{note.isFavorite ? "★" : "☆"}</button></div>)}</div>
            </div>
            <div className="notes-content">
              <div className="notes-content-head"><div><strong>{selected ? (selected.truncated ? "Showing latest portion" : snapshot["notes.selectionMode"] === "browse" ? "Saved note" : "Active ship log") : snapshot["notes.message"] || "No saved note selected"}</strong><span>{metadata}</span></div><button aria-pressed={selectedIsPinned} disabled={!commandEnabled || !selectedPath} onClick={() => onSendCommand({ type: "notes.pin", relativePath: selectedIsPinned ? null : selectedPath })} type="button">{selectedIsPinned ? "Unpin from flight" : "Pin to flight"}</button></div>
              {selected ? <pre className="notes-log" ref={logRef} style={{ fontSize }} tabIndex={0}>{selected.text.trim() || "(empty note)"}</pre> : <div className="notes-empty">Choose a saved note, or open the active vessel's Ship Log in Notes.</div>}
            </div>
          </div> : <div className="notes-unavailable"><strong>Notes unavailable</strong><span>{snapshot["notes.message"] || "The Notes mod folder is not available in the current telemetry feed."}</span></div>}
          <footer><span>Saved notes remain available across Flight, VAB/SPH, and inactive scenes.</span><span className="notes-font-controls"><button aria-label="Decrease note text size" disabled={fontSize <= 8} onClick={() => setFontSize((value) => Math.max(8, value - 1))} type="button">A-</button><button onClick={() => setFontSize(10)} type="button">{fontSize}px</button><button aria-label="Increase note text size" disabled={fontSize >= 18} onClick={() => setFontSize((value) => Math.min(18, value + 1))} type="button">A+</button></span><label><input checked={autoFollow} onChange={(event) => setAutoFollow(event.target.checked)} type="checkbox" /> Auto-follow</label></footer>
        </aside>
      </>}
    </>
  );
}
