import type CircuitProject from "../types/circuit/circuitProject";
import type AppLanguage from "../types/settings/appLanguage";
import type AppSettings from "../types/settings/appSettings";
import type CollabCursorIdleTimeoutSec from "../types/settings/collabCursorIdleTimeout";
import {
  COLLAB_CURSOR_IDLE_TIMEOUT_OPTIONS,
  DEFAULT_COLLAB_CURSOR_IDLE_TIMEOUT_SEC,
} from "../types/settings/collabCursorIdleTimeout";
import type CollabCursorVisibilityMode from "../types/settings/collabCursorVisibilityMode";
import {
  COLLAB_CURSOR_VISIBILITY_MODES,
  DEFAULT_COLLAB_CURSOR_VISIBILITY_MODE,
} from "../types/settings/collabCursorVisibilityMode";
import type StartupProjectMode from "../types/settings/startupProjectMode";
import type FrameRateLimit from "../types/simulation/frameRateLimit";

import { AUTO_LANGUAGE, normalizeSupportedLanguage } from "../i18n";

import { AUDIO_DEFAULT_VOLUME } from "./audioPitchTable";
import { parseStunUrls } from "./collabIceConfig";
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

function normalizeCollabStunUrls(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const stringEntries = value.filter((item): item is string => typeof item === "string");
  const parsed = parseStunUrls(stringEntries);
  return parsed.validUrls.length > 0 ? parsed.validUrls : undefined;
}

// Prüft, ob ein Wert einer der festen Einzelauswahlen für die Cursor-Inaktivitätszeit entspricht
export function normalizeCollabCursorIdleTimeoutSec(value: unknown): CollabCursorIdleTimeoutSec | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return undefined;
  }
  return (COLLAB_CURSOR_IDLE_TIMEOUT_OPTIONS as readonly number[]).includes(value)
    ? (value as CollabCursorIdleTimeoutSec)
    : undefined;
}

// Liefert die wirksame Cursor-Ausblendzeit in Sekunden mit Fallback auf den Standardwert (10 s)
export function resolveCollabCursorIdleTimeoutSec(value: unknown): CollabCursorIdleTimeoutSec {
  return normalizeCollabCursorIdleTimeoutSec(value) ?? DEFAULT_COLLAB_CURSOR_IDLE_TIMEOUT_SEC;
}

// Prüft, ob ein Wert einem der gültigen Cursor-Sichtbarkeitsmodi entspricht
export function normalizeCollabCursorVisibilityMode(value: unknown): CollabCursorVisibilityMode | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return (COLLAB_CURSOR_VISIBILITY_MODES as readonly string[]).includes(value)
    ? (value as CollabCursorVisibilityMode)
    : undefined;
}

// Liefert den wirksamen Cursor-Sichtbarkeitsmodus mit Fallback auf "all"
export function resolveCollabCursorVisibilityMode(value: unknown): CollabCursorVisibilityMode {
  return normalizeCollabCursorVisibilityMode(value) ?? DEFAULT_COLLAB_CURSOR_VISIBILITY_MODE;
}

// Liefert den i18n-Übersetzungsschlüssel für einen Cursor-Sichtbarkeitsmodus
export function getCursorVisibilityModeTranslationKey(mode: CollabCursorVisibilityMode): string {
  switch (mode) {
    case "all":
      return "dialog.options.collabCursorVisibilityModes.all";
    case "collaborators-and-raised-hand":
      return "dialog.options.collabCursorVisibilityModes.collaboratorsAndRaisedHand";
    case "collaborators":
      return "dialog.options.collabCursorVisibilityModes.collaborators";
    case "raised-hand":
      return "dialog.options.collabCursorVisibilityModes.raisedHand";
  }
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
    const collabStunUrls = normalizeCollabStunUrls(record.collabStunUrls);
    const collabCursorIdleTimeoutSec = normalizeCollabCursorIdleTimeoutSec(record.collabCursorIdleTimeoutSec);
    const collabCursorVisibilityMode = normalizeCollabCursorVisibilityMode(record.collabCursorVisibilityMode);
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
      ...(collabStunUrls ? { collabStunUrls } : {}),
      ...(collabCursorIdleTimeoutSec !== undefined ? { collabCursorIdleTimeoutSec } : {}),
      ...(collabCursorVisibilityMode !== undefined ? { collabCursorVisibilityMode } : {}),
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
    const collabStunUrls = normalizeCollabStunUrls(settings.collabStunUrls);
    const collabCursorIdleTimeoutSec = normalizeCollabCursorIdleTimeoutSec(settings.collabCursorIdleTimeoutSec);
    const collabCursorVisibilityMode = normalizeCollabCursorVisibilityMode(settings.collabCursorVisibilityMode);
    const payload: AppSettings = {
      startupProjectMode: settings.startupProjectMode,
      defaultFrequency: settings.defaultFrequency,
      language: settings.language,
      audioVolume: settings.audioVolume,
      audioMuted: settings.audioMuted,
      ...(collabStunUrls ? { collabStunUrls } : {}),
      ...(collabCursorIdleTimeoutSec !== undefined ? { collabCursorIdleTimeoutSec } : {}),
      ...(collabCursorVisibilityMode !== undefined ? { collabCursorVisibilityMode } : {}),
    };
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
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
