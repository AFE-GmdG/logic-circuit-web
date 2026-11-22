import type CircuitProject from "../types/circuit/circuitProject";
import type AppLanguage from "../types/settings/appLanguage";
import type AppSettings from "../types/settings/appSettings";
import type StartupProjectMode from "../types/settings/startupProjectMode";
import type FrameRateLimit from "../types/simulation/frameRateLimit";

import { AUTO_LANGUAGE, normalizeSupportedLanguage } from "../i18n";

import { AUDIO_DEFAULT_VOLUME } from "./audioPitchTable";
import { CLOCK_FREQUENCY_STEPS } from "./simulationSpeed";

export const APP_SETTINGS_STORAGE_KEY = "logicCircuit.app.settings";

export const DEFAULT_APP_SETTINGS: AppSettings = {
  startupProjectMode: "demo",
  defaultFrequency: 30,
  language: AUTO_LANGUAGE,
  audioVolume: AUDIO_DEFAULT_VOLUME,
  audioMuted: false,
};

function isValidStartupProjectMode(value: unknown): value is StartupProjectMode {
  return value === "empty" || value === "demo" || value === "last";
}

function isValidDefaultFrequency(value: unknown): value is FrameRateLimit {
  if (value === "max") {
    return true;
  }
  return typeof value === "number" && (CLOCK_FREQUENCY_STEPS as readonly number[]).includes(value);
}

function normalizeAppLanguage(value: unknown): AppLanguage {
  if (value === AUTO_LANGUAGE) {
    return AUTO_LANGUAGE;
  }
  return normalizeSupportedLanguage(value) ?? DEFAULT_APP_SETTINGS.language;
}

function normalizeAudioVolume(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(100, Math.max(0, Math.round(value)));
  }
  return DEFAULT_APP_SETTINGS.audioVolume;
}

// Lädt globale Anwendungseinstellungen robust aus localStorage mit Fallback auf Standardwerte
export function loadAppSettings(storageKey = APP_SETTINGS_STORAGE_KEY): AppSettings {
  if (typeof window === "undefined" || !window.localStorage) {
    return { ...DEFAULT_APP_SETTINGS };
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return { ...DEFAULT_APP_SETTINGS };
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_APP_SETTINGS };
    }

    const record = parsed as Record<string, unknown>;
    return {
      startupProjectMode: isValidStartupProjectMode(record.startupProjectMode)
        ? record.startupProjectMode
        : DEFAULT_APP_SETTINGS.startupProjectMode,
      defaultFrequency: isValidDefaultFrequency(record.defaultFrequency)
        ? record.defaultFrequency
        : DEFAULT_APP_SETTINGS.defaultFrequency,
      language: normalizeAppLanguage(record.language),
      audioVolume: normalizeAudioVolume(record.audioVolume),
      audioMuted:
        typeof record.audioMuted === "boolean"
          ? record.audioMuted
          : DEFAULT_APP_SETTINGS.audioMuted,
    };
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

// Speichert globale Anwendungseinstellungen in localStorage
export function saveAppSettings(
  settings: AppSettings,
  storageKey = APP_SETTINGS_STORAGE_KEY,
): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(settings));
  } catch {
    // Speicherfehler (z. B. Private Mode oder Quota) still ignorieren
  }
}

// Überträgt die Standard-Taktfrequenz aus den Systemeinstellungen auf ein neu angelegtes Projekt
export function applyDefaultFrequencyToProject(
  project: CircuitProject,
  defaultFrequency: FrameRateLimit,
): CircuitProject {
  const isMaximumSpeed = defaultFrequency === "max";
  const frequency = isMaximumSpeed ? 30 : defaultFrequency;

  if (
    project.project.frequency === frequency &&
    project.project.isMaximumSpeed === isMaximumSpeed
  ) {
    return project;
  }

  return {
    ...project,
    project: {
      ...project.project,
      frequency,
      isMaximumSpeed,
    },
  };
}
