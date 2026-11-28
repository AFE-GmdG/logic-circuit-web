import type CollabIceServer from "../types/collab/iceConfig";
import type { CollabNatDiagnosticCode, CollabRuntimeConfig } from "../types/collab/iceConfig";

import {
  COLLAB_CONFIG_PATH,
  COLLAB_WS_PATH,
  DEFAULT_COLLAB_GRACE_PERIOD_MS,
  DEFAULT_COLLAB_INVITE_TTL_MS,
  DEFAULT_COLLAB_STUN_URLS,
} from "../collab/collabEvents";
import { SignalingClientError } from "../collab/signalingClient";

import {
  isCustomSidecarRequired,
  loadSidecarBaseUrl,
  resolveEffectiveSidecarBaseUrl,
  toWebSocketUrl,
  validateSidecarBaseUrl,
} from "./sidecarStorage";

export type ParsedStunUrlsResult = {
  validUrls: string[];
  rejectedUrls: string[];
  hasTurnUrls: boolean;
};

export type CollabConnectionDiagnostic = {
  code: CollabNatDiagnosticCode;
  isRecoverable: boolean;
  turnPlannedHint: boolean;
  details: string;
};

export type IceDiagnosticInput = {
  iceConnectionState: string;
  iceGatheringState?: string;
  gatheredCandidateTypes: ReadonlySet<string>;
  hadSrflxCandidate?: boolean;
  isHostMigration?: boolean;
  signalingUnavailable?: boolean;
};

export type CollabSessionErrorCode =
  | "disabled"
  | "sidecar-required"
  | "unauthorized"
  | "forbidden"
  | "rate-limited"
  | "service-unavailable"
  | "peer-limit-reached"
  | "invite-invalid"
  | "invite-expired"
  | "invite-revoked"
  | "session-not-found"
  | "invalid-display-name"
  | "invalid-sidecar-url"
  | "network-error"
  | "timeout"
  | "unknown";

export type CollabSessionError = {
  code: CollabSessionErrorCode;
  message: string;
  httpStatus?: number;
  retryAfterSeconds?: number;
  requiresSidecarSetup?: boolean;
  requiresAccessKey?: boolean;
};

export type CollabRuntimeConfigPreflightResult =
  | {
    ok: true;
    config: CollabRuntimeConfig;
    effectiveBaseUrl: string;
    authRequired: boolean;
  }
  | {
    ok: false;
    error: CollabSessionError;
    effectiveBaseUrl: string | null;
  };

// Prüft, ob die WebRTC-Kollaboration zur Build-Zeit (z. B. für GitHub Pages) deaktiviert wurde
export function isCollabDisabledByEnv(): boolean {
  const envFlag: unknown = process.env.DISABLE_COLLAB;
  if (envFlag === true || envFlag === "true" || envFlag === "1") {
    return true;
  }
  const metaEnv = (import.meta as { env?: Record<string, unknown> }).env;
  const rawFlag = metaEnv?.VITE_DISABLE_COLLAB;
  return rawFlag === true || rawFlag === "true" || rawFlag === "1";
}

// Prüft, ob eine ICE-URI dem in Ausbaustufe 1 zulässigen STUN-Schema entspricht (kein TURN/TURNS)
export function isValidStunUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0 || /\s/.test(trimmed)) {
    return false;
  }
  const match = trimmed.match(/^(stuns?):([^?]+)(?:\?.*)?$/i);
  if (!match) {
    return false;
  }
  const hostPort = match[2];
  return hostPort.length > 0 && !hostPort.startsWith("//");
}

// Zerlegt und validiert benutzerdefinierte STUN-Einträge ohne TURN-Unterstützung in v1
export function parseStunUrls(raw: string | string[] | undefined): ParsedStunUrlsResult {
  const candidates = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[\n,;]+/)
      : [];

  const validUrls: string[] = [];
  const rejectedUrls: string[] = [];
  const seen = new Set<string>();
  let hasTurnUrls = false;

  for (const entry of candidates) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (/^turns?:/i.test(trimmed)) {
      hasTurnUrls = true;
      rejectedUrls.push(trimmed);
      continue;
    }
    if (!isValidStunUrl(trimmed)) {
      rejectedUrls.push(trimmed);
      continue;
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      validUrls.push(trimmed);
    }
  }

  return {
    validUrls,
    rejectedUrls,
    hasTurnUrls,
  };
}

// Ermittelt die wirksamen WebRTC-ICE-Server (Benutzer-STUN > Server-STUN > Standard-STUN, ohne TURN in v1)
export function resolveCollabIceServers(options: {
  customStunUrls?: string[];
  runtimeConfig?: Partial<CollabRuntimeConfig> | null;
  fallbackStunUrls?: readonly string[];
} = {}): CollabIceServer[] {
  const customParsed = parseStunUrls(options.customStunUrls);
  const runtimeParsed = parseStunUrls(options.runtimeConfig?.stunUrls);
  const fallbackParsed = parseStunUrls(options.fallbackStunUrls ? [...options.fallbackStunUrls] : undefined);

  const selectedUrls = customParsed.validUrls.length > 0
    ? customParsed.validUrls
    : runtimeParsed.validUrls.length > 0
      ? runtimeParsed.validUrls
      : fallbackParsed.validUrls.length > 0
        ? fallbackParsed.validUrls
        : [...DEFAULT_COLLAB_STUN_URLS];

  return selectedUrls.map((url) => ({ urls: url }));
}

export function resolveCollabWsUrl(
  locOrBaseUrl?: { protocol: string; host: string; baseUrl?: string } | string,
): string {
  if (typeof locOrBaseUrl === "string") {
    const effective = resolveEffectiveSidecarBaseUrl({ customBaseUrl: locOrBaseUrl });
    return effective ? toWebSocketUrl(effective, COLLAB_WS_PATH) : "";
  }
  if (locOrBaseUrl?.baseUrl) {
    const effective = resolveEffectiveSidecarBaseUrl({
      customBaseUrl: locOrBaseUrl.baseUrl,
      location: locOrBaseUrl,
    });
    return effective ? toWebSocketUrl(effective, COLLAB_WS_PATH) : "";
  }
  if (locOrBaseUrl) {
    const protocol = locOrBaseUrl.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${locOrBaseUrl.host}${COLLAB_WS_PATH}`;
  }
  const effective = resolveEffectiveSidecarBaseUrl();
  return effective ? toWebSocketUrl(effective, COLLAB_WS_PATH) : "";
}

// Liest Retry-After-Header (Sekunden oder HTTP-Datum) bzw. JSON-Body-Angaben aus
export function parseRetryAfterSeconds(
  headerValue: string | null | undefined,
  bodyRetryAfter?: unknown,
): number | undefined {
  if (typeof bodyRetryAfter === "number" && Number.isFinite(bodyRetryAfter) && bodyRetryAfter > 0) {
    return Math.ceil(bodyRetryAfter);
  }
  if (typeof headerValue !== "string") {
    return undefined;
  }
  const trimmed = headerValue.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10);
    return parsed > 0 ? parsed : undefined;
  }
  const targetMs = Date.parse(trimmed);
  if (!Number.isNaN(targetMs)) {
    const diffSeconds = Math.ceil((targetMs - Date.now()) / 1000);
    return diffSeconds > 0 ? diffSeconds : undefined;
  }
  return undefined;
}

// Bildet Signaling- und Transport-Fehler einheitlich auf strukturierte CollabSessionError-Objekte ab
export function mapSignalingErrorToCollabError(error: unknown): CollabSessionError {
  if (error instanceof SignalingClientError) {
    switch (error.code) {
      case "unauthorized":
        return {
          code: "unauthorized",
          message: error.message || "Ungültiger oder fehlender Zugangsschlüssel (COLLAB_ACCESS_KEY).",
          httpStatus: 401,
          requiresAccessKey: true,
        };
      case "session-limit-reached":
        return {
          code: "service-unavailable",
          message: error.message || "Maximale Anzahl gleichzeitiger Kollaborations-Sessions erreicht.",
          httpStatus: 503,
        };
      case "peer-limit-reached":
        return {
          code: "peer-limit-reached",
          message: error.message || "Die maximale Teilnehmerzahl dieser Session wurde erreicht.",
        };
      case "invite-expired":
        return {
          code: "invite-expired",
          message: error.message || "Der Einladungslink ist abgelaufen (maximal 5 Minuten gültig).",
        };
      case "invite-revoked":
        return {
          code: "invite-revoked",
          message: error.message || "Dieser Einladungslink wurde vom Host vorzeitig widerrufen.",
        };
      case "invite-invalid":
        return {
          code: "invite-invalid",
          message: error.message || "Dieser Einladungslink ist ungültig oder unbekannt.",
        };
      case "session-not-found":
        return {
          code: "session-not-found",
          message: error.message || "Die zugehörige Kollaborations-Session ist nicht mehr aktiv.",
        };
      case "forbidden":
        return {
          code: "forbidden",
          message: error.message || "Diese Aktion ist für diesen Client nicht erlaubt.",
          httpStatus: 403,
        };
      case "timeout":
        return {
          code: "timeout",
          message: error.message || "Zeitüberschreitung bei der Verbindung zum Signaling-Server.",
        };
      case "disabled":
        return {
          code: "disabled",
          message: error.message || "Kollaboration ist aktuell nicht verfügbar.",
          requiresSidecarSetup: error.message.toLowerCase().includes("sidecar"),
        };
      case "connection-closed":
        if (error.closeCode === 4001) {
          return {
            code: "unauthorized",
            message: error.message || "Authentifizierung fehlgeschlagen (4001).",
            httpStatus: 401,
            requiresAccessKey: true,
          };
        }
        return {
          code: "network-error",
          message: error.message || "Verbindung zum Signaling-Server geschlossen.",
        };
      default:
        return {
          code: "unknown",
          message: error.message || "Unbekannter Signaling-Fehler.",
        };
    }
  }

  return {
    code: "unknown",
    message: error instanceof Error ? error.message : String(error),
  };
}

// Prüft /__collab/config mit detaillierter Fehlerklassifikation (401, 403, 429, 503, SIDECAR_CUSTOM_ONLY)
export async function fetchRuntimeCollabConfigDetailed(
  signal?: AbortSignal,
  options: { disabledOverride?: boolean; baseUrl?: string; customOnlyOverride?: boolean } = {},
): Promise<CollabRuntimeConfigPreflightResult> {
  const isDisabled = options.disabledOverride !== undefined
    ? options.disabledOverride
    : isCollabDisabledByEnv();
  if (isDisabled) {
    return {
      ok: false,
      effectiveBaseUrl: null,
      error: {
        code: "disabled",
        message: "WebRTC-Kollaboration ist in diesem Build deaktiviert.",
      },
    };
  }

  const rawCandidate = (options.baseUrl ?? loadSidecarBaseUrl()).trim();
  if (rawCandidate.length > 0) {
    const validation = validateSidecarBaseUrl(rawCandidate);
    if (!validation.ok) {
      return {
        ok: false,
        effectiveBaseUrl: null,
        error: {
          code: "invalid-sidecar-url",
          message: validation.error ?? "Ungültige Sidecar-URL.",
          requiresSidecarSetup: true,
        },
      };
    }
  }

  const effectiveBaseUrl = resolveEffectiveSidecarBaseUrl({
    customBaseUrl: options.baseUrl,
    customOnlyOverride: options.customOnlyOverride,
  });

  if (!effectiveBaseUrl) {
    const customOnly = options.customOnlyOverride ?? isCustomSidecarRequired();
    return {
      ok: false,
      effectiveBaseUrl: null,
      error: customOnly
        ? {
          code: "sidecar-required",
          message: "Im statischen Seiten-Modus ist eine eigene Sidecar-URL erforderlich (Hilfe → BYO SideCar...).",
          requiresSidecarSetup: true,
        }
        : {
          code: "invalid-sidecar-url",
          message: "Keine gültige Sidecar-URL konfiguriert.",
          requiresSidecarSetup: true,
        },
    };
  }

  if (typeof fetch !== "function") {
    return {
      ok: false,
      effectiveBaseUrl,
      error: {
        code: "network-error",
        message: "Fetch-API ist in dieser Umgebung nicht verfügbar.",
      },
    };
  }

  const endpoint = rawCandidate.length > 0
    ? `${effectiveBaseUrl}${COLLAB_CONFIG_PATH}`
    : COLLAB_CONFIG_PATH;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
      signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    let jsonBody: Record<string, unknown> | null = null;
    if (contentType.includes("application/json")) {
      try {
        const parsed = (await response.json()) as unknown;
        if (parsed && typeof parsed === "object") {
          jsonBody = parsed as Record<string, unknown>;
        }
      } catch {
        jsonBody = null;
      }
    }

    if (!response.ok) {
      const serverMessage = typeof jsonBody?.error === "string"
        ? jsonBody.error
        : typeof jsonBody?.message === "string"
          ? jsonBody.message
          : undefined;

      if (response.status === 401) {
        return {
          ok: false,
          effectiveBaseUrl,
          error: {
            code: "unauthorized",
            message: serverMessage ?? "Ungültiger oder fehlender Zugangsschlüssel (COLLAB_ACCESS_KEY).",
            httpStatus: 401,
            requiresAccessKey: true,
          },
        };
      }
      if (response.status === 403) {
        return {
          ok: false,
          effectiveBaseUrl,
          error: {
            code: "forbidden",
            message: serverMessage ?? "Zugriff auf den Signaling-Server durch Origin-/CORS-Richtlinie verweigert (403).",
            httpStatus: 403,
            requiresSidecarSetup: true,
          },
        };
      }
      if (response.status === 429) {
        const retryAfterSeconds = parseRetryAfterSeconds(
          response.headers.get("retry-after"),
          jsonBody?.retryAfterSeconds,
        );
        return {
          ok: false,
          effectiveBaseUrl,
          error: {
            code: "rate-limited",
            message: serverMessage ?? "Zu viele Anfragen an den Signaling-Server (Rate-Limit).",
            httpStatus: 429,
            ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
          },
        };
      }
      if (response.status === 503) {
        return {
          ok: false,
          effectiveBaseUrl,
          error: {
            code: "service-unavailable",
            message: serverMessage ?? "Der Signaling-Server hat derzeit keine Kapazität frei (503).",
            httpStatus: 503,
          },
        };
      }
      return {
        ok: false,
        effectiveBaseUrl,
        error: {
          code: "network-error",
          message: serverMessage ?? `Signaling-Konfiguration fehlgeschlagen (HTTP ${response.status}).`,
          httpStatus: response.status,
        },
      };
    }

    if (!jsonBody) {
      return {
        ok: false,
        effectiveBaseUrl,
        error: {
          code: "network-error",
          message: "Ungültige JSON-Antwort vom Signaling-Endpunkt.",
        },
      };
    }

    const parsedStun = parseStunUrls(Array.isArray(jsonBody.stunUrls) ? (jsonBody.stunUrls as string[]) : undefined);
    const serverVersion = typeof jsonBody.serverVersion === "string" && jsonBody.serverVersion.trim().length > 0
      ? jsonBody.serverVersion.trim()
      : undefined;

    const config: CollabRuntimeConfig = {
      stunUrls: parsedStun.validUrls.length > 0 ? parsedStun.validUrls : [...DEFAULT_COLLAB_STUN_URLS],
      inviteTtlMs: typeof jsonBody.inviteTtlMs === "number" && Number.isFinite(jsonBody.inviteTtlMs)
        ? jsonBody.inviteTtlMs
        : DEFAULT_COLLAB_INVITE_TTL_MS,
      gracePeriodMs: typeof jsonBody.gracePeriodMs === "number" && Number.isFinite(jsonBody.gracePeriodMs)
        ? jsonBody.gracePeriodMs
        : DEFAULT_COLLAB_GRACE_PERIOD_MS,
      authRequired: jsonBody.authRequired === true,
      maxPeersPerSession: typeof jsonBody.maxPeersPerSession === "number" && Number.isFinite(jsonBody.maxPeersPerSession)
        ? jsonBody.maxPeersPerSession
        : 16,
      ...(serverVersion ? { serverVersion } : {}),
    };

    return {
      ok: true,
      config,
      effectiveBaseUrl,
      authRequired: config.authRequired,
    };
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    return {
      ok: false,
      effectiveBaseUrl,
      error: {
        code: isAbort || signal?.aborted ? "timeout" : "network-error",
        message: isAbort || signal?.aborted
          ? "Zeitüberschreitung beim Abrufen der Kollaborations-Konfiguration."
          : "Signaling-Server aktuell nicht erreichbar.",
      },
    };
  }
}

// Lädt optionale Server-STUN-/Relay-Parameter über /__collab/config (ohne Traffic im unkonfigurierten Pages-Modus)
export async function fetchRuntimeCollabConfig(
  signal?: AbortSignal,
  options: { disabledOverride?: boolean; baseUrl?: string; customOnlyOverride?: boolean } = {},
): Promise<CollabRuntimeConfig | null> {
  const result = await fetchRuntimeCollabConfigDetailed(signal, options);
  return result.ok ? result.config : null;
}

export function extractIceCandidateType(candidateLine: string | null | undefined): string | null {
  if (typeof candidateLine !== "string" || candidateLine.length === 0) {
    return null;
  }
  const match = candidateLine.match(/\btyp\s+([a-z0-9]+)/i);
  return match ? match[1].toLowerCase() : null;
}

// Klassifiziert WebRTC-/NAT-Verbindungszustände für klare Nutzerhinweise ohne TURN in Ausbaustufe 1
export function classifyIceDiagnostic(input: IceDiagnosticInput): CollabConnectionDiagnostic {
  if (input.signalingUnavailable) {
    return {
      code: "signaling-unavailable",
      isRecoverable: true,
      turnPlannedHint: false,
      details: "Signaling-Server aktuell nicht erreichbar.",
    };
  }

  const state = input.iceConnectionState.toLowerCase();
  const hasSrflx = input.hadSrflxCandidate === true || input.gatheredCandidateTypes.has("srflx");

  if (state === "failed" || state === "disconnected") {
    if (input.isHostMigration) {
      return {
        code: "host-migration-unreachable",
        isRecoverable: false,
        turnPlannedHint: true,
        details: "Direkte STUN-Verbindung zum neuen Host nach Host-Wechsel fehlgeschlagen (TURN ist für eine spätere Ausbaustufe geplant).",
      };
    }
    if (!hasSrflx) {
      return {
        code: "stun-unreachable",
        isRecoverable: false,
        turnPlannedHint: true,
        details: "Keine öffentlichen STUN-Kandidaten ermittelt (mögliche UDP-Blockade oder nicht erreichbarer STUN-Server; TURN geplant).",
      };
    }
    return {
      code: "symmetric-nat-or-udp-blocked",
      isRecoverable: false,
      turnPlannedHint: true,
      details: "Direkte P2P-Verbindung trotz STUN fehlgeschlagen (z. B. Symmetric NAT oder restriktive Firewall; TURN ist später geplant).",
    };
  }

  if (state === "checking" || state === "new") {
    return {
      code: "connecting",
      isRecoverable: true,
      turnPlannedHint: false,
      details: "WebRTC-ICE-Verbindungsaufbau läuft...",
    };
  }

  return {
    code: "none",
    isRecoverable: true,
    turnPlannedHint: false,
    details: "",
  };
}
