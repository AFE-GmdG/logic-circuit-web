import type PrivacyConfig from "../types/privacyConfig";

import { MCP_PRIVACY_PATH } from "../mcp/mcpEvents";

import { loadSidecarBaseUrl, resolveEffectiveSidecarBaseUrl } from "./sidecarStorage";

function readStringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Liefert die zur Build-Zeit eingebetteten Datenschutz-Standardwerte (falls gesetzt)
export function getBuildPrivacyConfig(): PrivacyConfig {
  return {
    responsibleName: readStringField(process.env.PRIVACY_RESPONSIBLE_NAME),
    responsibleAddress: readStringField(process.env.PRIVACY_RESPONSIBLE_ADDRESS),
    contactEmail: readStringField(process.env.PRIVACY_CONTACT_EMAIL),
    hostingLocation: readStringField(process.env.PRIVACY_HOSTING_LOCATION),
  };
}

// Kombiniert Basis- und Runtime-Konfiguration, sodass nicht-leere Server-Werte Vorrang haben
export function mergePrivacyConfig(
  base: PrivacyConfig,
  override?: Partial<PrivacyConfig> | null,
): PrivacyConfig {
  if (!override) {
    return { ...base };
  }

  const pick = (next: unknown, fallback: string): string => {
    const trimmed = readStringField(next);
    return trimmed.length > 0 ? trimmed : fallback;
  };

  return {
    responsibleName: pick(override.responsibleName, base.responsibleName),
    responsibleAddress: pick(override.responsibleAddress, base.responsibleAddress),
    contactEmail: pick(override.contactEmail, base.contactEmail),
    hostingLocation: pick(override.hostingLocation, base.hostingLocation),
  };
}

// Lädt optionale Runtime-Betreiberangaben vom Sidecar-/Dev-Endpunkt (/__mcp/privacy)
export async function fetchRuntimePrivacyConfig(
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<Partial<PrivacyConfig> | null> {
  if (typeof fetch !== "function") {
    return null;
  }

  const effectiveBaseUrl = resolveEffectiveSidecarBaseUrl({ customBaseUrl: baseUrl });
  if (!effectiveBaseUrl) {
    return null;
  }

  const hasExplicitOrStoredUrl = (baseUrl ?? loadSidecarBaseUrl()).trim().length > 0;
  const endpoint = hasExplicitOrStoredUrl ? `${effectiveBaseUrl}${MCP_PRIVACY_PATH}` : MCP_PRIVACY_PATH;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
      signal,
    });
    if (!response.ok) {
      return null;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return null;
    }
    const payload = (await response.json()) as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object") {
      return null;
    }

    return {
      responsibleName: readStringField(payload.responsibleName),
      responsibleAddress: readStringField(payload.responsibleAddress),
      contactEmail: readStringField(payload.contactEmail),
      hostingLocation: readStringField(payload.hostingLocation),
    };
  } catch (_error) {
    return null;
  }
}
