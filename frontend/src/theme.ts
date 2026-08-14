/**
 * The dashboard currently exposes one intentional visual theme. Keeping the
 * identifier and storage contract separate from CSS leaves a safe seam for a
 * future palette without presenting an unusable theme chooser today.
 */
export const THEME_STORAGE_KEY = "wmc-theme-v1";
export const DEFAULT_THEME_ID = "mission-control-dark" as const;
export type ThemeId = typeof DEFAULT_THEME_ID;

export interface ThemeMetadata {
  id: ThemeId;
  label: string;
  colorScheme: "dark";
  palette: "mission-control";
}

export const CURRENT_THEME_METADATA: Readonly<ThemeMetadata> = Object.freeze({
  id: DEFAULT_THEME_ID,
  label: "Mission Control Dark",
  colorScheme: "dark",
  palette: "mission-control",
});

export const DEFAULT_THEME_METADATA = CURRENT_THEME_METADATA;
export const SUPPORTED_THEME_IDS: readonly ThemeId[] = [DEFAULT_THEME_ID];

/** The canonical persisted form is a JSON string; raw IDs remain readable. */
export function serializeThemeId(themeId: ThemeId): string {
  return JSON.stringify(themeId);
}

export function isThemeId(value: unknown): value is ThemeId {
  return value === DEFAULT_THEME_ID;
}

/**
 * Parse a stored value without allowing malformed or unknown identifiers to
 * reach the DOM. Raw identifiers are accepted for compatibility with an
 * earlier pre-JSON draft of this reserved key.
 */
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

/** Apply the validated ID to the document root; repeated calls are harmless. */
export function applyTheme(themeId: unknown = DEFAULT_THEME_ID): ThemeId {
  const resolved = isThemeId(themeId) ? themeId : DEFAULT_THEME_ID;
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    if (root.dataset.theme !== resolved) root.dataset.theme = resolved;
  }
  return resolved;
}

/** Load and apply the current theme before React mounts. This never writes storage. */
export function bootstrapTheme(storage?: Storage | null): ThemeId {
  return applyTheme(loadThemeId(storage));
}
