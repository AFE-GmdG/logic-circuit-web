export const SIDECAR_URL_STORAGE_KEY = "logicCircuit.sidecar.baseUrl";
export const DEFAULT_LOCAL_SIDECAR_URL = "http://localhost:3001";
export const SIDECAR_SETTINGS_CHANGED_EVENT = "logic-circuit:sidecar-settings-changed";

// Informiert offene UI-Komponenten (z. B. StatusBar) über Änderungen an Sidecar-URL oder MCP-Access-Key
export function notifySidecarSettingsChanged(): void {
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function" &&
    typeof CustomEvent === "function"
  ) {
    window.dispatchEvent(new CustomEvent(SIDECAR_SETTINGS_CHANGED_EVENT));
  }
}

export type SidecarUrlValidationStatus =
  | "empty"
  | "valid-same-origin"
  | "valid-localhost"
  | "valid-https-remote"
  | "mixed-content-blocked"
  | "invalid-protocol"
  | "invalid-url";

export type SidecarUrlValidationResult = {
  ok: boolean;
  normalizedUrl: string;
  status: SidecarUrlValidationStatus;
  isLocalhost: boolean;
  isMixedContent: boolean;
  error: string | null;
};

type PageLocationLike = {
  protocol: string;
  host?: string;
  origin?: string;
};

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Prüft, ob die App im Custom-Sidecar-Opt-in-Modus (z. B. GitHub Pages) ohne eigenen Server-Host läuft
export function isCustomSidecarRequired(): boolean {
  const envFlag: unknown = process.env.SIDECAR_CUSTOM_ONLY;
  if (envFlag === true || envFlag === "true" || envFlag === "1") {
    return true;
  }
  const metaEnv = (import.meta as { env?: Record<string, unknown> }).env;
  const rawFlag = metaEnv?.VITE_SIDECAR_CUSTOM_ONLY;
  return rawFlag === true || rawFlag === "true" || rawFlag === "1";
}

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.trim().toLowerCase());
}

// Validiert und normalisiert eine konfigurierte Sidecar-Basis-URL inkl. Mixed-Content-Prüfung
export function validateSidecarBaseUrl(
  rawUrl: string,
  pageLocation?: PageLocationLike,
): SidecarUrlValidationResult {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return {
      ok: true,
      normalizedUrl: "",
      status: "empty",
      isLocalhost: false,
      isMixedContent: false,
      error: null,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      normalizedUrl: "",
      status: "invalid-url",
      isLocalhost: false,
      isMixedContent: false,
      error: "Ungültige Sidecar-URL. Erwartet wird z. B. http://localhost:3001 oder https://sidecar.example.com.",
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      normalizedUrl: "",
      status: "invalid-protocol",
      isLocalhost: false,
      isMixedContent: false,
      error: "Nur http:// oder https:// sind als Sidecar-Protokoll zulässig.",
    };
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return {
      ok: false,
      normalizedUrl: "",
      status: "invalid-url",
      isLocalhost: false,
      isMixedContent: false,
      error: "Die Sidecar-URL darf keine eingebetteten Zugangsdaten enthalten.",
    };
  }

  const cleanPath = parsed.pathname.replace(/\/+$/, "");
  const normalizedUrl = `${parsed.origin}${cleanPath}`;
  const isLocalhost = isLoopbackHostname(parsed.hostname);
  const loc = pageLocation ?? (typeof window !== "undefined" && window.location ? window.location : undefined);

  if (loc?.protocol === "https:" && parsed.protocol === "http:" && !isLocalhost) {
    return {
      ok: false,
      normalizedUrl,
      status: "mixed-content-blocked",
      isLocalhost: false,
      isMixedContent: true,
      error: "Auf einer HTTPS-Seite sind unverschlüsselte http://-Ziele nur für localhost erlaubt. Bitte https:// verwenden.",
    };
  }

  const pageOrigin = loc?.origin ?? (loc?.host ? `${loc.protocol}//${loc.host}` : undefined);
  const status: SidecarUrlValidationStatus = pageOrigin && parsed.origin === pageOrigin
    ? "valid-same-origin"
    : isLocalhost
      ? "valid-localhost"
      : "valid-https-remote";

  return {
    ok: true,
    normalizedUrl,
    status,
    isLocalhost,
    isMixedContent: false,
    error: null,
  };
}

// Lädt die optional konfigurierte Sidecar-Basis-URL ausschließlich lokal aus dem Browser-Storage
export function loadSidecarBaseUrl(storageKey = SIDECAR_URL_STORAGE_KEY): string {
  if (typeof window === "undefined" || !window.localStorage) {
    return "";
  }
  try {
    return (window.localStorage.getItem(storageKey) ?? "").trim();
  } catch {
    return "";
  }
}

// Speichert oder löscht die benutzerdefinierte Sidecar-Basis-URL lokal im Browser-Storage
export function saveSidecarBaseUrl(rawUrl: string, storageKey = SIDECAR_URL_STORAGE_KEY): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    const trimmed = rawUrl.trim();
    if (trimmed.length === 0) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    const validation = validateSidecarBaseUrl(trimmed);
    const valueToStore = validation.normalizedUrl || trimmed;
    window.localStorage.setItem(storageKey, valueToStore);
    notifySidecarSettingsChanged();
  } catch {
    // Speicherfehler (z. B. Private Mode) still ignorieren
  }
}

// Entfernt die gespeicherte Sidecar-Basis-URL aus dem Browser-Storage
export function clearSidecarBaseUrl(storageKey = SIDECAR_URL_STORAGE_KEY): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.removeItem(storageKey);
    notifySidecarSettingsChanged();
  } catch {
    // Speicherfehler still ignorieren
  }
}

// Ermittelt die wirksame Sidecar-Basis-URL; liefert im Pages-Opt-in-Modus ohne URL null (null Traffic)
export function resolveEffectiveSidecarBaseUrl(options: {
  customBaseUrl?: string;
  customOnlyOverride?: boolean;
  location?: { protocol: string; host: string; origin?: string };
} = {}): string | null {
  const rawCandidate = options.customBaseUrl !== undefined
    ? options.customBaseUrl
    : loadSidecarBaseUrl();
  const trimmed = rawCandidate.trim();

  if (trimmed.length > 0) {
    const validation = validateSidecarBaseUrl(trimmed, options.location);
    return validation.ok ? validation.normalizedUrl : null;
  }

  const customOnly = options.customOnlyOverride ?? isCustomSidecarRequired();
  if (customOnly) {
    return null;
  }

  const fallbackLoc = { protocol: "http:", host: "localhost" };
  const loc = options.location ?? (typeof window !== "undefined" && window.location ? window.location : fallbackLoc);
  const protocol = loc.protocol || fallbackLoc.protocol;
  const host = loc.host || fallbackLoc.host;
  return `${protocol}//${host}`;
}

// Wandelt eine http(s)-Sidecar-Basis-URL in die passende ws(s)-Ziel-URL um
export function toWebSocketUrl(baseUrl: string, wsPath: string): string {
  const parsed = new URL(baseUrl);
  const wsProtocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  const cleanBasePath = parsed.pathname.replace(/\/+$/, "");
  const cleanWsPath = wsPath.startsWith("/") ? wsPath : `/${wsPath}`;
  return `${wsProtocol}//${parsed.host}${cleanBasePath}${cleanWsPath}`;
}
