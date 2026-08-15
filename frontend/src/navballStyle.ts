export const NAVBALL_STYLE_STORAGE_KEY = "wmc-navball-style-v1";

export const SUPPORTED_NAVBALL_STYLE_IDS = [
  "mission-control",
  "ksp2-pre-alpha",
] as const;

export type NavballStyleId = typeof SUPPORTED_NAVBALL_STYLE_IDS[number];

export interface NavballStyleMetadata {
  id: NavballStyleId;
  label: string;
  description: string;
}

export const DEFAULT_NAVBALL_STYLE_ID: NavballStyleId = "mission-control";

export const NAVBALL_STYLE_OPTIONS: readonly NavballStyleMetadata[] = [
  {
    id: "mission-control",
    label: "Mission Control",
    description: "The standard clean vector navball.",
  },
  {
    id: "ksp2-pre-alpha",
    label: "KSP2 Pre-Alpha",
    description: "SqueakyB's textured KSP2 pre-alpha interpretation.",
  },
] as const;

export function isNavballStyleId(value: unknown): value is NavballStyleId {
  return typeof value === "string"
    && (SUPPORTED_NAVBALL_STYLE_IDS as readonly string[]).includes(value);
}

export function parseStoredNavballStyleId(stored: string | null | undefined): NavballStyleId {
  if (typeof stored !== "string") return DEFAULT_NAVBALL_STYLE_ID;
  const candidate = stored.trim();
  if (isNavballStyleId(candidate)) return candidate;
  try {
    const parsed: unknown = JSON.parse(candidate);
    return isNavballStyleId(parsed) ? parsed : DEFAULT_NAVBALL_STYLE_ID;
  } catch {
    return DEFAULT_NAVBALL_STYLE_ID;
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadNavballStyleId(storage: Storage | null | undefined = browserStorage()): NavballStyleId {
  try {
    return parseStoredNavballStyleId(storage?.getItem(NAVBALL_STYLE_STORAGE_KEY));
  } catch {
    return DEFAULT_NAVBALL_STYLE_ID;
  }
}

export function selectNavballStyle(
  value: unknown,
  storage: Storage | null | undefined = browserStorage(),
): NavballStyleId {
  const resolved = isNavballStyleId(value) ? value : DEFAULT_NAVBALL_STYLE_ID;
  try {
    storage?.setItem(NAVBALL_STYLE_STORAGE_KEY, JSON.stringify(resolved));
  } catch {
    // The choice still applies for this session when local storage is denied.
  }
  return resolved;
}
