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
  serializeThemeId,
  SUPPORTED_THEME_IDS,
  THEME_STORAGE_KEY,
} from "./theme";

describe("current theme contract", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("defines one current dark palette and its canonical JSON storage form", () => {
    expect(DEFAULT_THEME_ID).toBe("mission-control-dark");
    expect(SUPPORTED_THEME_IDS).toEqual([DEFAULT_THEME_ID]);
    expect(CURRENT_THEME_METADATA).toEqual({
      id: DEFAULT_THEME_ID,
      label: "Mission Control Dark",
      colorScheme: "dark",
      palette: "mission-control",
    });
    expect(DEFAULT_THEME_METADATA).toBe(CURRENT_THEME_METADATA);
    expect(serializeThemeId(DEFAULT_THEME_ID)).toBe('"mission-control-dark"');
  });

  it("loads the valid canonical JSON string and compatible raw identifier", () => {
    expect(parseStoredThemeId(serializeThemeId(DEFAULT_THEME_ID))).toBe(DEFAULT_THEME_ID);
    expect(parseStoredThemeId(DEFAULT_THEME_ID)).toBe(DEFAULT_THEME_ID);

    localStorage.setItem(THEME_STORAGE_KEY, serializeThemeId(DEFAULT_THEME_ID));
    expect(loadThemeId()).toBe(DEFAULT_THEME_ID);
    localStorage.setItem(THEME_STORAGE_KEY, DEFAULT_THEME_ID);
    expect(loadThemeId()).toBe(DEFAULT_THEME_ID);
  });

  it("falls back safely for malformed, unknown, and non-string values", () => {
    expect(parseStoredThemeId("{not-json")).toBe(DEFAULT_THEME_ID);
    expect(parseStoredThemeId('"future-theme"')).toBe(DEFAULT_THEME_ID);
    expect(parseStoredThemeId("future-theme")).toBe(DEFAULT_THEME_ID);
    expect(parseStoredThemeId(null)).toBe(DEFAULT_THEME_ID);
    expect(parseStoredThemeId(undefined)).toBe(DEFAULT_THEME_ID);

    localStorage.setItem(THEME_STORAGE_KEY, "{not-json");
    expect(loadThemeId()).toBe(DEFAULT_THEME_ID);
  });

  it("bootstraps the validated ID on the document root without storage writes", () => {
    localStorage.setItem(THEME_STORAGE_KEY, serializeThemeId(DEFAULT_THEME_ID));
    expect(bootstrapTheme()).toBe(DEFAULT_THEME_ID);
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME_ID);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(serializeThemeId(DEFAULT_THEME_ID));
  });

  it("applies idempotently and rejects runtime IDs outside the single theme", () => {
    expect(applyTheme(DEFAULT_THEME_ID)).toBe(DEFAULT_THEME_ID);
    expect(applyTheme(DEFAULT_THEME_ID)).toBe(DEFAULT_THEME_ID);
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME_ID);
    expect(applyTheme("future-theme")).toBe(DEFAULT_THEME_ID);
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME_ID);
    expect(SUPPORTED_THEME_IDS).toHaveLength(1);
  });
});
