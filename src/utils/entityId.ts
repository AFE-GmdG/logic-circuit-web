// Zentrale, kollisionsfreie UUID-v4-Erzeugung für alle Schaltungsentitäten und Kollaborations-Mutationen

export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatUuidFromBytes(bytes: Uint8Array): string {
  const copy = new Uint8Array(bytes);
  copy[6] = (copy[6] & 0x0f) | 0x40;
  copy[8] = (copy[8] & 0x3f) | 0x80;
  const hex = Array.from(copy, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// Erzeugt eine eindeutige RFC-4122-v4-UUID über Web Crypto API (mit sicherem Fallback)
export function generateEntityUuid(): string {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    if (typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return formatUuidFromBytes(bytes);
    }
  }

  const fallbackBytes = new Uint8Array(16);
  for (let i = 0; i < fallbackBytes.length; i += 1) {
    fallbackBytes[i] = Math.floor(Math.random() * 256);
  }
  return formatUuidFromBytes(fallbackBytes);
}

// Prüft, ob eine ID ein gültiges RFC-4122-UUID-Format besitzt
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}
