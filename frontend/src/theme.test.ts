// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyTheme,
  bootstrapTheme,
  CURRENT_THEME_METADATA,
  DEFAULT_THEME_ID,
  DEFAULT_THEME_METADATA,
  loadThemeId,
  parseStoredThemeId,
  selectTheme,
  serializeThemeId,
  SUPPORTED_THEME_IDS,
  THEME_METADATA,
  THEME_OPTIONS,
  THEME_STORAGE_KEY,
} from "./theme";

describe("dashboard theme contract", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.removeProperty("color-scheme");
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.removeProperty("color-scheme");
  });

  it("defines four stable themes while preserving Mission Control Dark as the default", () => {
    expect(DEFAULT_THEME_ID).toBe("mission-control-dark");
    expect(SUPPORTED_THEME_IDS).toEqual([
      "mission-control-dark",
      "daylight-console",
      "warm-crt",
      "green-phosphor",
    ]);
    expect(THEME_OPTIONS.map(({ id, label, colorScheme }) => ({ id, label, colorScheme }))).toEqual([
      { id: "mission-control-dark", label: "Mission Control Dark", colorScheme: "dark" },
      { id: "daylight-console", label: "Daylight Console", colorScheme: "light" },
      { id: "warm-crt", label: "Warm CRT", colorScheme: "dark" },
      { id: "green-phosphor", label: "Green Phosphor", colorScheme: "dark" },
    ]);
    expect(DEFAULT_THEME_METADATA).toBe(CURRENT_THEME_METADATA);
    expect(THEME_METADATA[DEFAULT_THEME_ID].palette).toBe("mission-control");
    expect(serializeThemeId(DEFAULT_THEME_ID)).toBe('"mission-control-dark"');
  });

  it("loads every valid canonical JSON string and compatible raw identifier", () => {
    for (const themeId of SUPPORTED_THEME_IDS) {
      expect(parseStoredThemeId(serializeThemeId(themeId))).toBe(themeId);
      expect(parseStoredThemeId(themeId)).toBe(themeId);
      localStorage.setItem(THEME_STORAGE_KEY, serializeThemeId(themeId));
      expect(loadThemeId()).toBe(themeId);
    }
  });

  it("falls back safely for malformed, unknown, and non-string values", () => {
    expect(parseStoredThemeId("{not-json")).toBe(DEFAULT_THEME_ID);
    expect(parseStoredThemeId('"future-theme"')).toBe(DEFAULT_THEME_ID);
    expect(parseStoredThemeId("future-theme")).toBe(DEFAULT_THEME_ID);
    expect(parseStoredThemeId(null)).toBe(DEFAULT_THEME_ID);
    expect(parseStoredThemeId(undefined)).toBe(DEFAULT_THEME_ID);
  });

  it("bootstraps the stored theme before React without rewriting storage", () => {
    localStorage.setItem(THEME_STORAGE_KEY, serializeThemeId("daylight-console"));
    expect(bootstrapTheme()).toBe("daylight-console");
    expect(document.documentElement.dataset.theme).toBe("daylight-console");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(serializeThemeId("daylight-console"));
  });

  it("applies, persists, and rejects runtime IDs outside the supported set", () => {
    expect(selectTheme("warm-crt")).toBe("warm-crt");
    expect(document.documentElement.dataset.theme).toBe("warm-crt");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(serializeThemeId("warm-crt"));

    expect(applyTheme("future-theme")).toBe(DEFAULT_THEME_ID);
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME_ID);
  });
});
