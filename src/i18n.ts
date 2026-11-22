/// <reference types="vite/client" />

import i18n, { type Resource } from "i18next";
import { initReactI18next } from "react-i18next";

import type AppLanguage from "./types/settings/appLanguage";
import type LocaleDescriptor from "./types/settings/localeDescriptor";

export const DEFAULT_LANGUAGE = "en";
export const AUTO_LANGUAGE = "auto";

const APP_SETTINGS_STORAGE_KEY = "logicCircuit.app.settings";
const LOCALE_FILE_PATTERN = /\/([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)\.json$/;

type LocaleCatalog = Record<string, unknown>;

const localeModules = import.meta.glob<LocaleCatalog>("./locales/*.json", {
  eager: true,
  import: "default",
});

function resolveLocaleNativeName(code: string, catalog: LocaleCatalog): string {
  const meta = catalog.meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const rawName = (meta as Record<string, unknown>).nativeName;
    if (typeof rawName === "string" && rawName.trim().length > 0) {
      return rawName.trim();
    }
  }

  try {
    if (typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function") {
      const displayNames = new Intl.DisplayNames([code], { type: "language" });
      const resolved = displayNames.of(code);
      if (resolved && resolved.trim().length > 0) {
        return resolved.charAt(0).toUpperCase() + resolved.slice(1);
      }
    }
  } catch {
    // Ungültige Locale-Tags fallen auf den Code zurück
  }

  return code;
}

const resources: Resource = {};
const canonicalLanguageByLower = new Map<string, string>();
const discoveredLanguages: LocaleDescriptor[] = [];

for (const [filePath, catalog] of Object.entries(localeModules)) {
  const match = filePath.match(LOCALE_FILE_PATTERN);
  if (!match || !catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    continue;
  }

  const code = match[1];
  resources[code] = { translation: catalog };
  canonicalLanguageByLower.set(code.toLowerCase(), code);
  discoveredLanguages.push({
    code,
    nativeName: resolveLocaleNativeName(code, catalog),
  });
}

discoveredLanguages.sort((a, b) => {
  if (a.code === DEFAULT_LANGUAGE) {
    return -1;
  }
  if (b.code === DEFAULT_LANGUAGE) {
    return 1;
  }
  return a.code.localeCompare(b.code);
});

export const AVAILABLE_LANGUAGES: readonly LocaleDescriptor[] = discoveredLanguages;

// Normalisiert eine übergebene Sprachkennung auf eine registrierte Locale-ID oder null
export function normalizeSupportedLanguage(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/_/g, "-").toLowerCase();
  if (!normalized) {
    return null;
  }
  return canonicalLanguageByLower.get(normalized) ?? null;
}

export function isSupportedLanguage(value: unknown): value is string {
  return normalizeSupportedLanguage(value) !== null;
}

// Liefert den lokalisierten Anzeigenamen einer registrierten Sprache
export function getLocaleNativeName(code: string): string {
  const canonical = normalizeSupportedLanguage(code) ?? code;
  const entry = AVAILABLE_LANGUAGES.find((item) => item.code === canonical);
  return entry ? entry.nativeName : canonical;
}

// Ermittelt die passende unterstützte Sprache aus einer Browser-Sprachliste
export function detectBrowserLanguage(browserLanguages?: readonly string[]): string {
  let candidates: readonly string[] = [];

  if (browserLanguages !== undefined) {
    candidates = browserLanguages;
  } else if (typeof window !== "undefined" && window.navigator) {
    if (Array.isArray(window.navigator.languages) && window.navigator.languages.length > 0) {
      candidates = window.navigator.languages;
    } else if (typeof window.navigator.language === "string") {
      candidates = [window.navigator.language];
    }
  }

  for (const rawCandidate of candidates) {
    if (typeof rawCandidate !== "string") {
      continue;
    }
    const normalized = rawCandidate.trim().replace(/_/g, "-");
    if (!normalized) {
      continue;
    }

    const exactMatch = normalizeSupportedLanguage(normalized);
    if (exactMatch) {
      return exactMatch;
    }

    const baseSubtag = normalized.split("-")[0];
    const baseMatch = normalizeSupportedLanguage(baseSubtag);
    if (baseMatch) {
      return baseMatch;
    }
  }

  return DEFAULT_LANGUAGE;
}

// Löst eine gespeicherte Sprachpräferenz ("auto" oder Locale-Code) in eine effektive Sprache auf
export function resolveEffectiveLanguage(
  preference: AppLanguage = AUTO_LANGUAGE,
  browserLanguages?: readonly string[],
): string {
  if (preference !== AUTO_LANGUAGE) {
    const direct = normalizeSupportedLanguage(preference);
    if (direct) {
      return direct;
    }
  }
  return detectBrowserLanguage(browserLanguages);
}

// Wendet eine Sprachpräferenz unmittelbar auf die aktive i18next-Instanz an
export function applyLanguagePreference(preference: AppLanguage): void {
  const target = resolveEffectiveLanguage(preference);
  if (i18n.language !== target) {
    void i18n.changeLanguage(target);
  }
}

function readPersistedLanguagePreference(): AppLanguage {
  if (typeof window === "undefined" || !window.localStorage) {
    return AUTO_LANGUAGE;
  }

  try {
    const raw = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return AUTO_LANGUAGE;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return AUTO_LANGUAGE;
    }
    const rawLanguage = (parsed as Record<string, unknown>).language;
    if (rawLanguage === AUTO_LANGUAGE) {
      return AUTO_LANGUAGE;
    }
    return normalizeSupportedLanguage(rawLanguage) ?? AUTO_LANGUAGE;
  } catch {
    return AUTO_LANGUAGE;
  }
}

function syncDocumentLanguage(language: string): void {
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.lang = language;
  }
}

const initialLanguage = resolveEffectiveLanguage(readPersistedLanguagePreference());

void i18n
  .use(initReactI18next)
  .init({
    fallbackLng: DEFAULT_LANGUAGE,
    lng: initialLanguage,
    returnEmptyString: false,
    returnNull: false,
    interpolation: {
      escapeValue: false,
    },
    resources,
  });

syncDocumentLanguage(i18n.language || initialLanguage);
i18n.on("languageChanged", (nextLanguage) => {
  syncDocumentLanguage(nextLanguage);
});

export default i18n;
