export const COLLAB_ACCESS_KEY_STORAGE_KEY = "logicCircuit.collab.accessKey";
export const COLLAB_DISPLAY_NAME_STORAGE_KEY = "logicCircuit.collab.displayName";
const MAX_STORED_DISPLAY_NAME_LENGTH = 64;

// Lädt den optionalen Host-Zugangsschlüssel (COLLAB_ACCESS_KEY) ausschließlich lokal aus dem Browser-Storage
export function loadCollabAccessKey(storageKey = COLLAB_ACCESS_KEY_STORAGE_KEY): string {
  if (typeof window === "undefined" || !window.localStorage) {
    return "";
  }
  try {
    return window.localStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}

// Speichert den optionalen Host-Zugangsschlüssel lokal im Browser-Storage
export function saveCollabAccessKey(accessKey: string, storageKey = COLLAB_ACCESS_KEY_STORAGE_KEY): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    const trimmed = accessKey.trim();
    if (trimmed.length === 0) {
      window.localStorage.removeItem(storageKey);
    } else {
      window.localStorage.setItem(storageKey, trimmed);
    }
  } catch {
    // Speicherfehler (z. B. Private Mode) still ignorieren
  }
}

// Entfernt den gespeicherten Host-Zugangsschlüssel aus dem Browser-Storage
export function clearCollabAccessKey(storageKey = COLLAB_ACCESS_KEY_STORAGE_KEY): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Speicherfehler still ignorieren
  }
}

// Lädt den zuletzt verwendeten Pflicht-Anzeigenamen aus dem Browser-Storage
export function loadCollabDisplayName(storageKey = COLLAB_DISPLAY_NAME_STORAGE_KEY): string {
  if (typeof window === "undefined" || !window.localStorage) {
    return "";
  }
  try {
    return (window.localStorage.getItem(storageKey) ?? "").trim().slice(0, MAX_STORED_DISPLAY_NAME_LENGTH);
  } catch {
    return "";
  }
}

// Speichert den Pflicht-Anzeigenamen (max. 64 Zeichen) lokal im Browser-Storage
export function saveCollabDisplayName(displayName: string, storageKey = COLLAB_DISPLAY_NAME_STORAGE_KEY): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    const normalized = displayName.trim().slice(0, MAX_STORED_DISPLAY_NAME_LENGTH);
    if (normalized.length === 0) {
      window.localStorage.removeItem(storageKey);
    } else {
      window.localStorage.setItem(storageKey, normalized);
    }
  } catch {
    // Speicherfehler still ignorieren
  }
}

// Entfernt den gespeicherten Anzeigenamen aus dem Browser-Storage
export function clearCollabDisplayName(storageKey = COLLAB_DISPLAY_NAME_STORAGE_KEY): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Speicherfehler still ignorieren
  }
}
