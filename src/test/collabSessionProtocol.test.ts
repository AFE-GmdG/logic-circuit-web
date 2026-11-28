import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type CollabParticipant from "../types/collab/sessionState";
import {
  COLLAB_CONTROL_ACTION_ACTION_REJECTED,
  COLLAB_CONTROL_ACTION_HAND_STATE,
  COLLAB_CONTROL_ACTION_MODERATE_NAME,
  COLLAB_CONTROL_ACTION_RENAME_SELF,
  COLLAB_CONTROL_ACTION_ROLE_UPDATE,
  COLLAB_CONTROL_ACTION_ROSTER_SNAPSHOT,
} from "../types/collab/sessionState";

import {
  authorizeCollabAction,
  disambiguateDisplayName,
  MAX_COLLAB_DISPLAY_NAME_LENGTH,
  normalizeDisplayName,
  sortCollabParticipants,
} from "../collab/collabAuthorization";
import {
  buildCollabInviteLink,
  isLocalhostSidecarUrl,
  parseCollabInviteLink,
  stripCollabInviteFromHash,
} from "../utils/collabInviteLink";
import {
  clearCollabDisplayName,
  COLLAB_DISPLAY_NAME_STORAGE_KEY,
  loadCollabDisplayName,
  saveCollabDisplayName,
} from "../utils/collabStorage";

function createParticipant(overrides: Partial<CollabParticipant> & { peerId: string }): CollabParticipant {
  return {
    role: "guest",
    displayName: "Teilnehmer",
    nameLocked: false,
    handRaised: false,
    connectionState: "connected",
    ...overrides,
  };
}

describe("collabAuthorization (Namensregeln, Sortierung & Host-Gatekeeper)", () => {
  it("validiert Pflicht-Anzeigenamen (getrimmt, nicht leer, max. 64 Zeichen)", () => {
    expect(normalizeDisplayName("")).toMatchObject({ valid: false, reason: "empty" });
    expect(normalizeDisplayName("   \t  ")).toMatchObject({ valid: false, reason: "empty" });
    expect(normalizeDisplayName(null)).toMatchObject({ valid: false, reason: "invalid-type" });

    const tooLong = "A".repeat(MAX_COLLAB_DISPLAY_NAME_LENGTH + 1);
    expect(normalizeDisplayName(tooLong)).toMatchObject({ valid: false, reason: "too-long" });

    const exact = "B".repeat(MAX_COLLAB_DISPLAY_NAME_LENGTH);
    expect(normalizeDisplayName(`  ${exact}  `)).toEqual({ valid: true, displayName: exact });
  });

  it("disambiguiert doppelte Anzeigenamen case-insensitiv unter Einhaltung der 64-Zeichen-Grenze", () => {
    const existing = [
      createParticipant({ peerId: "peer-1", role: "host", displayName: "Alex" }),
      createParticipant({ peerId: "peer-2", role: "collaborator", displayName: "Alex (2)" }),
    ];

    expect(disambiguateDisplayName("alex", existing)).toBe("alex (3)");
    expect(disambiguateDisplayName("Alex", existing, "peer-1")).toBe("Alex");

    const maxLenName = "Z".repeat(MAX_COLLAB_DISPLAY_NAME_LENGTH);
    const resolved = disambiguateDisplayName(maxLenName, [
      createParticipant({ peerId: "peer-9", displayName: maxLenName }),
    ]);
    expect(resolved.length).toBeLessThanOrEqual(MAX_COLLAB_DISPLAY_NAME_LENGTH);
    expect(resolved.endsWith(" (2)")).toBe(true);
  });

  it("sortiert Teilnehmer primär nach Rolle (Host -> Kollaborateur -> Gast) und sekundär alphabetisch", () => {
    const unsorted = [
      createParticipant({ peerId: "p-guest-z", role: "guest", displayName: "Zora" }),
      createParticipant({ peerId: "p-collab-b", role: "collaborator", displayName: "Berta" }),
      createParticipant({ peerId: "p-guest-a", role: "guest", displayName: "Anna" }),
      createParticipant({ peerId: "p-host", role: "host", displayName: "Stefan" }),
      createParticipant({ peerId: "p-collab-a", role: "collaborator", displayName: "anton" }),
    ];

    const sorted = sortCollabParticipants(unsorted);
    expect(sorted.map((p) => p.peerId)).toEqual([
      "p-host",
      "p-collab-a",
      "p-collab-b",
      "p-guest-a",
      "p-guest-z",
    ]);
  });

  it("erzwingt Rollenautorisierung, Namenssperre und Hand-Heben-Regeln auf Host-Seite", () => {
    const roster = [
      createParticipant({ peerId: "host-1", role: "host", displayName: "Host" }),
      createParticipant({ peerId: "collab-1", role: "collaborator", displayName: "Clara" }),
      createParticipant({ peerId: "guest-1", role: "guest", displayName: "Gustav" }),
      createParticipant({ peerId: "guest-locked", role: "guest", displayName: "Gesperrt", nameLocked: true }),
    ];

    // Unbekannter Absender wird abgelehnt
    expect(authorizeCollabAction("unknown", { kind: "heartbeat-ping", seq: 1, sentAt: 10 }, roster)).toMatchObject({
      allowed: false,
      code: "unknown-peer",
    });

    // Gast darf keine Schaltungs-Mutationen ausführen, Kollaborateur schon
    const mutationMsg = { kind: "app" as const, topic: "circuit-mutation", payload: { op: "add" } };
    expect(authorizeCollabAction("guest-1", mutationMsg, roster)).toMatchObject({
      allowed: false,
      code: "unauthorized-role",
    });
    expect(authorizeCollabAction("collab-1", mutationMsg, roster)).toEqual({ allowed: true });

    // Presence ist für Gäste und Kollaborateure erlaubt
    expect(
      authorizeCollabAction("guest-1", { kind: "app", topic: "presence-cursor", payload: { x: 1, y: 2 } }, roster),
    ).toEqual({ allowed: true });

    // Selbst-Umbenennung wird bei aktiviertem nameLocked blockiert
    expect(
      authorizeCollabAction("guest-locked", {
        kind: "control",
        action: COLLAB_CONTROL_ACTION_RENAME_SELF,
        payload: { displayName: "Neu" },
      }, roster),
    ).toMatchObject({ allowed: false, code: "name-locked" });

    expect(
      authorizeCollabAction("guest-1", {
        kind: "control",
        action: COLLAB_CONTROL_ACTION_RENAME_SELF,
        payload: { displayName: "Gustav Neu" },
      }, roster),
    ).toEqual({ allowed: true });

    // Hand heben: eigene Hand für alle erlaubt, fremde Hand nur für Host
    expect(
      authorizeCollabAction("guest-1", {
        kind: "control",
        action: COLLAB_CONTROL_ACTION_HAND_STATE,
        payload: { raised: true },
      }, roster),
    ).toEqual({ allowed: true });

    expect(
      authorizeCollabAction("collab-1", {
        kind: "control",
        action: COLLAB_CONTROL_ACTION_HAND_STATE,
        payload: { raised: false, targetPeerId: "guest-1" },
      }, roster),
    ).toMatchObject({ allowed: false, code: "host-only" });

    expect(
      authorizeCollabAction("host-1", {
        kind: "control",
        action: COLLAB_CONTROL_ACTION_HAND_STATE,
        payload: { raised: false, targetPeerId: "guest-1" },
      }, roster),
    ).toEqual({ allowed: true });

    // Moderations- und Roster-Nachrichten sind ausschließlich Host-Sache
    for (const action of [
      COLLAB_CONTROL_ACTION_ROSTER_SNAPSHOT,
      COLLAB_CONTROL_ACTION_ROLE_UPDATE,
      COLLAB_CONTROL_ACTION_MODERATE_NAME,
      COLLAB_CONTROL_ACTION_ACTION_REJECTED,
    ]) {
      expect(
        authorizeCollabAction("collab-1", { kind: "control", action, payload: {} }, roster),
      ).toMatchObject({ allowed: false, code: "host-only" });
    }
  });
});

describe("collabInviteLink & collabStorage (Hash-Links, Sidecar-Validierung & Anzeigename)", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => {
          store.clear();
        },
      },
    };
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it("erzeugt Hash-basierte Einladungslinks ohne Query-String und erkennt Localhost-Sidecars", () => {
    const token = "AbCdEfGhIjKlMnOpQrStUvWx";
    const localResult = buildCollabInviteLink({
      inviteToken: token,
      pageUrl: "http://localhost:5173/index.html?ignored=1",
    });
    expect(localResult.url).toBe(`http://localhost:5173/index.html#collabInvite=${token}`);
    expect(localResult.url).not.toContain("?");
    expect(localResult.isLocalhostSidecar).toBe(true);

    const pagesWithRemoteSidecar = buildCollabInviteLink({
      inviteToken: token,
      pageUrl: "https://afe-gmdg.github.io/logic-circuit-web/",
      sidecarBaseUrl: "https://relay.example.org:8443/",
    });
    expect(pagesWithRemoteSidecar.isLocalhostSidecar).toBe(false);
    expect(pagesWithRemoteSidecar.sidecarUrl).toBe("https://relay.example.org:8443");
    expect(pagesWithRemoteSidecar.url).toBe(
      `https://afe-gmdg.github.io/logic-circuit-web/#collabInvite=${token}&sidecar=https%3A%2F%2Frelay.example.org%3A8443`,
    );

    expect(isLocalhostSidecarUrl("http://127.0.0.1:3001")).toBe(true);
    expect(isLocalhostSidecarUrl("http://[::1]:3001")).toBe(true);
    expect(isLocalhostSidecarUrl("https://relay.example.org")).toBe(false);
  });

  it("parst vollständige Links, Hash-Fragmente sowie rohe Tokens und blockiert unsichere Remote-Sidecars", () => {
    const token = "Token_1234567890_ABCDEF";
    const parsedFull = parseCollabInviteLink(
      `https://afe-gmdg.github.io/logic-circuit-web/#collabInvite=${token}&sidecar=https%3A%2F%2Fsidecar.example.com`,
      { protocol: "https:", host: "afe-gmdg.github.io", origin: "https://afe-gmdg.github.io" },
    );
    expect(parsedFull).toEqual({
      inviteToken: token,
      sidecarUrl: "https://sidecar.example.com",
      isRemoteSidecar: true,
      isLocalhostSidecar: false,
      sidecarError: null,
    });

    const parsedHashOnly = parseCollabInviteLink(`#collabInvite=${token}`);
    expect(parsedHashOnly).toEqual({
      inviteToken: token,
      sidecarUrl: null,
      isRemoteSidecar: false,
      isLocalhostSidecar: false,
      sidecarError: null,
    });

    const parsedRawToken = parseCollabInviteLink(token);
    expect(parsedRawToken?.inviteToken).toBe(token);

    // Unsicheres http:// für entfernte Sidecars wird abgelehnt
    const insecureRemote = parseCollabInviteLink(
      `#collabInvite=${token}&sidecar=${encodeURIComponent("http://remote-insecure.example.com:3001")}`,
      { protocol: "http:", host: "localhost:5173", origin: "http://localhost:5173" },
    );
    expect(insecureRemote?.sidecarUrl).toBeNull();
    expect(insecureRemote?.sidecarError).toBeTruthy();

    expect(stripCollabInviteFromHash(`#collabInvite=${token}&sidecar=https%3A%2F%2Fa.de&view=top`)).toBe("#view=top");
    expect(stripCollabInviteFromHash(`#collabInvite=${token}`)).toBe("");
  });

  it("speichert und lädt den Pflicht-Anzeigenamen im localStorage", () => {
    expect(loadCollabDisplayName()).toBe("");
    saveCollabDisplayName("  Andreas  ");
    expect(window.localStorage.getItem(COLLAB_DISPLAY_NAME_STORAGE_KEY)).toBe("Andreas");
    expect(loadCollabDisplayName()).toBe("Andreas");

    saveCollabDisplayName("   ");
    expect(loadCollabDisplayName()).toBe("");

    saveCollabDisplayName("Max");
    clearCollabDisplayName();
    expect(loadCollabDisplayName()).toBe("");
  });
});
