export const COLLAB_PARTICIPANT_COLORS_STORAGE_KEY = "logicCircuit.collab.participantColors";
export const MAX_STORED_PARTICIPANT_COLORS = 200;

// Kuratierte, kontraststarke Standard-Farbpalette für lokale Teilnehmerfarben
export const COLLAB_PARTICIPANT_COLOR_PALETTE = [
  "#2563eb",
  "#dc2626",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#4f46e5",
  "#0d9488",
  "#e11d48",
] as const;

export type CollabParticipantColorMap = Record<string, string>;

export type CollabColorParticipantInput = {
  peerId: string;
  displayName: string;
  isSelf?: boolean;
};

export type CollabParticipantColorStore = {
  syncParticipants: (participants: ReadonlyArray<CollabColorParticipantInput>) => CollabParticipantColorMap;
  getColorForPeer: (peerId: string, fallbackDisplayName?: string) => string;
  getColorForName: (displayName: string) => string | null;
  setColorForPeer: (peerId: string, color: string) => boolean;
  setColorForName: (displayName: string, color: string) => boolean;
  removeColorForName: (displayName: string) => boolean;
  clearAllColors: () => void;
  reloadFromStorage: () => CollabParticipantColorMap;
  getDictionary: () => CollabParticipantColorMap;
  clearPeerRuntimeState: () => void;
};

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

// Normalisiert einen Anzeigenamen als Schlüssel für das lokale Name-Farbe-Dictionary
export function normalizeParticipantColorKey(displayName: string): string {
  return displayName.trim().toLowerCase();
}

// Formatiert einen gespeicherten Namen für die Anzeige wortweise im Title-Case ("mr. foo" -> "Mr. Foo")
export function formatStoredParticipantDisplayName(rawName: string): string {
  const trimmed = rawName.trim();
  if (trimmed.length === 0) {
    return "";
  }
  return trimmed
    .split(/\s+/)
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase())
    .join(" ");
}

// Validiert und normalisiert einen 6-stelligen Hex-Farbwert (#rrggbb)
export function normalizeHexColor(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

function hashName(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pruneColorDictionary(dict: CollabParticipantColorMap): CollabParticipantColorMap {
  const entries = Object.entries(dict);
  if (entries.length <= MAX_STORED_PARTICIPANT_COLORS) {
    return { ...dict };
  }
  const kept = entries.slice(entries.length - MAX_STORED_PARTICIPANT_COLORS);
  return Object.fromEntries(kept);
}

// Lädt das lokale Name-Farbe-Dictionary aus localStorage mit Bereinigung ungültiger Einträge
export function loadParticipantColorDictionary(
  storageKey = COLLAB_PARTICIPANT_COLORS_STORAGE_KEY,
): CollabParticipantColorMap {
  if (typeof window === "undefined" || !window.localStorage) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: CollabParticipantColorMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const normalizedKey = normalizeParticipantColorKey(key);
      const normalizedColor = normalizeHexColor(value);
      if (normalizedKey.length > 0 && normalizedColor) {
        result[normalizedKey] = normalizedColor;
      }
    }
    return pruneColorDictionary(result);
  } catch {
    return {};
  }
}

// Speichert das lokale Name-Farbe-Dictionary begrenzt im localStorage
export function saveParticipantColorDictionary(
  dictionary: CollabParticipantColorMap,
  storageKey = COLLAB_PARTICIPANT_COLORS_STORAGE_KEY,
): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    const sanitized: CollabParticipantColorMap = {};
    for (const [key, value] of Object.entries(dictionary)) {
      const normalizedKey = normalizeParticipantColorKey(key);
      const normalizedColor = normalizeHexColor(value);
      if (normalizedKey.length > 0 && normalizedColor) {
        sanitized[normalizedKey] = normalizedColor;
      }
    }
    const pruned = pruneColorDictionary(sanitized);
    window.localStorage.setItem(storageKey, JSON.stringify(pruned));
  } catch {
    // Speicherfehler (z. B. Private Mode oder Quota) still ignorieren
  }
}

// Berechnet eine kontrastreiche Textfarbe (#111827 oder #ffffff) für farbige Teilnehmer-Badges
export function getParticipantContrastTextColor(hexColor: string): string {
  const normalized = normalizeHexColor(hexColor);
  if (!normalized) {
    return "#ffffff";
  }
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111827" : "#ffffff";
}

// Wählt für einen unbekannten Namen deterministisch eine möglichst noch freie Palettenfarbe
export function pickAutoParticipantColor(usedColors: ReadonlySet<string>, seedName: string): string {
  const palette = COLLAB_PARTICIPANT_COLOR_PALETTE;
  const startIndex = hashName(normalizeParticipantColorKey(seedName) || seedName) % palette.length;

  for (let offset = 0; offset < palette.length; offset += 1) {
    const candidate = palette[(startIndex + offset) % palette.length];
    if (!usedColors.has(candidate)) {
      return candidate;
    }
  }

  return palette[startIndex];
}

// Erstellt einen lokalen Teilnehmer-Farbmanager mit Rename-Nachführung über stabile peerIds
export function createCollabParticipantColorStore(
  options: { storageKey?: string } = {},
): CollabParticipantColorStore {
  const storageKey = options.storageKey ?? COLLAB_PARTICIPANT_COLORS_STORAGE_KEY;
  let dictionary: CollabParticipantColorMap = loadParticipantColorDictionary(storageKey);
  const knownPeerNames = new Map<string, string>();
  const activePeerColors = new Map<string, string>();

  const persist = () => {
    dictionary = pruneColorDictionary(dictionary);
    saveParticipantColorDictionary(dictionary, storageKey);
  };

  const syncParticipants = (
    participants: ReadonlyArray<CollabColorParticipantInput>,
  ): CollabParticipantColorMap => {
    const remoteParticipants = participants.filter((participant) => !participant.isSelf);
    let dictChanged = false;
    const activePeerIds = new Set<string>();
    const activeNewKeys = new Set<string>();

    for (const participant of remoteParticipants) {
      activePeerIds.add(participant.peerId);
      const newKey = normalizeParticipantColorKey(participant.displayName);
      if (newKey.length > 0) {
        activeNewKeys.add(newKey);
      }
    }

    // Zuerst Namensänderungen über die stabile peerId erkennen und lokale Farbe ohne Sprung umziehen
    const renamedOldKeysToMaybeClean: string[] = [];
    for (const participant of remoteParticipants) {
      const prevKey = knownPeerNames.get(participant.peerId);
      const newKey = normalizeParticipantColorKey(participant.displayName);
      if (!prevKey || newKey.length === 0 || prevKey === newKey) {
        continue;
      }

      const activeColor = activePeerColors.get(participant.peerId) ?? dictionary[prevKey];
      if (activeColor) {
        if (dictionary[newKey] !== activeColor) {
          dictionary[newKey] = activeColor;
          dictChanged = true;
        }
        activePeerColors.set(participant.peerId, activeColor);
      }
      knownPeerNames.set(participant.peerId, newKey);
      renamedOldKeysToMaybeClean.push(prevKey);
    }

    // Alten Namensschlüssel nur dann entfernen, wenn kein anderer aktiver Teilnehmer ihn nutzt
    for (const oldKey of renamedOldKeysToMaybeClean) {
      if (!activeNewKeys.has(oldKey) && Object.prototype.hasOwnProperty.call(dictionary, oldKey)) {
        delete dictionary[oldKey];
        dictChanged = true;
      }
    }

    // Verlassene Peers nur aus der Laufzeit-Zuordnung entfernen; Dictionary bleibt für Rejoin erhalten
    for (const existingPeerId of Array.from(knownPeerNames.keys())) {
      if (!activePeerIds.has(existingPeerId)) {
        knownPeerNames.delete(existingPeerId);
        activePeerColors.delete(existingPeerId);
      }
    }

    const usedColors = new Set<string>();
    for (const color of activePeerColors.values()) {
      usedColors.add(color);
    }
    for (const participant of remoteParticipants) {
      const key = normalizeParticipantColorKey(participant.displayName);
      if (key.length > 0 && dictionary[key]) {
        usedColors.add(dictionary[key]);
      }
    }

    for (const participant of remoteParticipants) {
      const key = normalizeParticipantColorKey(participant.displayName);
      if (key.length === 0) {
        continue;
      }

      knownPeerNames.set(participant.peerId, key);

      const storedColor = dictionary[key];
      if (storedColor) {
        activePeerColors.set(participant.peerId, storedColor);
        usedColors.add(storedColor);
        continue;
      }

      const existingActiveColor = activePeerColors.get(participant.peerId);
      const chosenColor = existingActiveColor ?? pickAutoParticipantColor(usedColors, key);
      dictionary[key] = chosenColor;
      activePeerColors.set(participant.peerId, chosenColor);
      usedColors.add(chosenColor);
      dictChanged = true;
    }

    if (dictChanged) {
      persist();
    }

    return { ...dictionary };
  };

  const setColorForName = (displayName: string, color: string): boolean => {
    const key = normalizeParticipantColorKey(displayName);
    const normalizedColor = normalizeHexColor(color);
    if (key.length === 0 || !normalizedColor) {
      return false;
    }
    dictionary[key] = normalizedColor;
    for (const [peerId, peerKey] of knownPeerNames.entries()) {
      if (peerKey === key) {
        activePeerColors.set(peerId, normalizedColor);
      }
    }
    persist();
    return true;
  };

  const setColorForPeer = (peerId: string, color: string): boolean => {
    const normalizedColor = normalizeHexColor(color);
    if (!normalizedColor) {
      return false;
    }
    const key = knownPeerNames.get(peerId);
    if (!key) {
      return false;
    }
    dictionary[key] = normalizedColor;
    activePeerColors.set(peerId, normalizedColor);
    persist();
    return true;
  };

  const getColorForName = (displayName: string): string | null => {
    const key = normalizeParticipantColorKey(displayName);
    if (key.length === 0) {
      return null;
    }
    return dictionary[key] ?? null;
  };

  const getColorForPeer = (peerId: string, fallbackDisplayName?: string): string => {
    const active = activePeerColors.get(peerId);
    if (active) {
      return active;
    }
    const knownKey = knownPeerNames.get(peerId);
    if (knownKey && dictionary[knownKey]) {
      return dictionary[knownKey];
    }
    if (fallbackDisplayName) {
      const fallbackKey = normalizeParticipantColorKey(fallbackDisplayName);
      if (fallbackKey.length > 0 && dictionary[fallbackKey]) {
        return dictionary[fallbackKey];
      }
    }
    return pickAutoParticipantColor(new Set(), fallbackDisplayName ?? peerId);
  };

  const removeColorForName = (displayName: string): boolean => {
    const key = normalizeParticipantColorKey(displayName);
    if (key.length === 0 || !Object.prototype.hasOwnProperty.call(dictionary, key)) {
      return false;
    }
    delete dictionary[key];
    persist();
    return true;
  };

  const clearAllColors = (): void => {
    dictionary = {};
    persist();
  };

  const reloadFromStorage = (): CollabParticipantColorMap => {
    dictionary = loadParticipantColorDictionary(storageKey);
    const usedColors = new Set<string>(Object.values(dictionary));
    let dictChanged = false;
    for (const [peerId, key] of knownPeerNames.entries()) {
      if (dictionary[key]) {
        activePeerColors.set(peerId, dictionary[key]);
      } else {
        const freshColor = pickAutoParticipantColor(usedColors, key);
        dictionary[key] = freshColor;
        activePeerColors.set(peerId, freshColor);
        usedColors.add(freshColor);
        dictChanged = true;
      }
    }
    if (dictChanged) {
      persist();
    }
    return { ...dictionary };
  };

  const getDictionary = (): CollabParticipantColorMap => ({ ...dictionary });

  const clearPeerRuntimeState = (): void => {
    knownPeerNames.clear();
    activePeerColors.clear();
  };

  return {
    syncParticipants,
    getColorForPeer,
    getColorForName,
    setColorForPeer,
    setColorForName,
    removeColorForName,
    clearAllColors,
    reloadFromStorage,
    getDictionary,
    clearPeerRuntimeState,
  };
}
