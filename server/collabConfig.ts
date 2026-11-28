import type { CollabRuntimeConfig } from "../src/types/collab/iceConfig.ts";

import {
  DEFAULT_COLLAB_GRACE_PERIOD_MS,
  DEFAULT_COLLAB_INVITE_TTL_MS,
  DEFAULT_COLLAB_STUN_URLS,
} from "../src/collab/collabEvents.ts";

export type CollabServerConfig = {
  stunUrls: string[];
  accessKey: string;
  allowedOrigins: string[];
  inviteTtlMs: number;
  gracePeriodMs: number;
  maxSessions: number;
  maxPeersPerSession: number;
  maxMessageBytes: number;
};

const MIN_INVITE_TTL_MS = 10000;
const MIN_GRACE_PERIOD_MS = 1000;
const MAX_GRACE_PERIOD_MS = 120000;
const DEFAULT_MAX_SESSIONS = 50;
const DEFAULT_MAX_PEERS_PER_SESSION = 16;
const DEFAULT_MAX_MESSAGE_BYTES = 64 * 1024;

function parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const floored = Math.floor(parsed);
  if (floored < min) {
    return min;
  }
  if (floored > max) {
    return max;
  }
  return floored;
}

function parseOriginsList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(Boolean);
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

// Bereinigt konfigurierte STUN-URLs und fällt bei fehlenden gültigen Einträgen auf den Standard zurück
export function sanitizeStunUrls(raw: string | string[] | undefined): string[] {
  const candidates = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];

  const validUrls: string[] = [];
  const seen = new Set<string>();
  for (const entry of candidates) {
    const trimmed = entry.trim();
    if (!isValidStunUrl(trimmed) || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    validUrls.push(trimmed);
  }

  return validUrls.length > 0 ? validUrls : [...DEFAULT_COLLAB_STUN_URLS];
}

// Liest die WebRTC-Signaling-Konfiguration aus Umgebungsvariablen
export function readCollabConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): CollabServerConfig {
  return {
    stunUrls: sanitizeStunUrls(env.COLLAB_STUN_URLS),
    accessKey: (env.COLLAB_ACCESS_KEY ?? "").trim(),
    allowedOrigins: parseOriginsList(env.COLLAB_ALLOWED_ORIGINS),
    inviteTtlMs: parsePositiveInt(
      env.COLLAB_INVITE_TTL_MS,
      DEFAULT_COLLAB_INVITE_TTL_MS,
      MIN_INVITE_TTL_MS,
      DEFAULT_COLLAB_INVITE_TTL_MS,
    ),
    gracePeriodMs: parsePositiveInt(
      env.COLLAB_GRACE_PERIOD_MS,
      DEFAULT_COLLAB_GRACE_PERIOD_MS,
      MIN_GRACE_PERIOD_MS,
      MAX_GRACE_PERIOD_MS,
    ),
    maxSessions: parsePositiveInt(env.COLLAB_MAX_SESSIONS, DEFAULT_MAX_SESSIONS, 1, 10000),
    maxPeersPerSession: parsePositiveInt(env.COLLAB_MAX_PEERS_PER_SESSION, DEFAULT_MAX_PEERS_PER_SESSION, 2, 128),
    maxMessageBytes: parsePositiveInt(env.COLLAB_MAX_MESSAGE_BYTES, DEFAULT_MAX_MESSAGE_BYTES, 4096, 1024 * 1024),
  };
}

// Erstellt die öffentliche Client-Konfiguration ohne serverseitige Secrets
export function toPublicCollabRuntimeConfig(config: CollabServerConfig, serverVersion?: string): CollabRuntimeConfig {
  const trimmedVersion = serverVersion?.trim();
  return {
    stunUrls: [...config.stunUrls],
    inviteTtlMs: config.inviteTtlMs,
    gracePeriodMs: config.gracePeriodMs,
    authRequired: config.accessKey.length > 0,
    maxPeersPerSession: config.maxPeersPerSession,
    ...(trimmedVersion && trimmedVersion.length > 0 ? { serverVersion: trimmedVersion } : {}),
  };
}

export default readCollabConfigFromEnv;
