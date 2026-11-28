import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_COLLAB_STUN_URLS } from "../collab/collabEvents";
import { SignalingClientError } from "../collab/signalingClient";
import {
  classifyIceDiagnostic,
  extractIceCandidateType,
  fetchRuntimeCollabConfig,
  fetchRuntimeCollabConfigDetailed,
  isCollabDisabledByEnv,
  isValidStunUrl,
  mapSignalingErrorToCollabError,
  parseRetryAfterSeconds,
  parseStunUrls,
  resolveCollabIceServers,
  resolveCollabWsUrl,
} from "../utils/collabIceConfig";

describe("collabIceConfig", () => {
  const originalDisableCollab = process.env.DISABLE_COLLAB;
  const originalCustomOnly = process.env.SIDECAR_CUSTOM_ONLY;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalDisableCollab === undefined) {
      delete process.env.DISABLE_COLLAB;
    } else {
      process.env.DISABLE_COLLAB = originalDisableCollab;
    }
    if (originalCustomOnly === undefined) {
      delete process.env.SIDECAR_CUSTOM_ONLY;
    } else {
      process.env.SIDECAR_CUSTOM_ONLY = originalCustomOnly;
    }
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("erkennt DISABLE_COLLAB sowie SIDECAR_CUSTOM_ONLY und lädt /__collab/config mit Custom-URL inkl. serverVersion", async () => {
    delete process.env.DISABLE_COLLAB;
    delete process.env.SIDECAR_CUSTOM_ONLY;
    expect(isCollabDisabledByEnv()).toBe(false);

    process.env.DISABLE_COLLAB = "true";
    expect(isCollabDisabledByEnv()).toBe(true);

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await fetchRuntimeCollabConfig();
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    // Im Custom-Sidecar-Opt-in-Modus (GitHub Pages) wird ohne konfigurierte URL ebenfalls kein Request gesendet
    delete process.env.DISABLE_COLLAB;
    process.env.SIDECAR_CUSTOM_ONLY = "true";
    expect(await fetchRuntimeCollabConfig()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          stunUrls: ["stun:stun.example.net:3478"],
          inviteTtlMs: 300000,
          gracePeriodMs: 15000,
          authRequired: true,
          maxPeersPerSession: 8,
          serverVersion: "1.1.0",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const customConfig = await fetchRuntimeCollabConfig(undefined, { baseUrl: "https://sidecar.example.com/" });
    expect(fetchSpy).toHaveBeenCalledWith("https://sidecar.example.com/__collab/config", expect.any(Object));
    expect(customConfig?.serverVersion).toBe("1.1.0");
  });

  it("validiert STUN-URLs, lehnt TURN in Ausbaustufe 1 ab und löst ICE-Server-Prioritäten auf", () => {
    expect(isValidStunUrl("stun:stun.l.google.com:19302")).toBe(true);
    expect(isValidStunUrl("stuns:stun.example.org:5349")).toBe(true);
    expect(isValidStunUrl("turn:relay.example.org:3478")).toBe(false);
    expect(isValidStunUrl("stun://bad-format")).toBe(false);

    const parsed = parseStunUrls("stun:custom.example.org:3478, turn:relay.example.org:3478, invalid");
    expect(parsed).toEqual({
      validUrls: ["stun:custom.example.org:3478"],
      rejectedUrls: ["turn:relay.example.org:3478", "invalid"],
      hasTurnUrls: true,
    });

    expect(resolveCollabIceServers({
      customStunUrls: ["stun:custom.example.org:3478"],
      runtimeConfig: { stunUrls: ["stun:server.example.org:3478"] },
    })).toEqual([{ urls: "stun:custom.example.org:3478" }]);

    expect(resolveCollabIceServers({
      customStunUrls: ["turn:ignored.example.org:3478"],
      runtimeConfig: { stunUrls: ["stun:server.example.org:3478"] },
    })).toEqual([{ urls: "stun:server.example.org:3478" }]);

    expect(resolveCollabIceServers({})).toEqual(
      DEFAULT_COLLAB_STUN_URLS.map((url) => ({ urls: url })),
    );

    expect(resolveCollabWsUrl({ protocol: "https:", host: "afe-gmdg.de" })).toBe("wss://afe-gmdg.de/ws-collab");
    expect(resolveCollabWsUrl({ protocol: "http:", host: "localhost:5173" })).toBe("ws://localhost:5173/ws-collab");
    expect(resolveCollabWsUrl("https://sidecar.example.com/")).toBe("wss://sidecar.example.com/ws-collab");
    expect(resolveCollabWsUrl("http://localhost:3001")).toBe("ws://localhost:3001/ws-collab");
  });

  it("extrahiert ICE-Kandidatentypen und klassifiziert Firewall-/NAT-Diagnosen inklusive TURN-Hinweis", () => {
    expect(extractIceCandidateType("candidate:1 1 UDP 2122260223 192.168.1.10 54321 typ host")).toBe("host");
    expect(extractIceCandidateType("candidate:2 1 UDP 1686052607 203.0.113.5 54322 typ srflx raddr 192.168.1.10")).toBe("srflx");

    expect(classifyIceDiagnostic({
      iceConnectionState: "failed",
      gatheredCandidateTypes: new Set(["host"]),
    })).toMatchObject({
      code: "stun-unreachable",
      isRecoverable: false,
      turnPlannedHint: true,
    });

    expect(classifyIceDiagnostic({
      iceConnectionState: "failed",
      gatheredCandidateTypes: new Set(["host", "srflx"]),
    })).toMatchObject({
      code: "symmetric-nat-or-udp-blocked",
      isRecoverable: false,
      turnPlannedHint: true,
    });

    expect(classifyIceDiagnostic({
      iceConnectionState: "failed",
      gatheredCandidateTypes: new Set(["host", "srflx"]),
      isHostMigration: true,
    })).toMatchObject({
      code: "host-migration-unreachable",
      isRecoverable: false,
      turnPlannedHint: true,
    });

    expect(classifyIceDiagnostic({
      iceConnectionState: "connected",
      gatheredCandidateTypes: new Set(["host", "srflx"]),
    }).code).toBe("none");
  });

  it("klassifiziert Pre-Flight-Fehler (SIDECAR_CUSTOM_ONLY, 401, 403, 429 + Retry-After, 503) und Signaling-Fehler", async () => {
    delete process.env.DISABLE_COLLAB;
    process.env.SIDECAR_CUSTOM_ONLY = "true";

    const missingSidecar = await fetchRuntimeCollabConfigDetailed();
    expect(missingSidecar).toMatchObject({
      ok: false,
      error: { code: "sidecar-required", requiresSidecarSetup: true },
    });

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Rate limit" }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "18",
        },
      }),
    );
    const rateLimited = await fetchRuntimeCollabConfigDetailed(undefined, { baseUrl: "https://relay.example.com" });
    expect(rateLimited).toMatchObject({
      ok: false,
      error: { code: "rate-limited", httpStatus: 429, retryAfterSeconds: 18 },
    });

    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await fetchRuntimeCollabConfigDetailed(undefined, { baseUrl: "https://relay.example.com" })).toMatchObject({
      ok: false,
      error: { code: "unauthorized", httpStatus: 401, requiresAccessKey: true },
    });

    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect(await fetchRuntimeCollabConfigDetailed(undefined, { baseUrl: "https://relay.example.com" })).toMatchObject({
      ok: false,
      error: { code: "forbidden", httpStatus: 403, requiresSidecarSetup: true },
    });

    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await fetchRuntimeCollabConfigDetailed(undefined, { baseUrl: "https://relay.example.com" })).toMatchObject({
      ok: false,
      error: { code: "service-unavailable", httpStatus: 503 },
    });

    expect(parseRetryAfterSeconds("25")).toBe(25);
    expect(parseRetryAfterSeconds(null, 12.2)).toBe(13);

    expect(mapSignalingErrorToCollabError(new SignalingClientError("unauthorized", "Bad key"))).toMatchObject({
      code: "unauthorized",
      httpStatus: 401,
      requiresAccessKey: true,
    });
    expect(mapSignalingErrorToCollabError(new SignalingClientError("session-limit-reached", "Full"))).toMatchObject({
      code: "service-unavailable",
      httpStatus: 503,
    });
    expect(mapSignalingErrorToCollabError(new SignalingClientError("invite-expired", "Old"))).toMatchObject({
      code: "invite-expired",
    });
    expect(mapSignalingErrorToCollabError(new SignalingClientError("invite-revoked", "Revoked"))).toMatchObject({
      code: "invite-revoked",
    });
  });
});
