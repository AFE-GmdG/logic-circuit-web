import type { ParsedCollabInviteLink } from "../types/collab/sessionState";

import {
  isLoopbackHostname,
  validateSidecarBaseUrl,
} from "./sidecarStorage";

export const COLLAB_INVITE_HASH_PARAM = "collabInvite";
export const COLLAB_SIDECAR_HASH_PARAM = "sidecar";

const RAW_INVITE_TOKEN_REGEX = /^[A-Za-z0-9_-]{16,128}$/;

export type BuildCollabInviteLinkOptions = {
  inviteToken: string;
  pageUrl?: string;
  sidecarBaseUrl?: string | null;
};

export type BuildCollabInviteLinkResult = {
  url: string;
  sidecarUrl?: string;
  isLocalhostSidecar: boolean;
};

type PageLocationLike = {
  protocol: string;
  host?: string;
  origin?: string;
};

// Prüft, ob eine URL auf eine lokale Loopback-Adresse (localhost, 127.0.0.1, ::1) zeigt
export function isLocalhostSidecarUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

// Erstellt einen Hash-basierten Einladungslink ohne Query-String (#collabInvite=...&sidecar=...)
export function buildCollabInviteLink(options: BuildCollabInviteLinkOptions): BuildCollabInviteLinkResult {
  const token = options.inviteToken.trim();
  const fallbackPageUrl = typeof window !== "undefined" && window.location
    ? `${window.location.origin}${window.location.pathname}`
    : "http://localhost/";

  let baseUrl: URL;
  try {
    baseUrl = new URL(options.pageUrl ?? fallbackPageUrl);
  } catch {
    baseUrl = new URL("http://localhost/");
  }

  baseUrl.search = "";
  const hashParams = new URLSearchParams();
  hashParams.set(COLLAB_INVITE_HASH_PARAM, token);

  let effectiveSidecarUrl: string | undefined;
  const rawSidecar = (options.sidecarBaseUrl ?? "").trim();
  if (rawSidecar.length > 0) {
    const validation = validateSidecarBaseUrl(rawSidecar, {
      protocol: baseUrl.protocol,
      host: baseUrl.host,
      origin: baseUrl.origin,
    });
    if (validation.ok && validation.normalizedUrl.length > 0) {
      if (validation.normalizedUrl !== baseUrl.origin) {
        effectiveSidecarUrl = validation.normalizedUrl;
        hashParams.set(COLLAB_SIDECAR_HASH_PARAM, validation.normalizedUrl);
      } else {
        effectiveSidecarUrl = validation.normalizedUrl;
      }
    }
  }

  baseUrl.hash = hashParams.toString();
  const isLocalhostSidecar = effectiveSidecarUrl
    ? isLocalhostSidecarUrl(effectiveSidecarUrl)
    : isLoopbackHostname(baseUrl.hostname);

  return {
    url: baseUrl.toString(),
    ...(effectiveSidecarUrl ? { sidecarUrl: effectiveSidecarUrl } : {}),
    isLocalhostSidecar,
  };
}

function extractHashSegment(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    return "";
  }

  if (trimmed.startsWith("#")) {
    return trimmed.slice(1);
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
    } catch {
      return "";
    }
  }

  const hashIndex = trimmed.indexOf("#");
  if (hashIndex >= 0) {
    return trimmed.slice(hashIndex + 1);
  }

  return trimmed;
}

// Parst einen vollständigen Link, ein Hash-Fragment oder ein rohes Einladungs-Token inkl. Sidecar-Validierung
export function parseCollabInviteLink(
  rawInput: string,
  pageLocation?: PageLocationLike,
): ParsedCollabInviteLink | null {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let inviteToken = "";
  let rawSidecar = "";

  if (RAW_INVITE_TOKEN_REGEX.test(trimmed)) {
    inviteToken = trimmed;
  } else {
    const hashBody = extractHashSegment(trimmed);
    if (hashBody.length === 0) {
      return null;
    }
    const params = new URLSearchParams(hashBody);
    inviteToken = (params.get(COLLAB_INVITE_HASH_PARAM) ?? "").trim();
    rawSidecar = (params.get(COLLAB_SIDECAR_HASH_PARAM) ?? "").trim();
  }

  if (!RAW_INVITE_TOKEN_REGEX.test(inviteToken)) {
    return null;
  }

  if (rawSidecar.length === 0) {
    return {
      inviteToken,
      sidecarUrl: null,
      isRemoteSidecar: false,
      isLocalhostSidecar: false,
      sidecarError: null,
    };
  }

  const validation = validateSidecarBaseUrl(rawSidecar, pageLocation);
  if (!validation.ok) {
    return {
      inviteToken,
      sidecarUrl: null,
      isRemoteSidecar: false,
      isLocalhostSidecar: false,
      sidecarError: validation.error ?? "Ungültige Sidecar-URL im Einladungslink.",
    };
  }

  if (!validation.isLocalhost && !validation.normalizedUrl.startsWith("https://")) {
    return {
      inviteToken,
      sidecarUrl: null,
      isRemoteSidecar: false,
      isLocalhostSidecar: false,
      sidecarError: "Entfernte Sidecar-Server in Einladungslinks müssen zwingend über https:// erreichbar sein.",
    };
  }

  return {
    inviteToken,
    sidecarUrl: validation.normalizedUrl,
    isRemoteSidecar: !validation.isLocalhost,
    isLocalhostSidecar: validation.isLocalhost,
    sidecarError: null,
  };
}

// Entfernt Einladungs- und Sidecar-Parameter sauber aus einem URL-Hash und behält sonstige Hash-Werte bei
export function stripCollabInviteFromHash(hash: string): string {
  const cleaned = hash.startsWith("#") ? hash.slice(1) : hash;
  if (cleaned.trim().length === 0) {
    return "";
  }
  const params = new URLSearchParams(cleaned);
  params.delete(COLLAB_INVITE_HASH_PARAM);
  params.delete(COLLAB_SIDECAR_HASH_PARAM);
  const serialized = params.toString();
  return serialized.length > 0 ? `#${serialized}` : "";
}
