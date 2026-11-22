import type FindPreferences from "../types/find/findPreferences";
import type FindScope from "../types/find/findScope";

export const FIND_PREFERENCES_STORAGE_KEY = "logicCircuit.find.preferences";
export const MAX_RECENT_FIND_QUERIES = 10;

export const DEFAULT_FIND_PREFERENCES: FindPreferences = {
  scope: "project",
  matchCase: false,
  wholeWord: false,
  includeNotes: false,
  recentQueries: [],
};

function isValidFindScope(value: unknown): value is FindScope {
  return value === "project" || value === "current";
}

// Normalisiert eine persistierte LRU-Suchliste (nicht-leer, eindeutig, maximal maxItems Einträge)
export function normalizeRecentFindQueries(
  raw: unknown,
  maxItems = MAX_RECENT_FIND_QUERIES,
): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const limit = Math.max(0, Math.floor(maxItems));
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
    if (normalized.length >= limit) {
      break;
    }
  }

  return normalized;
}

// Lädt Suchoptionen und LRU-Suchverlauf robust aus localStorage
export function loadFindPreferences(
  storageKey = FIND_PREFERENCES_STORAGE_KEY,
): FindPreferences {
  if (typeof window === "undefined" || !window.localStorage) {
    return {
      ...DEFAULT_FIND_PREFERENCES,
      recentQueries: [],
    };
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return {
        ...DEFAULT_FIND_PREFERENCES,
        recentQueries: [],
      };
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ...DEFAULT_FIND_PREFERENCES,
        recentQueries: [],
      };
    }

    const record = parsed as Record<string, unknown>;
    return {
      scope: isValidFindScope(record.scope) ? record.scope : DEFAULT_FIND_PREFERENCES.scope,
      matchCase:
        typeof record.matchCase === "boolean"
          ? record.matchCase
          : DEFAULT_FIND_PREFERENCES.matchCase,
      wholeWord:
        typeof record.wholeWord === "boolean"
          ? record.wholeWord
          : DEFAULT_FIND_PREFERENCES.wholeWord,
      includeNotes:
        typeof record.includeNotes === "boolean"
          ? record.includeNotes
          : DEFAULT_FIND_PREFERENCES.includeNotes,
      recentQueries: normalizeRecentFindQueries(record.recentQueries),
    };
  } catch {
    return {
      ...DEFAULT_FIND_PREFERENCES,
      recentQueries: [],
    };
  }
}

// Speichert Suchoptionen und LRU-Suchverlauf in localStorage
export function saveFindPreferences(
  preferences: FindPreferences,
  storageKey = FIND_PREFERENCES_STORAGE_KEY,
): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    const sanitized: FindPreferences = {
      scope: isValidFindScope(preferences.scope)
        ? preferences.scope
        : DEFAULT_FIND_PREFERENCES.scope,
      matchCase: Boolean(preferences.matchCase),
      wholeWord: Boolean(preferences.wholeWord),
      includeNotes: Boolean(preferences.includeNotes),
      recentQueries: normalizeRecentFindQueries(preferences.recentQueries),
    };
    window.localStorage.setItem(storageKey, JSON.stringify(sanitized));
  } catch {
    // Speicherfehler (z. B. Private Mode oder Quota) still ignorieren
  }
}

// Fügt einen Suchbegriff an den Anfang der LRU-Liste ein und begrenzt die Größe auf maxItems
export function pushRecentFindQuery(
  recentQueries: readonly string[],
  query: string,
  maxItems = MAX_RECENT_FIND_QUERIES,
): string[] {
  const trimmed = query.trim();
  const existing = normalizeRecentFindQueries(recentQueries, maxItems);
  if (!trimmed) {
    return existing;
  }

  const limit = Math.max(0, Math.floor(maxItems));
  const filtered = existing.filter((entry) => entry !== trimmed);
  return [trimmed, ...filtered].slice(0, limit);
}

// Entfernt einen einzelnen Suchbegriff aus der LRU-Liste
export function removeRecentFindQuery(
  recentQueries: readonly string[],
  query: string,
): string[] {
  const trimmed = query.trim();
  return normalizeRecentFindQueries(recentQueries).filter((entry) => entry !== trimmed);
}
