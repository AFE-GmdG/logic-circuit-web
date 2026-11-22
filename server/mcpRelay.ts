import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import type McpBridgeRequest from "../src/types/mcp/mcpBridgeRequest.ts";
import type McpBridgeResponse from "../src/types/mcp/mcpBridgeResponse.ts";

import {
  MCP_EVENT_ACK,
  MCP_EVENT_REQUEST,
} from "../src/mcp/mcpEvents.ts";

// Minimale Client-Sicht für das zustandslose Remote-Relay
export type RelayClient = {
  send: (event: string, payload?: unknown) => void;
  close?: (code?: number, reason?: string) => void;
};

export type RegisterRelayOptions = {
  sessionId?: string;
  reconnectToken?: string;
  accessKey?: string;
};

export type RegisteredRelaySession = {
  sessionId: string;
  reconnectToken: string;
};

type RelaySession = {
  sessionId: string;
  reconnectToken: string;
  client: RelayClient | null;
  lastSeenAt: number;
  disconnectedAt: number | null;
};

type PendingRelayRequest = {
  sessionId: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type McpRelayOptions = {
  timeoutMs?: number;
  accessKey?: string;
  gracePeriodMs?: number;
};

const SESSION_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const SESSION_ID_REGEX = /^[A-Za-z0-9_-]{8,64}$/;

export class MissingSessionIdError extends Error {
  constructor() {
    super(
      "Keine Remote-SessionID angegeben. Bitte die SessionID aus dem Logic-Circuit-Verbindungsdialog übergeben.",
    );
    this.name = "MissingSessionIdError";
  }
}

export class UnknownSessionError extends Error {
  constructor(sessionId: string) {
    super(
      `Keine aktive LogicCircuit-Browsersitzung für SessionID "${sessionId}" gefunden. Bitte Verbindung im Browser prüfen.`,
    );
    this.name = "UnknownSessionError";
  }
}

export class UnauthorizedRelayError extends Error {
  constructor() {
    super("Ungültiger oder fehlender Zugangsschlüssel (MCP_ACCESS_KEY).");
    this.name = "UnauthorizedRelayError";
  }
}

function hashSecret(value: string): Buffer {
  return createHash("sha256").update(value, "utf-8").digest();
}

function constantTimeEquals(a: string, b: string): boolean {
  return timingSafeEqual(hashSecret(a), hashSecret(b));
}

function createEphemeralSessionId(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g += 1) {
    let part = "";
    for (let i = 0; i < 4; i += 1) {
      part += SESSION_ALPHABET[randomInt(0, SESSION_ALPHABET.length)];
    }
    groups.push(part);
  }
  return groups.join("-");
}

function createReconnectToken(): string {
  return randomBytes(24).toString("base64url");
}

// Zustandsloses In-Memory-Relay: hält SessionIDs ausschließlich flüchtig im Arbeitsspeicher ohne Persistenz
class McpRelay {
  readonly #timeoutMs: number;
  readonly #accessKey: string;
  readonly #gracePeriodMs: number;
  readonly #sessions = new Map<string, RelaySession>();
  readonly #clientToSessionId = new Map<RelayClient, string>();
  readonly #pending = new Map<string, PendingRelayRequest>();
  #nextRequestId = 1;

  constructor(options: McpRelayOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? 60000;
    this.#accessKey = (options.accessKey ?? "").trim();
    this.#gracePeriodMs = options.gracePeriodMs ?? 120000;
  }

  get requiresAccessKey(): boolean {
    return this.#accessKey.length > 0;
  }

  get activeSessionCount(): number {
    this.#cleanupExpired();
    let count = 0;
    for (const session of this.#sessions.values()) {
      if (session.client !== null) {
        count += 1;
      }
    }
    return count;
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  verifyAccessKey(candidate: unknown): boolean {
    if (!this.requiresAccessKey) {
      return true;
    }
    if (typeof candidate !== "string" || candidate.length === 0) {
      return false;
    }
    return constantTimeEquals(candidate, this.#accessKey);
  }

  // Meldet eine Browsersitzung an oder übernimmt eine bestehende Sitzung bei gültigem Reconnect-Token
  registerSession(client: RelayClient, options: RegisterRelayOptions = {}): RegisteredRelaySession {
    if (!this.verifyAccessKey(options.accessKey)) {
      throw new UnauthorizedRelayError();
    }

    this.#cleanupExpired();

    const requestedId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
    const reconnectToken = typeof options.reconnectToken === "string" ? options.reconnectToken.trim() : "";

    if (requestedId.length > 0 && reconnectToken.length > 0) {
      const existing = this.#sessions.get(requestedId);
      if (existing && constantTimeEquals(reconnectToken, existing.reconnectToken)) {
        if (existing.client && existing.client !== client) {
          this.#clientToSessionId.delete(existing.client);
          existing.client.close?.(4002, "Session reconnected");
        }
        existing.client = client;
        existing.disconnectedAt = null;
        existing.lastSeenAt = Date.now();
        this.#clientToSessionId.set(client, existing.sessionId);
        client.send(MCP_EVENT_ACK, {
          sessionId: existing.sessionId,
          reconnectToken: existing.reconnectToken,
        });
        return {
          sessionId: existing.sessionId,
          reconnectToken: existing.reconnectToken,
        };
      }
    }

    // Falls derselbe Client bereits registriert ist, vorherige Zuordnung sauber lösen
    if (this.#clientToSessionId.has(client)) {
      this.unregisterClient(client, true);
    }

    let sessionId = createEphemeralSessionId();
    while (this.#sessions.has(sessionId)) {
      sessionId = createEphemeralSessionId();
    }
    const freshToken = createReconnectToken();
    const session: RelaySession = {
      sessionId,
      reconnectToken: freshToken,
      client,
      lastSeenAt: Date.now(),
      disconnectedAt: null,
    };
    this.#sessions.set(sessionId, session);
    this.#clientToSessionId.set(client, sessionId);

    client.send(MCP_EVENT_ACK, {
      sessionId,
      reconnectToken: freshToken,
    });
    return {
      sessionId,
      reconnectToken: freshToken,
    };
  }

  // Entfernt einen Client (bei explizitem "bye" sofort, bei Netzabbruch nach kurzer Reconnect-Frist)
  unregisterClient(client: RelayClient, explicitBye = false): void {
    const sessionId = this.#clientToSessionId.get(client);
    if (!sessionId) {
      return;
    }
    this.#clientToSessionId.delete(client);

    const session = this.#sessions.get(sessionId);
    if (!session || session.client !== client) {
      return;
    }

    this.#rejectPendingForSession(sessionId, new UnknownSessionError(sessionId));

    if (explicitBye || this.#gracePeriodMs <= 0) {
      this.#sessions.delete(sessionId);
    } else {
      session.client = null;
      session.disconnectedAt = Date.now();
    }
  }

  touch(client: RelayClient): void {
    const sessionId = this.#clientToSessionId.get(client);
    if (!sessionId) {
      return;
    }
    const session = this.#sessions.get(sessionId);
    if (session) {
      session.lastSeenAt = Date.now();
    }
  }

  // Ordnet eine Browser-Antwort dem wartenden Aufruf derselben Session zu
  handleResponse(client: RelayClient, response: McpBridgeResponse): void {
    const sessionId = this.#clientToSessionId.get(client);
    if (!sessionId || !response || typeof response.id !== "string") {
      return;
    }
    const pending = this.#pending.get(response.id);
    if (!pending || pending.sessionId !== sessionId) {
      return;
    }
    clearTimeout(pending.timer);
    this.#pending.delete(response.id);
    if (typeof response.error === "string") {
      pending.reject(new Error(response.error));
    } else {
      pending.resolve(response.result);
    }
  }

  // Leitet einen Werkzeugaufruf strikt an die angegebene SessionID weiter
  call(sessionId: string | undefined, method: string, params?: unknown): Promise<unknown> {
    this.#cleanupExpired();

    const normalizedId = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!SESSION_ID_REGEX.test(normalizedId)) {
      return Promise.reject(new MissingSessionIdError());
    }

    const session = this.#sessions.get(normalizedId);
    if (!session || !session.client) {
      return Promise.reject(new UnknownSessionError(normalizedId));
    }

    const id = String(this.#nextRequestId++);
    const client = session.client;
    session.lastSeenAt = Date.now();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.#pending.delete(id);
          reject(new Error(`Zeitüberschreitung: Browser hat "${method}" nicht innerhalb von ${this.#timeoutMs} ms beantwortet.`));
        },
        this.#timeoutMs,
      );
      this.#pending.set(id, { sessionId: normalizedId, resolve, reject, timer });

      const request: McpBridgeRequest = { id, method, params };
      client.send(MCP_EVENT_REQUEST, request);
    });
  }

  getStatus(): { activeSessions: number; pendingRequests: number; authRequired: boolean } {
    return {
      activeSessions: this.activeSessionCount,
      pendingRequests: this.pendingCount,
      authRequired: this.requiresAccessKey,
    };
  }

  #rejectPendingForSession(sessionId: string, error: Error): void {
    for (const [id, pending] of this.#pending.entries()) {
      if (pending.sessionId === sessionId) {
        clearTimeout(pending.timer);
        this.#pending.delete(id);
        pending.reject(error);
      }
    }
  }

  #cleanupExpired(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.#sessions.entries()) {
      if (session.disconnectedAt !== null && now - session.disconnectedAt > this.#gracePeriodMs) {
        this.#sessions.delete(sessionId);
      }
    }
  }
}

export default McpRelay;
