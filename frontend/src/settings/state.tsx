import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type {
  ScienceAlarmAction,
  ScienceAlarmProviderPreference,
} from "../telemetry/types";
import {
  loadThemeId,
  selectTheme,
  type ThemeId,
} from "../theme";

export const SCIENCE_ALARM_SETTINGS_KEY = "wmc-science-alarm-defaults-v1";

export type ScienceAlarmLead = 1800 | 3600;

export interface ScienceAlarmDefaults {
  provider: ScienceAlarmProviderPreference;
  leadSeconds: ScienceAlarmLead;
  kacAction: ScienceAlarmAction;
}

export const DEFAULT_SCIENCE_ALARM_SETTINGS: ScienceAlarmDefaults = {
  provider: "auto",
  leadSeconds: 3600,
  kacAction: "kill_warp",
};

export const SCIENCE_ALARM_ACTIONS: readonly { label: string; value: ScienceAlarmAction }[] = [
  { label: "KILL WARP", value: "kill_warp" },
  { label: "PAUSE GAME", value: "pause_game" },
  { label: "MESSAGE ONLY", value: "message_only" },
  { label: "DO NOTHING", value: "do_nothing" },
];

export const SCIENCE_ALARM_PROVIDERS: readonly { label: string; value: ScienceAlarmProviderPreference }[] = [
  { label: "AUTO", value: "auto" },
  { label: "KAC", value: "kac" },
  { label: "STOCK", value: "stock" },
];

function isScienceAlarmAction(value: unknown): value is ScienceAlarmAction {
  return SCIENCE_ALARM_ACTIONS.some((action) => action.value === value);
}

export function normalizeScienceAlarmSettings(value: unknown): ScienceAlarmDefaults {
  const parsed = value as Partial<ScienceAlarmDefaults> | null;
  return {
    provider: parsed?.provider === "kac" || parsed?.provider === "stock" ? parsed.provider : "auto",
    leadSeconds: parsed?.leadSeconds === 1800 ? 1800 : 3600,
    kacAction: isScienceAlarmAction(parsed?.kacAction) ? parsed!.kacAction : "kill_warp",
  };
}

export function readScienceAlarmSettings(storage: Storage | undefined = typeof localStorage === "undefined" ? undefined : localStorage): ScienceAlarmDefaults {
  if (!storage) return DEFAULT_SCIENCE_ALARM_SETTINGS;
  try {
    return normalizeScienceAlarmSettings(JSON.parse(storage.getItem(SCIENCE_ALARM_SETTINGS_KEY) ?? "null"));
  } catch {
    return DEFAULT_SCIENCE_ALARM_SETTINGS;
  }
}

export function persistScienceAlarmSettings(settings: ScienceAlarmDefaults, storage: Storage | undefined = typeof localStorage === "undefined" ? undefined : localStorage) {
  if (!storage) return;
  try {
    storage.setItem(SCIENCE_ALARM_SETTINGS_KEY, JSON.stringify(normalizeScienceAlarmSettings(settings)));
  } catch {
    // Private browsing and embedded webviews may deny optional local storage.
  }
}

export type SettingsSection = "preferences" | "features-mods" | "help" | "about" | "science-alarms";

export const SETTINGS_SECTIONS: readonly { id: SettingsSection; label: string }[] = [
  { id: "preferences", label: "Preferences" },
  { id: "features-mods", label: "Features & Mods" },
  { id: "help", label: "Help" },
  { id: "about", label: "About" },
];

interface SettingsContextValue {
  open: boolean;
  section: SettingsSection;
  scienceAlarmSettings: ScienceAlarmDefaults;
  themeId: ThemeId;
  closeSettings(): void;
  openSettings(section?: SettingsSection): void;
  selectSection(section: SettingsSection): void;
  updateTheme(themeId: ThemeId): void;
  updateScienceAlarmSettings(next: Partial<ScienceAlarmDefaults> | ScienceAlarmDefaults): void;
}

const fallbackSettings: SettingsContextValue = {
  open: false,
  section: "preferences",
  scienceAlarmSettings: DEFAULT_SCIENCE_ALARM_SETTINGS,
  themeId: "mission-control-dark",
  closeSettings() {},
  openSettings() {},
  selectSection() {},
  updateTheme() {},
  updateScienceAlarmSettings() {},
};

const SettingsContext = createContext<SettingsContextValue>(fallbackSettings);

export function SettingsProvider({ children }: PropsWithChildren) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>("preferences");
  const [scienceAlarmSettings, setScienceAlarmSettings] = useState(readScienceAlarmSettings);
  const [themeId, setThemeId] = useState(loadThemeId);

  const closeSettings = useCallback(() => setOpen(false), []);
  const openSettings = useCallback((nextSection: SettingsSection = "preferences") => {
    setSection(nextSection);
    setOpen(true);
  }, []);
  const selectSection = useCallback((nextSection: SettingsSection) => setSection(nextSection), []);
  const updateTheme = useCallback((nextThemeId: ThemeId) => {
    setThemeId(selectTheme(nextThemeId));
  }, []);
  const updateScienceAlarmSettings = useCallback((next: Partial<ScienceAlarmDefaults> | ScienceAlarmDefaults) => {
    setScienceAlarmSettings((current) => {
      const merged = normalizeScienceAlarmSettings({ ...current, ...next });
      persistScienceAlarmSettings(merged);
      return merged;
    });
  }, []);

  const value = useMemo<SettingsContextValue>(() => ({
    closeSettings,
    open,
    openSettings,
    scienceAlarmSettings,
    section,
    selectSection,
    themeId,
    updateTheme,
    updateScienceAlarmSettings,
  }), [closeSettings, open, openSettings, scienceAlarmSettings, section, selectSection, themeId, updateScienceAlarmSettings, updateTheme]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  return useContext(SettingsContext);
}

export function useScienceAlarmSettings() {
  const { scienceAlarmSettings, updateScienceAlarmSettings } = useSettings();
  return { scienceAlarmSettings, updateScienceAlarmSettings };
}
