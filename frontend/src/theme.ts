export const THEME_STORAGE_KEY = "wmc-theme-v1";

export const SUPPORTED_THEME_IDS = [
  "mission-control-dark",
  "daylight-console",
  "warm-crt",
  "green-phosphor",
] as const;

export type ThemeId = typeof SUPPORTED_THEME_IDS[number];

export interface ThemeMetadata {
  id: ThemeId;
  label: string;
  colorScheme: "dark" | "light";
  palette: string;
  description: string;
  swatches: readonly [string, string, string];
}

export const DEFAULT_THEME_ID: ThemeId = "mission-control-dark";

export const THEME_OPTIONS: readonly ThemeMetadata[] = [
  {
    id: "mission-control-dark",
    label: "Mission Control Dark",
    colorScheme: "dark",
    palette: "mission-control",
    description: "Deep navy console with amber headings and cyan active states.",
    swatches: ["#05070b", "#ffb454", "#4ec9e0"],
  },
  {
    id: "daylight-console",
    label: "Daylight Console",
    colorScheme: "light",
    palette: "daylight",
    description: "High-contrast light surfaces for bright rooms.",
    swatches: ["#dde3ea", "#8a5300", "#0d6379"],
  },
  {
    id: "warm-crt",
    label: "Warm CRT",
    colorScheme: "dark",
    palette: "warm-crt",
    description: "Amber and warm brown console surfaces with teal active states.",
    swatches: ["#0d0a06", "#ffc36b", "#6fd0c2"],
  },
  {
    id: "green-phosphor",
    label: "Green Phosphor",
    colorScheme: "dark",
    palette: "green-phosphor",
    description: "Deep green terminal surfaces with phosphor active states.",
    swatches: ["#040a07", "#ffc247", "#bdf6cf"],
  },
] as const;

export const THEME_METADATA: Readonly<Record<ThemeId, ThemeMetadata>> = Object.freeze(
  Object.fromEntries(THEME_OPTIONS.map((theme) => [theme.id, theme])) as Record<ThemeId, ThemeMetadata>,
);

export const DEFAULT_THEME_METADATA = THEME_METADATA[DEFAULT_THEME_ID];
/** Backward-compatible name used by existing About content. */
export const CURRENT_THEME_METADATA = DEFAULT_THEME_METADATA;

export function serializeThemeId(themeId: ThemeId): string {
  return JSON.stringify(themeId);
}

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (SUPPORTED_THEME_IDS as readonly string[]).includes(value);
}

export function parseStoredThemeId(stored: string | null | undefined): ThemeId {
  if (typeof stored !== "string") return DEFAULT_THEME_ID;
  const candidate = stored.trim();
  if (isThemeId(candidate)) return candidate;

  try {
    const parsed: unknown = JSON.parse(candidate);
    return isThemeId(parsed) ? parsed : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadThemeId(storage: Storage | null | undefined = browserStorage()): ThemeId {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    // Private browsing and restricted origins can reject localStorage reads.
  }
  return parseStoredThemeId(stored);
}

export function persistThemeId(themeId: ThemeId, storage: Storage | null | undefined = browserStorage()): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, serializeThemeId(themeId));
  } catch {
    // Theme selection still applies for the session when storage is denied.
  }
}

export function applyTheme(themeId: unknown = DEFAULT_THEME_ID): ThemeId {
  const resolved = isThemeId(themeId) ? themeId : DEFAULT_THEME_ID;
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    if (root.dataset.theme !== resolved) root.dataset.theme = resolved;
    root.style.colorScheme = THEME_METADATA[resolved].colorScheme;
  }
  return resolved;
}

export function selectTheme(themeId: unknown, storage?: Storage | null): ThemeId {
  const resolved = applyTheme(themeId);
  persistThemeId(resolved, storage);
  return resolved;
}

/** Load and apply the current theme before React mounts to avoid a palette flash. */
export function bootstrapTheme(storage?: Storage | null): ThemeId {
  return applyTheme(loadThemeId(storage));
}
