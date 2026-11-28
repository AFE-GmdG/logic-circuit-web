import type CollabSignalingEnvelope from "../types/collab/signalingMessage";
import type {
  CollabCloseSessionPayload,
  CollabCreateInvitePayload,
  CollabCreateSessionPayload,
  CollabHostChangedPayload,
  CollabInviteCreatedPayload,
  CollabInviteRevokedPayload,
  CollabJoinedSessionPayload,
  CollabJoinInvitePayload,
  CollabKickPeerPayload,
  CollabPeerJoinedPayload,
  CollabPeerLeftPayload,
  CollabRevokeInvitePayload,
  CollabSessionClosedPayload,
  CollabSessionCreatedPayload,
  CollabSignalForwardPayload,
  CollabSignalingErrorCode,
  CollabSignalingErrorPayload,
  CollabSignalRelayedPayload,
  CollabTransferHostPayload,
} from "../types/collab/signalingMessage";

import { isCollabDisabledByEnv, resolveCollabWsUrl } from "../utils/collabIceConfig";

import {
  COLLAB_EVENT_CLOSE_SESSION,
  COLLAB_EVENT_CREATE_INVITE,
  COLLAB_EVENT_CREATE_SESSION,
  COLLAB_EVENT_ERROR,
  COLLAB_EVENT_HOST_CHANGED,
  COLLAB_EVENT_INVITE_CREATED,
  COLLAB_EVENT_INVITE_REVOKED,
  COLLAB_EVENT_JOIN_INVITE,
  COLLAB_EVENT_JOINED,
  COLLAB_EVENT_KICK_PEER,
  COLLAB_EVENT_LEAVE,
  COLLAB_EVENT_PEER_JOINED,
  COLLAB_EVENT_PEER_LEFT,
  COLLAB_EVENT_PING,
  COLLAB_EVENT_PONG,
  COLLAB_EVENT_REVOKE_INVITE,
  COLLAB_EVENT_SESSION_CLOSED,
  COLLAB_EVENT_SESSION_CREATED,
  COLLAB_EVENT_SIGNAL,
  COLLAB_EVENT_SIGNAL_RELAYED,
  COLLAB_EVENT_TRANSFER_HOST,
} from "./collabEvents";

export type SignalingClientState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export type CollabSignalingCloseInfo = {
  code: number;
  reason: string;
};

export type CollabSignalingSocketLike = {
  send: (text: string) => void;
  close: (code?: number, reason?: string) => void;
};

export type CollabSignalingSocketHandlers = {
  url: string;
  onOpen: () => void;
  onMessage: (rawText: string) => void;
  onError: (error: Error) => void;
  onClose: (code: number, reason: string) => void;
};

export type CollabSignalingSocketFactory = (handlers: CollabSignalingSocketHandlers) => CollabSignalingSocketLike;

export type SignalingClientOptions = {
  wsUrl?: string;
  sidecarBaseUrl?: string;
  socketFactory?: CollabSignalingSocketFactory;
  disabledOverride?: boolean;
  requestTimeoutMs?: number;
  keepaliveIntervalMs?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  maxReconnectAttempts?: number;
};

export type SignalingClientErrorCode =
  | CollabSignalingErrorCode
  | "disabled"
  | "not-connected"
  | "connection-closed"
  | "timeout";

export class SignalingClientError extends Error {
  readonly code: SignalingClientErrorCode;
  readonly closeCode?: number;
  readonly closeReason?: string;

  constructor(code: SignalingClientErrorCode, message: string, closeInfo?: { closeCode?: number; closeReason?: string }) {
    super(message);
    this.name = "SignalingClientError";
    this.code = code;
    this.closeCode = closeInfo?.closeCode;
    this.closeReason = closeInfo?.closeReason;
  }
}

type PendingResponseWaiter = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_KEEPALIVE_INTERVAL_MS = 20000;
const DEFAULT_RECONNECT_BASE_MS = 1000;
const DEFAULT_RECONNECT_MAX_MS = 15000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 4;
const PERMANENT_CLOSE_CODES = new Set([4001, 4003]);

function createBrowserSocketFactory(): CollabSignalingSocketFactory {
  return ({ url, onOpen, onMessage, onError, onClose }) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => {
      onOpen();
    });
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        onMessage(event.data);
      }
    });
    ws.addEventListener("error", () => {
      onError(new Error("WebSocket-Verbindungsfehler zum Signaling-Server."));
    });
    ws.addEventListener("close", (event) => {
      onClose(event.code, event.reason);
    });
    return {
      send: (text) => ws.send(text),
      close: (code, reason) => ws.close(code, reason),
    };
  };
}

// Clientseitige WebSocket-Abstraktion für den flüchtigen WebRTC-Signaling-Handshake (/ws-collab)
class SignalingClient {
  readonly #wsUrl: string;
  readonly #socketFactory: CollabSignalingSocketFactory;
  readonly #isDisabled: boolean;
  readonly #requestTimeoutMs: number;
  readonly #keepaliveIntervalMs: number;
  readonly #reconnectBaseDelayMs: number;
  readonly #reconnectMaxDelayMs: number;
  readonly #maxReconnectAttempts: number;

  readonly #pendingBySuccessEvent = new Map<string, PendingResponseWaiter[]>();
  readonly #peerJoinedListeners = new Set<(payload: CollabPeerJoinedPayload) => void>();
  readonly #peerLeftListeners = new Set<(payload: CollabPeerLeftPayload) => void>();
  readonly #signalListeners = new Set<(payload: CollabSignalRelayedPayload) => void>();
  readonly #hostChangedListeners = new Set<(payload: CollabHostChangedPayload) => void>();
  readonly #sessionClosedListeners = new Set<(payload: CollabSessionClosedPayload) => void>();
  readonly #errorListeners = new Set<(error: SignalingClientError) => void>();
  readonly #stateListeners = new Set<(state: SignalingClientState) => void>();
  readonly #closeListeners = new Set<(info: CollabSignalingCloseInfo) => void>();

  #socket: CollabSignalingSocketLike | null = null;
  #state: SignalingClientState = "idle";
  #connectPromise: Promise<void> | null = null;
  #keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectAttempt = 0;
  #manualDisconnect = false;

  constructor(options: SignalingClientOptions = {}) {
    this.#wsUrl = options.wsUrl ?? resolveCollabWsUrl(options.sidecarBaseUrl);
    this.#socketFactory = options.socketFactory ?? createBrowserSocketFactory();
    this.#isDisabled = options.disabledOverride !== undefined
      ? options.disabledOverride
      : isCollabDisabledByEnv();
    this.#requestTimeoutMs = Math.max(500, options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    this.#keepaliveIntervalMs = Math.max(0, options.keepaliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS);
    this.#reconnectBaseDelayMs = Math.max(50, options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_MS);
    this.#reconnectMaxDelayMs = Math.max(this.#reconnectBaseDelayMs, options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_MS);
    this.#maxReconnectAttempts = Math.max(0, options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS);
  }

  get state(): SignalingClientState {
    return this.#state;
  }

  get isDisabled(): boolean {
    return this.#isDisabled;
  }

  connect(): Promise<void> {
    if (this.#isDisabled) {
      return Promise.reject(new SignalingClientError("disabled", "WebRTC-Kollaboration ist in diesem Build deaktiviert."));
    }
    if (this.#wsUrl.trim().length === 0) {
      return Promise.reject(
        new SignalingClientError("disabled", "Keine Sidecar-URL für WebRTC-Kollaboration konfiguriert."),
      );
    }
    if (this.#state === "open" && this.#socket) {
      return Promise.resolve();
    }
    if (this.#connectPromise) {
      return this.#connectPromise;
    }

    this.#manualDisconnect = false;
    this.#clearReconnectTimer();
    this.#setState("connecting");
    this.#connectPromise = this.#openSocket();
    return this.#connectPromise;
  }

  async createSession(payload: CollabCreateSessionPayload = {}): Promise<CollabSessionCreatedPayload> {
    return this.#sendAndWait<CollabSessionCreatedPayload>(
      COLLAB_EVENT_CREATE_SESSION,
      payload,
      COLLAB_EVENT_SESSION_CREATED,
    );
  }

  async createInvite(payload: CollabCreateInvitePayload): Promise<CollabInviteCreatedPayload> {
    return this.#sendAndWait<CollabInviteCreatedPayload>(
      COLLAB_EVENT_CREATE_INVITE,
      payload,
      COLLAB_EVENT_INVITE_CREATED,
    );
  }

  async revokeInvite(payload: CollabRevokeInvitePayload): Promise<CollabInviteRevokedPayload> {
    return this.#sendAndWait<CollabInviteRevokedPayload>(
      COLLAB_EVENT_REVOKE_INVITE,
      payload,
      COLLAB_EVENT_INVITE_REVOKED,
    );
  }

  async joinWithInvite(payload: CollabJoinInvitePayload): Promise<CollabJoinedSessionPayload> {
    return this.#sendAndWait<CollabJoinedSessionPayload>(
      COLLAB_EVENT_JOIN_INVITE,
      payload,
      COLLAB_EVENT_JOINED,
    );
  }

  sendSignal(payload: CollabSignalForwardPayload): void {
    this.#sendEnvelope(COLLAB_EVENT_SIGNAL, payload);
  }

  transferHost(payload: CollabTransferHostPayload): void {
    this.#sendEnvelope(COLLAB_EVENT_TRANSFER_HOST, payload);
  }

  kickPeer(payload: CollabKickPeerPayload): void {
    this.#sendEnvelope(COLLAB_EVENT_KICK_PEER, payload);
  }

  closeSession(payload: CollabCloseSessionPayload): void {
    this.#sendEnvelope(COLLAB_EVENT_CLOSE_SESSION, payload);
  }

  leaveSession(reason = "left"): void {
    if (this.#socket && this.#state === "open") {
      this.#sendEnvelope(COLLAB_EVENT_LEAVE, { reason });
    }
  }

  disconnect(): void {
    this.#manualDisconnect = true;
    this.#clearKeepalive();
    this.#clearReconnectTimer();
    this.#connectPromise = null;
    this.#rejectAllWaiters(new SignalingClientError("connection-closed", "Signaling-Verbindung wurde lokal beendet."));

    const socket = this.#socket;
    this.#socket = null;
    this.#setState("closed");
    if (socket) {
      try {
        socket.close(1000, "Client disconnect");
      } catch (_error) {
        // Socket konnte bereits geschlossen sein
      }
    }
  }

  onPeerJoined(listener: (payload: CollabPeerJoinedPayload) => void): () => void {
    this.#peerJoinedListeners.add(listener);
    return () => {
      this.#peerJoinedListeners.delete(listener);
    };
  }

  onPeerLeft(listener: (payload: CollabPeerLeftPayload) => void): () => void {
    this.#peerLeftListeners.add(listener);
    return () => {
      this.#peerLeftListeners.delete(listener);
    };
  }

  onSignal(listener: (payload: CollabSignalRelayedPayload) => void): () => void {
    this.#signalListeners.add(listener);
    return () => {
      this.#signalListeners.delete(listener);
    };
  }

  onHostChanged(listener: (payload: CollabHostChangedPayload) => void): () => void {
    this.#hostChangedListeners.add(listener);
    return () => {
      this.#hostChangedListeners.delete(listener);
    };
  }

  onSessionClosed(listener: (payload: CollabSessionClosedPayload) => void): () => void {
    this.#sessionClosedListeners.add(listener);
    return () => {
      this.#sessionClosedListeners.delete(listener);
    };
  }

  onError(listener: (error: SignalingClientError) => void): () => void {
    this.#errorListeners.add(listener);
    return () => {
      this.#errorListeners.delete(listener);
    };
  }

  onStateChange(listener: (state: SignalingClientState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => {
      this.#stateListeners.delete(listener);
    };
  }

  onClose(listener: (info: CollabSignalingCloseInfo) => void): () => void {
    this.#closeListeners.add(listener);
    return () => {
      this.#closeListeners.delete(listener);
    };
  }

  #openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket: CollabSignalingSocketLike | null = null;

      try {
        socket = this.#socketFactory({
          url: this.#wsUrl,
          onOpen: () => {
            if (this.#manualDisconnect) {
              socket?.close(1000, "Client disconnect");
              return;
            }
            this.#socket = socket;
            this.#connectPromise = null;
            this.#reconnectAttempt = 0;
            this.#setState("open");
            this.#startKeepalive();
            if (!settled) {
              settled = true;
              resolve();
            }
          },
          onMessage: (rawText) => {
            this.#handleMessage(rawText);
          },
          onError: (err) => {
            const clientErr = new SignalingClientError("connection-closed", err.message);
            this.#emitError(clientErr);
            if (!settled) {
              settled = true;
              this.#connectPromise = null;
              reject(clientErr);
            }
          },
          onClose: (code, reason) => {
            this.#clearKeepalive();
            if (this.#socket === socket) {
              this.#socket = null;
            }
            this.#connectPromise = null;
            const isPermanentClose = PERMANENT_CLOSE_CODES.has(code);
            const closeErr = new SignalingClientError(
              "connection-closed",
              reason && reason.trim().length > 0
                ? `Verbindung zum Signaling-Server geschlossen (${reason}).`
                : "Verbindung zum Signaling-Server geschlossen.",
              { closeCode: code, closeReason: reason },
            );
            this.#rejectAllWaiters(closeErr);
            for (const listener of this.#closeListeners) {
              listener({ code, reason });
            }

            if (!settled) {
              settled = true;
              this.#setState(this.#manualDisconnect || isPermanentClose ? "closed" : "reconnecting");
              reject(closeErr);
              return;
            }

            if (this.#manualDisconnect || isPermanentClose) {
              this.#setState("closed");
              return;
            }

            this.#scheduleReconnect();
          },
        });
      } catch (error) {
        const clientErr = new SignalingClientError(
          "connection-closed",
          error instanceof Error ? error.message : String(error),
        );
        this.#connectPromise = null;
        this.#setState("closed");
        reject(clientErr);
      }
    });
  }

  #sendAndWait<TResult>(
    requestEvent: string,
    payload: unknown,
    expectedEvent: string,
  ): Promise<TResult> {
    if (!this.#socket || this.#state !== "open") {
      return Promise.reject(new SignalingClientError("not-connected", "Keine aktive Verbindung zum Signaling-Server."));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#removeWaiter(expectedEvent, waiter);
        reject(new SignalingClientError("timeout", `Signaling-Antwort (${expectedEvent}) hat das Zeitlimit überschritten.`));
      }, this.#requestTimeoutMs);

      const waiter: PendingResponseWaiter = {
        resolve: (value) => resolve(value as TResult),
        reject,
        timer,
      };

      const queue = this.#pendingBySuccessEvent.get(expectedEvent) ?? [];
      queue.push(waiter);
      this.#pendingBySuccessEvent.set(expectedEvent, queue);

      try {
        this.#sendEnvelope(requestEvent, payload);
      } catch (error) {
        clearTimeout(timer);
        this.#removeWaiter(expectedEvent, waiter);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  #sendEnvelope(event: string, payload?: unknown): void {
    if (!this.#socket || this.#state !== "open") {
      throw new SignalingClientError("not-connected", "Keine aktive Verbindung zum Signaling-Server.");
    }
    this.#socket.send(JSON.stringify({ event, payload }));
  }

  #handleMessage(rawText: string): void {
    let envelope: CollabSignalingEnvelope;
    try {
      envelope = JSON.parse(rawText) as CollabSignalingEnvelope;
    } catch (_error) {
      return;
    }

    if (!envelope || typeof envelope.event !== "string") {
      return;
    }

    if (envelope.event === COLLAB_EVENT_PONG) {
      return;
    }

    if (envelope.event === COLLAB_EVENT_ERROR) {
      const errPayload = (envelope.payload ?? {}) as Partial<CollabSignalingErrorPayload>;
      const code = typeof errPayload.code === "string" ? errPayload.code : "invalid-payload";
      const message = typeof errPayload.message === "string" ? errPayload.message : "Unbekannter Signaling-Fehler.";
      const clientError = new SignalingClientError(code, message);

      const nextWaiter = this.#shiftOldestWaiter();
      if (nextWaiter) {
        clearTimeout(nextWaiter.timer);
        nextWaiter.reject(clientError);
      }
      this.#emitError(clientError);
      return;
    }

    const pendingQueue = this.#pendingBySuccessEvent.get(envelope.event);
    if (pendingQueue && pendingQueue.length > 0) {
      const waiter = pendingQueue.shift();
      if (pendingQueue.length === 0) {
        this.#pendingBySuccessEvent.delete(envelope.event);
      }
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(envelope.payload);
      }
    }

    switch (envelope.event) {
      case COLLAB_EVENT_PEER_JOINED:
        for (const listener of this.#peerJoinedListeners) {
          listener(envelope.payload as CollabPeerJoinedPayload);
        }
        break;
      case COLLAB_EVENT_PEER_LEFT:
        for (const listener of this.#peerLeftListeners) {
          listener(envelope.payload as CollabPeerLeftPayload);
        }
        break;
      case COLLAB_EVENT_SIGNAL_RELAYED:
        for (const listener of this.#signalListeners) {
          listener(envelope.payload as CollabSignalRelayedPayload);
        }
        break;
      case COLLAB_EVENT_HOST_CHANGED:
        for (const listener of this.#hostChangedListeners) {
          listener(envelope.payload as CollabHostChangedPayload);
        }
        break;
      case COLLAB_EVENT_SESSION_CLOSED:
        for (const listener of this.#sessionClosedListeners) {
          listener(envelope.payload as CollabSessionClosedPayload);
        }
        break;
      default:
        break;
    }
  }

  #startKeepalive(): void {
    this.#clearKeepalive();
    if (this.#keepaliveIntervalMs <= 0) {
      return;
    }
    this.#keepaliveTimer = setInterval(() => {
      if (this.#socket && this.#state === "open") {
        try {
          this.#sendEnvelope(COLLAB_EVENT_PING, {});
        } catch (_error) {
          // Fehler wird über onClose/onError abgefangen
        }
      }
    }, this.#keepaliveIntervalMs);
  }

  #clearKeepalive(): void {
    if (this.#keepaliveTimer !== null) {
      clearInterval(this.#keepaliveTimer);
      this.#keepaliveTimer = null;
    }
  }

  #scheduleReconnect(): void {
    if (this.#manualDisconnect || this.#reconnectAttempt >= this.#maxReconnectAttempts) {
      this.#setState("closed");
      return;
    }
    this.#setState("reconnecting");
    const delayMs = Math.min(
      this.#reconnectMaxDelayMs,
      this.#reconnectBaseDelayMs * Math.pow(2, this.#reconnectAttempt),
    );
    this.#reconnectAttempt += 1;
    this.#clearReconnectTimer();
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (this.#manualDisconnect) {
        return;
      }
      this.#connectPromise = this.#openSocket();
      void this.#connectPromise.catch(() => {
        // Nächster Backoff-Versuch wird über onClose geplant
      });
    }, delayMs);
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #removeWaiter(event: string, target: PendingResponseWaiter): void {
    const queue = this.#pendingBySuccessEvent.get(event);
    if (!queue) {
      return;
    }
    const index = queue.indexOf(target);
    if (index >= 0) {
      queue.splice(index, 1);
    }
    if (queue.length === 0) {
      this.#pendingBySuccessEvent.delete(event);
    }
  }

  #shiftOldestWaiter(): PendingResponseWaiter | undefined {
    for (const [event, queue] of this.#pendingBySuccessEvent.entries()) {
      const waiter = queue.shift();
      if (queue.length === 0) {
        this.#pendingBySuccessEvent.delete(event);
      }
      if (waiter) {
        return waiter;
      }
    }
    return undefined;
  }

  #rejectAllWaiters(error: Error): void {
    for (const queue of this.#pendingBySuccessEvent.values()) {
      for (const waiter of queue) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
    this.#pendingBySuccessEvent.clear();
  }

  #setState(next: SignalingClientState): void {
    if (this.#state === next) {
      return;
    }
    this.#state = next;
    for (const listener of this.#stateListeners) {
      listener(next);
    }
  }

  #emitError(error: SignalingClientError): void {
    for (const listener of this.#errorListeners) {
      listener(error);
    }
  }
}

export default SignalingClient;
