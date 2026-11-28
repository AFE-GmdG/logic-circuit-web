import type {
  CollabCloseSessionPayload,
  CollabCreateInvitePayload,
  CollabCreateSessionPayload,
  CollabJoinInvitePayload,
  CollabKickPeerPayload,
  CollabLeaveSessionPayload,
  CollabRevokeInvitePayload,
  CollabSignalForwardPayload,
  CollabSignalingErrorPayload,
  CollabTransferHostPayload,
} from "../src/types/collab/signalingMessage.ts";

import {
  COLLAB_EVENT_CLOSE_SESSION,
  COLLAB_EVENT_CREATE_INVITE,
  COLLAB_EVENT_CREATE_SESSION,
  COLLAB_EVENT_ERROR,
  COLLAB_EVENT_JOIN_INVITE,
  COLLAB_EVENT_KICK_PEER,
  COLLAB_EVENT_LEAVE,
  COLLAB_EVENT_PING,
  COLLAB_EVENT_PONG,
  COLLAB_EVENT_REVOKE_INVITE,
  COLLAB_EVENT_SIGNAL,
  COLLAB_EVENT_TRANSFER_HOST,
} from "../src/collab/collabEvents.ts";

import CollabSignalingRelay, {
  CollabSignalingError,
  type CollabRelayClient,
} from "./collabSignalingRelay.ts";
import type WebSocketConnection from "./webSocketConnection.ts";

type WsEnvelope = {
  event?: unknown;
  payload?: unknown;
};

export type AttachCollabWebSocketOptions = {
  registrationTimeoutMs?: number;
};

const DEFAULT_REGISTRATION_TIMEOUT_MS = 10000;

function sendError(client: CollabRelayClient, error: unknown): void {
  if (error instanceof CollabSignalingError) {
    const payload: CollabSignalingErrorPayload = {
      code: error.code,
      message: error.message,
    };
    client.send(COLLAB_EVENT_ERROR, payload);
    return;
  }

  const payload: CollabSignalingErrorPayload = {
    code: "invalid-payload",
    message: error instanceof Error ? error.message : "Unbekannter Signaling-Fehler.",
  };
  client.send(COLLAB_EVENT_ERROR, payload);
}

// Verknüpft eine WebSocketConnection mit dem In-Memory-CollabSignalingRelay
export function attachCollabWebSocket(
  conn: WebSocketConnection,
  relay: CollabSignalingRelay,
  activeConnections: Set<WebSocketConnection>,
  options: AttachCollabWebSocketOptions = {},
): void {
  activeConnections.add(conn);
  const registrationTimeoutMs = options.registrationTimeoutMs ?? DEFAULT_REGISTRATION_TIMEOUT_MS;

  const client: CollabRelayClient = {
    send(event: string, payload?: unknown) {
      conn.sendText(JSON.stringify({ event, payload }));
    },
    close(code?: number, reason?: string) {
      conn.close(code, reason);
    },
  };

  const registrationTimer = registrationTimeoutMs > 0
    ? setTimeout(() => {
      if (!relay.isClientRegistered(client)) {
        const timeoutPayload: CollabSignalingErrorPayload = {
          code: "hello-timeout",
          message: "Anmeldung (Session-Erstellung oder Einladungs-Beitritt) Zeitüberschreitung.",
        };
        client.send(COLLAB_EVENT_ERROR, timeoutPayload);
        conn.close(4000, "Registration timeout");
      }
    }, registrationTimeoutMs)
    : null;
  registrationTimer?.unref();

  conn.onMessage((raw) => {
    let envelope: WsEnvelope;
    try {
      envelope = JSON.parse(raw) as WsEnvelope;
    } catch (_error) {
      sendError(client, new CollabSignalingError("invalid-payload", "Ungültiges JSON über WebSocket."));
      return;
    }

    if (typeof envelope.event !== "string") {
      return;
    }

    try {
      switch (envelope.event) {
        case COLLAB_EVENT_CREATE_SESSION: {
          const payload = (envelope.payload ?? {}) as CollabCreateSessionPayload;
          relay.createSession(client, payload);
          if (registrationTimer) {
            clearTimeout(registrationTimer);
          }
          break;
        }
        case COLLAB_EVENT_JOIN_INVITE: {
          const payload = (envelope.payload ?? {}) as CollabJoinInvitePayload;
          relay.joinWithInvite(client, payload);
          if (registrationTimer) {
            clearTimeout(registrationTimer);
          }
          break;
        }
        case COLLAB_EVENT_CREATE_INVITE: {
          relay.createInvite(client, (envelope.payload ?? {}) as CollabCreateInvitePayload);
          break;
        }
        case COLLAB_EVENT_REVOKE_INVITE: {
          relay.revokeInvite(client, (envelope.payload ?? {}) as CollabRevokeInvitePayload);
          break;
        }
        case COLLAB_EVENT_SIGNAL: {
          relay.relaySignal(client, (envelope.payload ?? {}) as CollabSignalForwardPayload);
          break;
        }
        case COLLAB_EVENT_TRANSFER_HOST: {
          relay.transferHost(client, (envelope.payload ?? {}) as CollabTransferHostPayload);
          break;
        }
        case COLLAB_EVENT_KICK_PEER: {
          relay.kickPeer(client, (envelope.payload ?? {}) as CollabKickPeerPayload);
          break;
        }
        case COLLAB_EVENT_CLOSE_SESSION: {
          relay.closeSession(client, (envelope.payload ?? {}) as CollabCloseSessionPayload);
          break;
        }
        case COLLAB_EVENT_LEAVE: {
          const payload = (envelope.payload ?? {}) as CollabLeaveSessionPayload;
          relay.leaveSession(client, typeof payload.reason === "string" ? payload.reason : "left");
          conn.close(1000, "Client leave");
          break;
        }
        case COLLAB_EVENT_PING: {
          client.send(COLLAB_EVENT_PONG, {});
          break;
        }
        default:
          break;
      }
    } catch (error) {
      sendError(client, error);
      if (
        error instanceof CollabSignalingError &&
        (error.code === "unauthorized" ||
          error.code === "invite-invalid" ||
          error.code === "invite-expired" ||
          error.code === "invite-revoked" ||
          error.code === "session-not-found" ||
          error.code === "session-limit-reached" ||
          error.code === "peer-limit-reached") &&
        !relay.isClientRegistered(client)
      ) {
        conn.close(4001, error.code);
      }
    }
  });

  conn.onError(() => {
    // TCP-Fehler werden über onClose bereinigt
  });

  conn.onClose(() => {
    if (registrationTimer) {
      clearTimeout(registrationTimer);
    }
    activeConnections.delete(conn);
    relay.disconnectClient(client);
  });
}

export default attachCollabWebSocket;
