import { COLLAB_CONFIG_PATH } from "../collab/collabEvents";
import { MCP_HTTP_BASE_PATH } from "../mcp/mcpEvents";

import { fetchRuntimeCollabConfig } from "./collabIceConfig";
import { resolveEffectiveSidecarBaseUrl } from "./sidecarStorage";

export type ParsedSemVer = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
};

export type SidecarVersionRelation = "compatible" | "server-outdated" | "client-outdated" | "unknown";

export type SidecarVersionCheckResult = {
  relation: SidecarVersionRelation;
  isCompatible: boolean;
  updateRecommended: boolean;
  clientVersion: string;
  serverVersion: string | null;
};

export type McpServerStatusPayload = {
  activeSessions: number;
  pendingRequests: number;
  authRequired: boolean;
  serverVersion: string | null;
};

export type SidecarProbeResult = {
  reachable: boolean;
  resolvedBaseUrl: string | null;
  serverVersion: string | null;
  mcpAuthRequired: boolean | null;
  collabAuthRequired: boolean | null;
  versionCheck: SidecarVersionCheckResult;
};

const SEMVER_REGEX = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function getClientVersion(): string {
  const rawVersion: unknown = process.env.VERSION;
  if (typeof rawVersion === "string" && rawVersion.trim().length > 0) {
    return rawVersion.trim();
  }
  return "0.0.0";
}

export function parseSemVer(raw: string | null | undefined): ParsedSemVer | null {
  if (typeof raw !== "string") {
    return null;
  }
  const match = raw.trim().match(SEMVER_REGEX);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

export function compareSemVer(a: ParsedSemVer, b: ParsedSemVer): -1 | 0 | 1 {
  if (a.major !== b.major) {
    return a.major < b.major ? -1 : 1;
  }
  if (a.minor !== b.minor) {
    return a.minor < b.minor ? -1 : 1;
  }
  if (a.patch !== b.patch) {
    return a.patch < b.patch ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) {
    return 0;
  }
  if (a.prerelease === null) {
    return 1;
  }
  if (b.prerelease === null) {
    return -1;
  }
  return a.prerelease < b.prerelease ? -1 : 1;
}

// Vergleicht die erwartete App-Version mit der vom Sidecar gemeldeten SemVer-Version
export function compareSidecarVersion(
  serverVersion: string | null | undefined,
  clientVersion = getClientVersion(),
): SidecarVersionCheckResult {
  const normalizedServer = typeof serverVersion === "string" && serverVersion.trim().length > 0
    ? serverVersion.trim()
    : null;
  const parsedClient = parseSemVer(clientVersion);
  const parsedServer = parseSemVer(normalizedServer);

  if (!parsedClient || !parsedServer) {
    return {
      relation: "unknown",
      isCompatible: false,
      updateRecommended: false,
      clientVersion,
      serverVersion: normalizedServer,
    };
  }

  const cmp = compareSemVer(parsedServer, parsedClient);
  if (cmp === 0) {
    return {
      relation: "compatible",
      isCompatible: true,
      updateRecommended: false,
      clientVersion,
      serverVersion: normalizedServer,
    };
  }
  if (cmp < 0) {
    return {
      relation: "server-outdated",
      isCompatible: false,
      updateRecommended: true,
      clientVersion,
      serverVersion: normalizedServer,
    };
  }
  return {
    relation: "client-outdated",
    isCompatible: false,
    updateRecommended: false,
    clientVersion,
    serverVersion: normalizedServer,
  };
}

// Ruft den MCP-Sidecar-Status (/__mcp/status) ohne Hintergrund-Traffic im unkonfigurierten Pages-Modus ab
export async function fetchMcpServerStatus(options: {
  baseUrl?: string;
  signal?: AbortSignal;
  customOnlyOverride?: boolean;
} = {}): Promise<McpServerStatusPayload | null> {
  if (typeof fetch !== "function") {
    return null;
  }

  const effectiveBaseUrl = resolveEffectiveSidecarBaseUrl({
    customBaseUrl: options.baseUrl,
    customOnlyOverride: options.customOnlyOverride,
  });
  if (!effectiveBaseUrl) {
    return null;
  }

  try {
    const response = await fetch(`${effectiveBaseUrl}${MCP_HTTP_BASE_PATH}/status`, {
      method: "GET",
      cache: "no-store",
      signal: options.signal,
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
      activeSessions: typeof payload.activeSessions === "number" ? payload.activeSessions : 0,
      pendingRequests: typeof payload.pendingRequests === "number" ? payload.pendingRequests : 0,
      authRequired: payload.authRequired === true,
      serverVersion: typeof payload.serverVersion === "string" && payload.serverVersion.trim().length > 0
        ? payload.serverVersion.trim()
        : null,
    };
  } catch (_error) {
    return null;
  }
}

// Prüft Erreichbarkeit, Auth-Status und Version eines konfigurierten oder lokalen Sidecars
export async function probeSidecarServer(options: {
  baseUrl?: string;
  signal?: AbortSignal;
  clientVersion?: string;
  customOnlyOverride?: boolean;
} = {}): Promise<SidecarProbeResult> {
  const effectiveBaseUrl = resolveEffectiveSidecarBaseUrl({
    customBaseUrl: options.baseUrl,
    customOnlyOverride: options.customOnlyOverride,
  });
  const clientVersion = options.clientVersion ?? getClientVersion();

  if (!effectiveBaseUrl) {
    return {
      reachable: false,
      resolvedBaseUrl: null,
      serverVersion: null,
      mcpAuthRequired: null,
      collabAuthRequired: null,
      versionCheck: compareSidecarVersion(null, clientVersion),
    };
  }

  const [mcpStatus, collabConfig] = await Promise.all([
    fetchMcpServerStatus({
      baseUrl: effectiveBaseUrl,
      signal: options.signal,
      customOnlyOverride: options.customOnlyOverride,
    }),
    fetchRuntimeCollabConfig(options.signal, {
      baseUrl: effectiveBaseUrl,
      customOnlyOverride: options.customOnlyOverride,
    }),
  ]);

  const reachable = mcpStatus !== null || collabConfig !== null;
  const serverVersion = mcpStatus?.serverVersion ?? collabConfig?.serverVersion ?? null;
  void COLLAB_CONFIG_PATH;

  return {
    reachable,
    resolvedBaseUrl: effectiveBaseUrl,
    serverVersion,
    mcpAuthRequired: mcpStatus ? mcpStatus.authRequired : null,
    collabAuthRequired: collabConfig ? collabConfig.authRequired : null,
    versionCheck: compareSidecarVersion(serverVersion, clientVersion),
  };
}
