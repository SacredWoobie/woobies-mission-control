export type PanelRailIconName =
  | "conn"
  | "clock"
  | "asc"
  | "cons"
  | "heat"
  | "elec"
  | "sci"
  | "stage"
  | "target"
  | "overviewFleet"
  | "overviewRoster"
  | "overviewAlarms"
  | "notes"
  | "flightNote";

export function PanelRailIcon({ name }: { name: PanelRailIconName }) {
  const common = {
    "aria-hidden": true,
    className: `panel-rail-icon panel-rail-icon-${name}`,
    focusable: "false",
    viewBox: "0 0 32 32",
  } as const;

  if (name === "conn") return (
    <svg {...common}>
      <circle cx="16" cy="22" r="2.4" />
      <path d="M16 22V28M11.5 28h9M11 18.5a7 7 0 0 1 10 0M7 14.5a12.5 12.5 0 0 1 18 0" />
    </svg>
  );
  if (name === "clock") return (
    <svg {...common}>
      <circle cx="16" cy="16" r="11.5" />
      <path d="M16 8v8l5 3" />
      <path className="rail-icon-detail" d="M16 4.5v2M27.5 16h-2M16 27.5v-2M4.5 16h2" />
    </svg>
  );
  if (name === "asc") return (
    <svg {...common}>
      <circle className="rail-nav-sky" cx="16" cy="16" r="11.5" />
      <path className="rail-nav-ground" d="M4.5 16a11.5 11.5 0 0 0 23 0Z" />
      <circle cx="16" cy="16" r="11.5" />
      <path d="M4.5 16h23M16 11v10M12.5 16l3.5 3.5 3.5-3.5" />
    </svg>
  );
  if (name === "cons") return (
    <svg {...common}>
      <rect x="6" y="5" width="14" height="22" rx="2" />
      <path className="rail-icon-fill" d="M9 15h8v9H9z" />
      <path d="M9 9h8v6H9zM20 10h3l3 4v9.5a2.5 2.5 0 0 1-5 0V20" />
    </svg>
  );
  if (name === "heat") return (
    <svg {...common}>
      <path d="M13 18.5V7a3 3 0 0 1 6 0v11.5a6 6 0 1 1-6 0Z" />
      <path className="rail-icon-fill" d="M14.7 19.5V8.5h2.6v11a3.5 3.5 0 1 1-2.6 0Z" />
      <path d="M21 9h4M21 14h3" />
    </svg>
  );
  if (name === "elec") return (
    <svg {...common}>
      <path className="rail-icon-bolt" d="M18.5 3 8 18h7l-1.5 11L24 14h-7Z" />
    </svg>
  );
  if (name === "sci") return (
    <svg {...common}>
      <path d="M12 4h8M14 4v8L7.5 24.5A2.4 2.4 0 0 0 9.7 28h12.6a2.4 2.4 0 0 0 2.2-3.5L18 12V4" />
      <path className="rail-icon-fill" d="m10.5 22 2.6-5h5.8l2.6 5Z" />
      <circle className="rail-icon-detail" cx="15" cy="22" r="1" />
      <circle className="rail-icon-detail" cx="18.5" cy="19" r=".8" />
    </svg>
  );
  if (name === "stage") return (
    <svg {...common}>
      <path
        className="rail-icon-stage-mark"
        d="M11 3 1 27h20L11 3Zm0 7 3.7 11H6.3L11 10Z"
        fillRule="evenodd"
      />
      <path
        className="rail-icon-stage-mark"
        d="M19.7 12h3.8l1.8 9.2 3.2-9.2H32l-5.2 15h-4.3Z"
      />
    </svg>
  );
  if (name === "target") return (
    <svg {...common}>
      <circle cx="16" cy="16" r="11.5" />
      <circle cx="16" cy="16" r="6" />
      <circle className="rail-icon-fill" cx="16" cy="16" r="2" />
      <path d="M16 2v5M16 25v5M2 16h5M25 16h5" />
    </svg>
  );
  if (name === "overviewFleet") return (
    <svg {...common}>
      <path d="M16 3c-3.6 3.7-5.5 8.4-5.5 14v5h11v-5c0-5.6-1.9-10.3-5.5-14Z" />
      <circle className="rail-icon-detail" cx="16" cy="12" r="2.6" />
      <path d="m10.5 17-4.5 5v4.5l4.5-2.2m11-7.3 4.5 5v4.5l-4.5-2.2M13 25l3 4 3-4" />
    </svg>
  );
  if (name === "overviewRoster") return (
    <svg {...common}>
      <path d="M10 12V8a6 6 0 0 1 12 0v4M8 13h16l2 8-4 2v6H10v-6l-4-2 2-8Z" />
      <path className="rail-icon-detail" d="M12 8h8v4h-8V8Zm-2 9-5-2m17 2 5-2M14 23v6m4-6v6" />
      <path d="M8 14V9h2m14 5V9h-2" />
    </svg>
  );
  if (name === "overviewAlarms") return (
    <svg {...common}>
      <path d="m7 7-3-3m21 3 3-3M8.5 4.5 5.5 7.5m18-3 3 3" />
      <circle cx="16" cy="18" r="10" />
      <path d="M16 12v6l4 3M9 27l-2 2m16-2 2 2M12 5h8" />
      <path className="rail-icon-detail" d="M16 8v2M26 18h-2M16 28v-2M6 18h2" />
    </svg>
  );

  const pinned = name === "flightNote";
  return (
    <svg {...common}>
      <path className="rail-note-cover" d="M8 4h17v24H8a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z" />
      <path d="M9 4v24M13 10h8M13 15h8M13 20h6" />
      {pinned && (
        <g className="rail-note-pin" transform="translate(15.5 .5) rotate(38 7 8)">
          <path className="rail-note-pin-needle-shadow" d="M7 12v6" />
          <path className="rail-note-pin-needle" d="M7 12v6" />
          <path className="rail-note-pin-body" d="M2 2.5h10v3h-1.8L9.4 9l2.6 2.3v1.5H2v-1.5L4.6 9l-.8-3.5H2Z" />
        </g>
      )}
    </svg>
  );
}
