import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearSidecarBaseUrl,
  DEFAULT_LOCAL_SIDECAR_URL,
  isCustomSidecarRequired,
  isLoopbackHostname,
  loadSidecarBaseUrl,
  resolveEffectiveSidecarBaseUrl,
  saveSidecarBaseUrl,
  SIDECAR_URL_STORAGE_KEY,
  toWebSocketUrl,
  validateSidecarBaseUrl,
} from "../utils/sidecarStorage";
import {
  compareSemVer,
  compareSidecarVersion,
  fetchMcpServerStatus,
  getClientVersion,
  parseSemVer,
  probeSidecarServer,
} from "../utils/sidecarVersion";

describe("sidecarStorage (BYO-Sidecar-URLs & GitHub-Pages-Opt-in)", () => {
  const originalWindow = (globalThis as { window?: Window & typeof globalThis }).window;
  const originalCustomOnly = process.env.SIDECAR_CUSTOM_ONLY;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window & typeof globalThis }).window;
    } else {
      (globalThis as { window?: Window & typeof globalThis }).window = originalWindow;
    }
    if (originalCustomOnly === undefined) {
      delete process.env.SIDECAR_CUSTOM_ONLY;
    } else {
      process.env.SIDECAR_CUSTOM_ONLY = originalCustomOnly;
    }
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function installMockStorage(): Map<string, string> {
    const store = new Map<string, string>();
    (globalThis as { window?: Window & typeof globalThis }).window = {
      location: {
        protocol: "https:",
        host: "afe-gmdg.github.io",
        origin: "https://afe-gmdg.github.io",
      },
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); },
      },
    } as unknown as Window & typeof globalThis;
    return store;
  }

  it("validiert Sidecar-URLs inkl. Loopback-Ausnahme und Mixed-Content-Blockade auf HTTPS", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("afe-gmdg.de")).toBe(false);

    expect(validateSidecarBaseUrl("")).toMatchObject({ ok: true, status: "empty", normalizedUrl: "" });

    // http://localhost ist auf HTTPS (GitHub Pages) ausdrücklich erlaubt
    expect(
      validateSidecarBaseUrl("http://localhost:3001/", { protocol: "https:", origin: "https://afe-gmdg.github.io" }),
    ).toMatchObject({
      ok: true,
      normalizedUrl: DEFAULT_LOCAL_SIDECAR_URL,
      status: "valid-localhost",
      isLocalhost: true,
      isMixedContent: false,
    });

    // Non-Localhost http:// auf HTTPS wird als Mixed Content abgelehnt
    expect(
      validateSidecarBaseUrl("http://sidecar.example.com:3001", { protocol: "https:", origin: "https://afe-gmdg.github.io" }),
    ).toMatchObject({
      ok: false,
      status: "mixed-content-blocked",
      isMixedContent: true,
    });

    // Remote https:// wird normalisiert
    expect(
      validateSidecarBaseUrl("https://afe-gmdg.de///", { protocol: "https:", origin: "https://afe-gmdg.github.io" }),
    ).toMatchObject({
      ok: true,
      normalizedUrl: "https://afe-gmdg.de",
      status: "valid-https-remote",
    });

    expect(validateSidecarBaseUrl("ws://localhost:3001")).toMatchObject({ ok: false, status: "invalid-protocol" });
    expect(validateSidecarBaseUrl("https://user:pass@example.com")).toMatchObject({ ok: false, status: "invalid-url" });
    expect(validateSidecarBaseUrl("keine-url")).toMatchObject({ ok: false, status: "invalid-url" });
  });

  it("persistiert benutzerdefinierte URLs im localStorage und verhindert im Pages-Modus Traffic ohne URL", () => {
    const store = installMockStorage();
    process.env.SIDECAR_CUSTOM_ONLY = "true";
    expect(isCustomSidecarRequired()).toBe(true);

    // Ohne gesetzte URL liefert resolveEffectiveSidecarBaseUrl null (null Traffic)
    expect(resolveEffectiveSidecarBaseUrl()).toBeNull();

    saveSidecarBaseUrl("http://localhost:3001/");
    expect(store.get(SIDECAR_URL_STORAGE_KEY)).toBe("http://localhost:3001");
    expect(loadSidecarBaseUrl()).toBe("http://localhost:3001");
    expect(resolveEffectiveSidecarBaseUrl()).toBe("http://localhost:3001");
    expect(toWebSocketUrl("http://localhost:3001", "/ws-mcp")).toBe("ws://localhost:3001/ws-mcp");
    expect(toWebSocketUrl("https://afe-gmdg.de/sub/", "/ws-collab")).toBe("wss://afe-gmdg.de/sub/ws-collab");

    clearSidecarBaseUrl();
    expect(loadSidecarBaseUrl()).toBe("");
    expect(resolveEffectiveSidecarBaseUrl()).toBeNull();

    // Regulär gehostete Instanz nutzt ohne Custom-URL Same-Origin
    delete process.env.SIDECAR_CUSTOM_ONLY;
    expect(isCustomSidecarRequired()).toBe(false);
    expect(resolveEffectiveSidecarBaseUrl()).toBe("https://afe-gmdg.github.io");
  });
});

describe("sidecarVersion (SemVer-Abgleich & Sidecar-Probe)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("vergleicht SemVer-Versionen korrekt und erkennt veraltete Sidecars", () => {
    expect(getClientVersion()).toBe(process.env.VERSION);
    expect(getClientVersion()).not.toBe("0.0.0");
    expect(compareSidecarVersion(process.env.VERSION)).toMatchObject({
      relation: "compatible",
      isCompatible: true,
      updateRecommended: false,
    });

    expect(parseSemVer("v1.2.3-beta.1")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: "beta.1",
    });
    expect(parseSemVer("ungueltig")).toBeNull();

    expect(compareSemVer(parseSemVer("1.2.0")!, parseSemVer("1.2.0")!)).toBe(0);
    expect(compareSemVer(parseSemVer("1.1.9")!, parseSemVer("1.2.0")!)).toBe(-1);
    expect(compareSemVer(parseSemVer("1.2.0-rc1")!, parseSemVer("1.2.0")!)).toBe(-1);

    expect(compareSidecarVersion("1.1.0", "1.1.0")).toMatchObject({
      relation: "compatible",
      isCompatible: true,
      updateRecommended: false,
    });
    expect(compareSidecarVersion("1.0.4", "1.1.0")).toMatchObject({
      relation: "server-outdated",
      isCompatible: false,
      updateRecommended: true,
    });
    expect(compareSidecarVersion("1.3.0", "1.1.0")).toMatchObject({
      relation: "client-outdated",
      isCompatible: false,
      updateRecommended: false,
    });
    expect(compareSidecarVersion(null, "1.1.0")).toMatchObject({
      relation: "unknown",
      isCompatible: false,
      updateRecommended: false,
    });
  });

  it("unterdrückt Netzwerkabfragen ohne URL im Custom-Only-Modus und liest Version/Auth via probeSidecarServer", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await fetchMcpServerStatus({ baseUrl: "", customOnlyOverride: true })).toBeNull();
    const skippedProbe = await probeSidecarServer({ baseUrl: "", customOnlyOverride: true });
    expect(skippedProbe.reachable).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/__mcp/status")) {
        return new Response(
          JSON.stringify({
            activeSessions: 1,
            pendingRequests: 0,
            authRequired: true,
            serverVersion: "1.0.0",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          stunUrls: ["stun:stun.l.google.com:19302"],
          inviteTtlMs: 300000,
          gracePeriodMs: 15000,
          authRequired: true,
          maxPeersPerSession: 16,
          serverVersion: "1.0.0",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const probe = await probeSidecarServer({
      baseUrl: "http://localhost:3001",
      clientVersion: "1.1.0",
    });
    expect(probe.reachable).toBe(true);
    expect(probe.resolvedBaseUrl).toBe("http://localhost:3001");
    expect(probe.mcpAuthRequired).toBe(true);
    expect(probe.collabAuthRequired).toBe(true);
    expect(probe.serverVersion).toBe("1.0.0");
    expect(probe.versionCheck.relation).toBe("server-outdated");
    expect(probe.versionCheck.updateRecommended).toBe(true);
  });
});
