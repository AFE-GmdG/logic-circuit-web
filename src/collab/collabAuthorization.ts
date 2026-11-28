import type CollabRole from "../types/collab/collabRole";
import type CollabDataChannelMessage from "../types/collab/dataChannelMessage";
import {
  COLLAB_APP_TOPIC_CATCHUP_RESPONSE,
  COLLAB_APP_TOPIC_CIRCUIT_COMMIT,
  COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REJECTED,
  COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REQUEST,
  COLLAB_APP_TOPIC_HOST_HANDOVER_READY,
  COLLAB_APP_TOPIC_HOST_HANDOVER_STATE,
  COLLAB_APP_TOPIC_PROJECT_SNAPSHOT,
  COLLAB_APP_TOPIC_SESSION_QUIESCE,
  COLLAB_APP_TOPIC_SOFT_LOCK,
  type CollabHostHandoverReadyPayload,
  type CollabMutationRequestPayload,
  type CollabSoftLockPayload,
} from "../types/collab/modelSyncMessage";
import {
  COLLAB_APP_TOPIC_PRESENCE_CURSOR,
  COLLAB_APP_TOPIC_PRESENCE_SNAPSHOT,
  COLLAB_APP_TOPIC_PRESENCE_STATE,
  MAX_PRESENCE_ID_LENGTH,
  MAX_PRESENCE_SELECTION_IDS,
  MAX_PRESENCE_SNAPSHOT_ENTRIES,
} from "../types/collab/presenceMessage";
import type CollabParticipant from "../types/collab/sessionState";
import {
  COLLAB_CONTROL_ACTION_ACTION_REJECTED,
  COLLAB_CONTROL_ACTION_HAND_STATE,
  COLLAB_CONTROL_ACTION_MODERATE_NAME,
  COLLAB_CONTROL_ACTION_RENAME_SELF,
  COLLAB_CONTROL_ACTION_ROLE_UPDATE,
  COLLAB_CONTROL_ACTION_ROSTER_REQUEST,
  COLLAB_CONTROL_ACTION_ROSTER_SNAPSHOT,
  type CollabActionRejectionCode,
  type CollabHandStatePayload,
  type CollabRenameSelfPayload,
} from "../types/collab/sessionState";

export const MAX_COLLAB_DISPLAY_NAME_LENGTH = 64;

export type NormalizedDisplayNameResult =
  | { valid: true; displayName: string }
  | { valid: false; reason: "invalid-type" | "empty" | "too-long"; message: string };

export type CollabAuthorizationResult =
  | { allowed: true }
  | {
    allowed: false;
    code: CollabActionRejectionCode;
    message: string;
    action: string;
  };

const ROLE_SORT_PRIORITY: Record<CollabRole, number> = {
  host: 0,
  collaborator: 1,
  guest: 2,
};

const HOST_ONLY_CONTROL_ACTIONS = new Set([
  COLLAB_CONTROL_ACTION_ROSTER_SNAPSHOT,
  COLLAB_CONTROL_ACTION_ROLE_UPDATE,
  COLLAB_CONTROL_ACTION_MODERATE_NAME,
  COLLAB_CONTROL_ACTION_ACTION_REJECTED,
  "kick-peer",
  "transfer-host",
]);

const HOST_ONLY_APP_TOPICS = new Set<string>([
  "project-snapshot",
  "circuit-snapshot",
  "circuit-commit",
  "circuit-revision-ack",
  COLLAB_APP_TOPIC_PROJECT_SNAPSHOT,
  COLLAB_APP_TOPIC_CIRCUIT_COMMIT,
  COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REJECTED,
  COLLAB_APP_TOPIC_CATCHUP_RESPONSE,
  COLLAB_APP_TOPIC_HOST_HANDOVER_STATE,
  COLLAB_APP_TOPIC_PRESENCE_SNAPSHOT,
  COLLAB_APP_TOPIC_PROJECT_SNAPSHOT,
  COLLAB_APP_TOPIC_SESSION_QUIESCE,
]);

const VALID_SOFT_LOCK_ACTIONS = new Set(["acquire", "renew", "release", "snapshot"]);
const VALID_PRESENCE_DIALOG_KINDS = new Set(["symbol-properties", "text-note", "circuit-properties"]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidPresenceId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_PRESENCE_ID_LENGTH;
}

function isValidPresenceIdArray(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > MAX_PRESENCE_SELECTION_IDS) {
    return false;
  }
  return value.every((entry) => isValidPresenceId(entry));
}

function isValidPresenceSelection(value: unknown): boolean {
  if (!isPlainRecord(value)) {
    return false;
  }
  return (
    isValidPresenceIdArray(value.symbolIds) &&
    isValidPresenceIdArray(value.textNoteIds) &&
    isValidPresenceIdArray(value.wireIds)
  );
}

function isValidPresenceOpenDialog(value: unknown): boolean {
  if (!isPlainRecord(value)) {
    return false;
  }
  return (
    typeof value.kind === "string" &&
    VALID_PRESENCE_DIALOG_KINDS.has(value.kind) &&
    isValidPresenceId(value.targetId) &&
    isValidPresenceId(value.logicalCircuitId)
  );
}

function isValidPresenceViewport(value: unknown): boolean {
  if (!isPlainRecord(value)) {
    return false;
  }
  return (
    typeof value.centerX === "number" &&
    Number.isFinite(value.centerX) &&
    typeof value.centerY === "number" &&
    Number.isFinite(value.centerY) &&
    typeof value.zoom === "number" &&
    Number.isFinite(value.zoom) &&
    value.zoom > 0 &&
    value.zoom <= 100
  );
}

// Validiert einen eingehenden Cursor-Payload (erlaubt für alle Rollen inklusive Gäste)
export function isValidPresenceCursorPayload(payload: unknown): boolean {
  if (!isPlainRecord(payload)) {
    return false;
  }
  if (payload.peerId !== undefined && (typeof payload.peerId !== "string" || payload.peerId.length > MAX_PRESENCE_ID_LENGTH)) {
    return false;
  }
  if (
    payload.logicalCircuitId !== undefined &&
    payload.logicalCircuitId !== null &&
    !isValidPresenceId(payload.logicalCircuitId)
  ) {
    return false;
  }
  if (payload.visible !== undefined && typeof payload.visible !== "boolean") {
    return false;
  }
  if (payload.visible === false) {
    return true;
  }
  return (
    typeof payload.x === "number" &&
    Number.isFinite(payload.x) &&
    typeof payload.y === "number" &&
    Number.isFinite(payload.y)
  );
}

// Validiert einen eingehenden Präsenz-Status-Payload (erlaubt für alle Rollen inklusive Gäste)
export function isValidPresenceStatePayload(payload: unknown): boolean {
  if (!isPlainRecord(payload)) {
    return false;
  }
  if (payload.peerId !== undefined && (typeof payload.peerId !== "string" || payload.peerId.length > MAX_PRESENCE_ID_LENGTH)) {
    return false;
  }
  if (payload.logicalCircuitId !== null && !isValidPresenceId(payload.logicalCircuitId)) {
    return false;
  }
  if (typeof payload.inLibraryMode !== "boolean") {
    return false;
  }
  if (payload.selection !== undefined && !isValidPresenceSelection(payload.selection)) {
    return false;
  }
  if (payload.openDialog !== undefined && payload.openDialog !== null && !isValidPresenceOpenDialog(payload.openDialog)) {
    return false;
  }
  if (payload.viewport !== undefined && payload.viewport !== null && !isValidPresenceViewport(payload.viewport)) {
    return false;
  }
  return true;
}

// Validiert einen hostseitigen Präsenz-Snapshot für Nachzügler und nach Host-Handover
export function isValidPresenceSnapshotPayload(payload: unknown): boolean {
  if (!isPlainRecord(payload) || !Array.isArray(payload.entries) || payload.entries.length > MAX_PRESENCE_SNAPSHOT_ENTRIES) {
    return false;
  }
  for (const entry of payload.entries) {
    if (!isPlainRecord(entry)) {
      return false;
    }
    if (!isValidPresenceId(entry.peerId)) {
      return false;
    }
    if (entry.logicalCircuitId !== null && !isValidPresenceId(entry.logicalCircuitId)) {
      return false;
    }
    if (typeof entry.inLibraryMode !== "boolean") {
      return false;
    }
    if (!isValidPresenceSelection(entry.selection)) {
      return false;
    }
    if (entry.openDialog !== null && !isValidPresenceOpenDialog(entry.openDialog)) {
      return false;
    }
    if (entry.viewport !== null && !isValidPresenceViewport(entry.viewport)) {
      return false;
    }
    if (entry.cursor !== null) {
      if (!isPlainRecord(entry.cursor) || !isValidPresenceCursorPayload(entry.cursor)) {
        return false;
      }
      if (entry.cursor.visible === false) {
        return false;
      }
    }
  }
  return true;
}

// Prüft und normalisiert einen Pflicht-Anzeigenamen (getrimmt, nicht leer, maximal 64 Zeichen)
export function normalizeDisplayName(raw: unknown): NormalizedDisplayNameResult {
  if (typeof raw !== "string") {
    return {
      valid: false,
      reason: "invalid-type",
      message: "Der Anzeigename muss eine Zeichenkette sein.",
    };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      reason: "empty",
      message: "Bitte einen Anzeigenamen angeben.",
    };
  }
  if (trimmed.length > MAX_COLLAB_DISPLAY_NAME_LENGTH) {
    return {
      valid: false,
      reason: "too-long",
      message: `Der Anzeigename darf maximal ${MAX_COLLAB_DISPLAY_NAME_LENGTH} Zeichen lang sein.`,
    };
  }
  return {
    valid: true,
    displayName: trimmed,
  };
}

// Disambiguiert doppelte Anzeigenamen innerhalb einer Session deterministisch (z. B. "Alex (2)") unter Einhaltung der 64-Zeichen-Grenze
export function disambiguateDisplayName(
  desiredName: string,
  existingParticipants: ReadonlyArray<{ peerId: string; displayName: string }>,
  excludePeerId?: string,
): string {
  const normalizedBase = desiredName.trim().slice(0, MAX_COLLAB_DISPLAY_NAME_LENGTH);
  if (normalizedBase.length === 0) {
    return "";
  }

  const usedNames = new Set<string>();
  for (const participant of existingParticipants) {
    if (excludePeerId && participant.peerId === excludePeerId) {
      continue;
    }
    const lower = participant.displayName.trim().toLowerCase();
    if (lower.length > 0) {
      usedNames.add(lower);
    }
  }

  if (!usedNames.has(normalizedBase.toLowerCase())) {
    return normalizedBase;
  }

  let suffixNumber = 2;
  while (suffixNumber < 10000) {
    const suffix = ` (${suffixNumber})`;
    const maxBaseLength = Math.max(1, MAX_COLLAB_DISPLAY_NAME_LENGTH - suffix.length);
    const truncatedBase = normalizedBase.slice(0, maxBaseLength).trimEnd();
    const candidate = `${truncatedBase || normalizedBase.slice(0, maxBaseLength)}${suffix}`;
    if (!usedNames.has(candidate.toLowerCase())) {
      return candidate;
    }
    suffixNumber += 1;
  }

  return `${normalizedBase.slice(0, MAX_COLLAB_DISPLAY_NAME_LENGTH - 6)} (999+)`;
}

// Sortiert Teilnehmer primär nach Rolle (Host -> Kollaborateur -> Gast) und sekundär alphabetisch nach Anzeigename
export function sortCollabParticipants(participants: ReadonlyArray<CollabParticipant>): CollabParticipant[] {
  return [...participants].sort((a, b) => {
    const roleDiff = ROLE_SORT_PRIORITY[a.role] - ROLE_SORT_PRIORITY[b.role];
    if (roleDiff !== 0) {
      return roleDiff;
    }
    const nameDiff = a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
    if (nameDiff !== 0) {
      return nameDiff;
    }
    return a.peerId.localeCompare(b.peerId);
  });
}

function findParticipant(
  senderPeerId: string,
  participants: ReadonlyMap<string, CollabParticipant> | ReadonlyArray<CollabParticipant>,
): CollabParticipant | undefined {
  if (participants instanceof Map) {
    return (participants as ReadonlyMap<string, CollabParticipant>).get(senderPeerId);
  }
  if (Array.isArray(participants)) {
    return (participants as ReadonlyArray<CollabParticipant>).find((p) => p.peerId === senderPeerId);
  }
  return (participants as ReadonlyMap<string, CollabParticipant>).get(senderPeerId);
}

function reject(action: string, code: CollabActionRejectionCode, message: string): CollabAuthorizationResult {
  return {
    allowed: false,
    code,
    message,
    action,
  };
}

// Hostseitiger Gatekeeper: validiert jede eingehende P2P-Nachricht strikt gegen die aktuelle Rolle und Namenssperre des Absenders
export function authorizeCollabAction(
  senderPeerId: string,
  message: CollabDataChannelMessage,
  participants: ReadonlyMap<string, CollabParticipant> | ReadonlyArray<CollabParticipant>,
): CollabAuthorizationResult {
  const sender = findParticipant(senderPeerId, participants);
  const actionLabel = message.kind === "control"
    ? `control:${message.action}`
    : message.kind === "app"
      ? `app:${message.topic}`
      : message.kind;

  if (!sender) {
    return reject(actionLabel, "unknown-peer", "Absender ist kein registrierter Teilnehmer der Session.");
  }

  if (message.kind === "heartbeat-ping" || message.kind === "heartbeat-pong" || message.kind === "resync-request") {
    return { allowed: true };
  }

  if (message.kind === "resync-required") {
    return sender.role === "host"
      ? { allowed: true }
      : reject(actionLabel, "host-only", "Nur der Host darf einen Resync erzwingen.");
  }

  if (message.kind === "control") {
    if (HOST_ONLY_CONTROL_ACTIONS.has(message.action)) {
      return sender.role === "host"
        ? { allowed: true }
        : reject(actionLabel, "host-only", `Die Kontrollaktion "${message.action}" ist ausschließlich dem Host vorbehalten.`);
    }

    if (message.action === COLLAB_CONTROL_ACTION_ROSTER_REQUEST) {
      return { allowed: true };
    }

    if (message.action === COLLAB_CONTROL_ACTION_RENAME_SELF) {
      if (sender.nameLocked && sender.role !== "host") {
        return reject(
          actionLabel,
          "name-locked",
          "Dein Anzeigename wurde vom Host gesperrt und kann nicht eigenmächtig geändert werden.",
        );
      }
      const payload = message.payload as Partial<CollabRenameSelfPayload> | null | undefined;
      const normalized = normalizeDisplayName(payload?.displayName);
      if (!normalized.valid) {
        return reject(actionLabel, "invalid-display-name", normalized.message);
      }
      return { allowed: true };
    }

    if (message.action === COLLAB_CONTROL_ACTION_HAND_STATE) {
      const payload = message.payload as Partial<CollabHandStatePayload> | null | undefined;
      if (!payload || typeof payload.raised !== "boolean") {
        return reject(actionLabel, "invalid-payload", "Ungültiges Payload für hand-state.");
      }
      if (payload.targetPeerId !== undefined) {
        if (typeof payload.targetPeerId !== "string" || payload.targetPeerId.trim().length === 0) {
          return reject(actionLabel, "invalid-payload", "Ungültiger targetPeerId für hand-state.");
        }
        if (payload.targetPeerId !== senderPeerId && sender.role !== "host") {
          return reject(actionLabel, "host-only", "Nur der Host darf den Hand-Zustand anderer Teilnehmer ändern.");
        }
      }
      return { allowed: true };
    }

    return sender.role === "host"
      ? reject(actionLabel, "invalid-payload", `Unbekannte Kontrollaktion "${message.action}".`)
      : reject(actionLabel, "unauthorized-role", `Unzulässige Kontrollaktion "${message.action}".`);
  }

  if (message.kind === "app") {
    const topic = message.topic.trim();

    if (HOST_ONLY_APP_TOPICS.has(topic)) {
      if (sender.role !== "host") {
        return reject(actionLabel, "host-only", `Das Topic "${topic}" darf ausschließlich vom Host gesendet werden.`);
      }
      if (topic === COLLAB_APP_TOPIC_PRESENCE_SNAPSHOT && !isValidPresenceSnapshotPayload(message.payload)) {
        return reject(actionLabel, "invalid-payload", "Ungültiges Payload für presence-snapshot.");
      }
      return { allowed: true };
    }

    if (topic === COLLAB_APP_TOPIC_PRESENCE_CURSOR) {
      return isValidPresenceCursorPayload(message.payload)
        ? { allowed: true }
        : reject(actionLabel, "invalid-payload", "Ungültiges Payload für presence-cursor.");
    }

    if (topic === COLLAB_APP_TOPIC_PRESENCE_STATE) {
      return isValidPresenceStatePayload(message.payload)
        ? { allowed: true }
        : reject(actionLabel, "invalid-payload", "Ungültiges Payload für presence-state.");
    }

    if (topic === COLLAB_APP_TOPIC_HOST_HANDOVER_READY) {
      const payload = message.payload as Partial<CollabHostHandoverReadyPayload> | null | undefined;
      if (
        !isPlainRecord(payload) ||
        typeof payload.targetPeerId !== "string" ||
        payload.targetPeerId.trim().length === 0 ||
        typeof payload.acceptedRevision !== "number" ||
        !Number.isInteger(payload.acceptedRevision) ||
        payload.acceptedRevision < 0 ||
        typeof payload.ok !== "boolean"
      ) {
        return reject(actionLabel, "invalid-payload", "Ungültiges Payload für host-handover-ready.");
      }
      return { allowed: true };
    }

    // Standardmäßig sind Schaltungs-Mutationen und andere App-Nachrichten Gästen untersagt (Default-Deny)
    if (sender.role === "guest") {
      return reject(
        actionLabel,
        "unauthorized-role",
        "Gäste besitzen nur Leserechte und dürfen keine Schaltungsänderungen oder Eingaben senden.",
      );
    }

    if (topic === COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REQUEST) {
      const payload = message.payload as Partial<CollabMutationRequestPayload> | null | undefined;
      if (
        !isPlainRecord(payload) ||
        typeof payload.mutationId !== "string" ||
        payload.mutationId.trim().length === 0 ||
        typeof payload.baseRevision !== "number" ||
        !Number.isInteger(payload.baseRevision) ||
        payload.baseRevision < 0 ||
        !isPlainRecord(payload.mutation) ||
        typeof payload.mutation.type !== "string"
      ) {
        return reject(actionLabel, "invalid-payload", "Ungültiges Payload für circuit-mutation-request.");
      }
      return { allowed: true };
    }

    if (topic === COLLAB_APP_TOPIC_SOFT_LOCK) {
      const payload = message.payload as Partial<CollabSoftLockPayload> | null | undefined;
      if (
        !isPlainRecord(payload) ||
        typeof payload.action !== "string" ||
        !VALID_SOFT_LOCK_ACTIONS.has(payload.action) ||
        !Array.isArray(payload.locks)
      ) {
        return reject(actionLabel, "invalid-payload", "Ungültiges Payload für soft-lock.");
      }
      return { allowed: true };
    }

    return { allowed: true };
  }

  return reject(actionLabel, "invalid-payload", "Unbekannter Nachrichtentyp.");
}
