import type CollabRole from "../types/collab/collabRole";
import type { CollabInviteRole } from "../types/collab/collabRole";
import type CollabDataChannelMessage from "../types/collab/dataChannelMessage";
import type { CollabResyncReason } from "../types/collab/dataChannelMessage";
import type { CollabRuntimeConfig } from "../types/collab/iceConfig";
import type CollabParticipant from "../types/collab/sessionState";
import {
  COLLAB_CONTROL_ACTION_ACTION_REJECTED,
  COLLAB_CONTROL_ACTION_HAND_STATE,
  COLLAB_CONTROL_ACTION_MODERATE_NAME,
  COLLAB_CONTROL_ACTION_RENAME_SELF,
  COLLAB_CONTROL_ACTION_ROLE_UPDATE,
  COLLAB_CONTROL_ACTION_ROSTER_REQUEST,
  COLLAB_CONTROL_ACTION_ROSTER_SNAPSHOT,
  type CollabActionRejectedPayload,
  type CollabActiveInvite,
  type CollabHandStatePayload,
  type CollabRenameSelfPayload,
  type CollabRosterSnapshotPayload,
  type CollabSessionClosedEvent,
  type ParsedCollabInviteLink,
} from "../types/collab/sessionState";
import type CollabTransportState from "../types/collab/transportState";

import {
  type CollabConnectionDiagnostic,
  type CollabRuntimeConfigPreflightResult,
  type CollabSessionError,
  fetchRuntimeCollabConfigDetailed,
  isCollabDisabledByEnv,
  mapSignalingErrorToCollabError,
} from "../utils/collabIceConfig";
import { buildCollabInviteLink, parseCollabInviteLink } from "../utils/collabInviteLink";
import { loadCollabAccessKey, loadCollabDisplayName, saveCollabDisplayName } from "../utils/collabStorage";
import { isCustomSidecarRequired, loadSidecarBaseUrl } from "../utils/sidecarStorage";

import {
  authorizeCollabAction,
  disambiguateDisplayName,
  normalizeDisplayName,
  sortCollabParticipants,
} from "./collabAuthorization";
import { DEFAULT_COLLAB_GRACE_PERIOD_MS } from "./collabEvents";
import P2pSessionTransport, {
  type CollabTransportSnapshot,
  type P2pSessionTransportOptions,
  type ResyncHooks,
} from "./p2pSessionTransport";

export type StartHostSessionInput = {
  displayName: string;
  accessKey?: string;
  sidecarBaseUrl?: string;
};

export type JoinCollabSessionInput = {
  inviteToken: string;
  displayName: string;
  sidecarBaseUrl?: string;
  isEphemeralSidecar?: boolean;
};

export type ModerateParticipantNameInput = {
  displayName?: string;
  nameLocked?: boolean;
};

export type CollabSessionControllerState = {
  isDisabled: boolean;
  customSidecarRequired: boolean;
  isInSession: boolean;
  transportState: CollabTransportState;
  diagnostic: CollabConnectionDiagnostic;
  gracePeriodMs: number;
  sessionId: string | null;
  selfPeerId: string | null;
  selfRole: CollabRole | null;
  hostPeerId: string | null;
  isHost: boolean;
  isMcpBlockedByCollab: boolean;
  activeSidecarUrl: string | null;
  isEphemeralSidecar: boolean;
  runtimeConfig: CollabRuntimeConfig | null;
  displayName: string;
  participants: CollabParticipant[];
  selfParticipant: CollabParticipant | null;
  raisedHandCount: number;
  activeInvites: CollabActiveInvite[];
  pendingInviteLink: ParsedCollabInviteLink | null;
  lastError: CollabSessionError | null;
  lastRejectionMessage: string | null;
  sessionClosedNotice: CollabSessionClosedEvent | null;
  isParticipantsPanelOpen: boolean;
};

export type CollabSessionControllerOptions = {
  disabledOverride?: boolean;
  customOnlyOverride?: boolean;
  transportFactory?: (options: P2pSessionTransportOptions) => P2pSessionTransport;
  preflightFetcher?: (options: {
    disabledOverride?: boolean;
    baseUrl?: string;
    customOnlyOverride?: boolean;
  }) => Promise<CollabRuntimeConfigPreflightResult>;
  getCustomStunUrls?: () => string[] | undefined;
  getPageUrl?: () => string;
  now?: () => number;
};

const IDLE_DIAGNOSTIC: CollabConnectionDiagnostic = {
  code: "none",
  isRecoverable: true,
  turnPlannedHint: false,
  details: "",
};

// Verwaltet Session-Lebenszyklus, Roster-Hoheit, Einladungslinks, Namensmoderation, Hand-Heben und Host-Handover
class CollabSessionController {
  readonly #isDisabled: boolean;
  readonly #customOnlyOverride: boolean | undefined;
  readonly #transportFactory: (options: P2pSessionTransportOptions) => P2pSessionTransport;
  readonly #preflightFetcher: (options: {
    disabledOverride?: boolean;
    baseUrl?: string;
    customOnlyOverride?: boolean;
  }) => Promise<CollabRuntimeConfigPreflightResult>;
  readonly #getCustomStunUrls: (() => string[] | undefined) | undefined;
  readonly #getPageUrl: (() => string) | undefined;
  readonly #now: () => number;
  readonly #listeners = new Set<(state: CollabSessionControllerState) => void>();
  readonly #transportSnapshotListeners = new Set<(snapshot: CollabTransportSnapshot | null) => void>();
  readonly #transportMessageListeners = new Set<(fromPeerId: string, message: CollabDataChannelMessage) => void>();

  readonly #roster = new Map<string, CollabParticipant>();
  readonly #connectedPeersSentRoster = new Set<string>();
  #activeInvites: CollabActiveInvite[] = [];
  #rosterRevision = 0;

  #transport: P2pSessionTransport | null = null;
  #unsubscribes: Array<() => void> = [];
  #isSyncingSnapshot = false;
  #resyncHooks: ResyncHooks | null = null;
  #beforeTransferHostHook: ((targetPeerId: string) => Promise<void>) | null = null;
  #isTransferringHost = false;

  #transportSnapshot: CollabTransportSnapshot | null = null;
  #activeSidecarUrl: string | null = null;
  #isEphemeralSidecar = false;
  #runtimeConfig: CollabRuntimeConfig | null = null;
  #displayName = loadCollabDisplayName();
  #pendingInviteLink: ParsedCollabInviteLink | null = null;
  #lastError: CollabSessionError | null = null;
  #lastRejectionMessage: string | null = null;
  #sessionClosedNotice: CollabSessionClosedEvent | null = null;
  #isParticipantsPanelOpen = false;
  #lastKnownRole: CollabRole | null = null;
  #requestedRosterForHostId: string | null = null;
  #receivedRosterForHostId: string | null = null;

  constructor(options: CollabSessionControllerOptions = {}) {
    this.#isDisabled = options.disabledOverride !== undefined
      ? options.disabledOverride
      : isCollabDisabledByEnv();
    this.#customOnlyOverride = options.customOnlyOverride;
    this.#transportFactory = options.transportFactory ?? ((opts) => new P2pSessionTransport(opts));
    this.#preflightFetcher = options.preflightFetcher
      ?? ((opts) => fetchRuntimeCollabConfigDetailed(undefined, opts));
    this.#getCustomStunUrls = options.getCustomStunUrls;
    this.#getPageUrl = options.getPageUrl;
    this.#now = options.now ?? (() => Date.now());
  }

  getState(): CollabSessionControllerState {
    const customSidecarRequired = this.#customOnlyOverride ?? isCustomSidecarRequired();
    const snap = this.#transportSnapshot;
    const isInSession = Boolean(
      !this.#isDisabled &&
      snap &&
      snap.sessionId &&
      snap.state !== "idle" &&
      snap.state !== "disconnected",
    );
    const selfRole = isInSession && snap ? snap.selfRole : null;
    const selfPeerId = isInSession && snap ? snap.selfPeerId : null;
    const participants = isInSession
      ? sortCollabParticipants(Array.from(this.#roster.values()))
      : [];
    const selfParticipant = isInSession && selfPeerId
      ? (this.#roster.get(selfPeerId) ?? null)
      : null;
    const raisedHandCount = participants.reduce((acc, entry) => acc + (entry.handRaised ? 1 : 0), 0);

    return {
      isDisabled: this.#isDisabled,
      customSidecarRequired,
      isInSession,
      transportState: isInSession && snap ? snap.state : "idle",
      diagnostic: isInSession && snap ? snap.diagnostic : IDLE_DIAGNOSTIC,
      gracePeriodMs: snap ? snap.gracePeriodMs : DEFAULT_COLLAB_GRACE_PERIOD_MS,
      sessionId: isInSession && snap ? snap.sessionId : null,
      selfPeerId,
      selfRole,
      hostPeerId: isInSession && snap ? snap.hostPeerId : null,
      isHost: isInSession && selfRole === "host",
      isMcpBlockedByCollab: Boolean(isInSession && selfRole !== "host"),
      activeSidecarUrl: this.#activeSidecarUrl,
      isEphemeralSidecar: this.#isEphemeralSidecar,
      runtimeConfig: this.#runtimeConfig,
      displayName: this.#displayName,
      participants,
      selfParticipant,
      raisedHandCount,
      activeInvites: [...this.#activeInvites],
      pendingInviteLink: this.#pendingInviteLink,
      lastError: this.#lastError,
      lastRejectionMessage: this.#lastRejectionMessage,
      sessionClosedNotice: this.#sessionClosedNotice,
      isParticipantsPanelOpen: this.#isParticipantsPanelOpen,
    };
  }

  subscribe(listener: (state: CollabSessionControllerState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  onTransportSnapshot(listener: (snapshot: CollabTransportSnapshot | null) => void): () => void {
    this.#transportSnapshotListeners.add(listener);
    return () => {
      this.#transportSnapshotListeners.delete(listener);
    };
  }

  onTransportMessage(listener: (fromPeerId: string, message: CollabDataChannelMessage) => void): () => void {
    this.#transportMessageListeners.add(listener);
    return () => {
      this.#transportMessageListeners.delete(listener);
    };
  }

  setResyncHooks(hooks: ResyncHooks | null): void {
    this.#resyncHooks = hooks;
  }

  setBeforeTransferHostHook(hook: ((targetPeerId: string) => Promise<void>) | null): void {
    this.#beforeTransferHostHook = hook;
  }

  async sendToPeer(peerId: string, message: CollabDataChannelMessage): Promise<void> {
    if (!this.#transport) {
      throw new Error("Kein aktiver Kollaborationstransport vorhanden.");
    }
    await this.#transport.sendToPeer(peerId, message);
  }

  async sendToHost(message: CollabDataChannelMessage): Promise<void> {
    if (!this.#transport) {
      throw new Error("Kein aktiver Kollaborationstransport vorhanden.");
    }
    await this.#transport.sendToHost(message);
  }

  async broadcast(message: CollabDataChannelMessage, excludePeerId?: string): Promise<void> {
    if (!this.#transport) {
      return;
    }
    await this.#transport.broadcast(message, excludePeerId);
  }

  setParticipantsPanelOpen(open: boolean): void {
    if (this.#isParticipantsPanelOpen === open) {
      return;
    }
    this.#isParticipantsPanelOpen = open;
    this.#emit();
  }

  clearError(): void {
    if (!this.#lastError && !this.#lastRejectionMessage) {
      return;
    }
    this.#lastError = null;
    this.#lastRejectionMessage = null;
    this.#emit();
  }

  dismissSessionClosedNotice(): void {
    if (!this.#sessionClosedNotice) {
      return;
    }
    this.#sessionClosedNotice = null;
    this.#emit();
  }

  // Liest einen URL-Hash (z. B. beim Laden oder hashchange) auf einen gültigen Einladungslink aus
  ingestHash(
    hash: string,
    pageLocation?: { protocol: string; host?: string; origin?: string },
  ): ParsedCollabInviteLink | null {
    if (this.#isDisabled) {
      return null;
    }
    const parsed = parseCollabInviteLink(hash, pageLocation);
    if (!parsed) {
      return null;
    }
    this.#pendingInviteLink = parsed;
    this.#emit();
    return parsed;
  }

  clearPendingInviteLink(): void {
    if (!this.#pendingInviteLink) {
      return;
    }
    this.#pendingInviteLink = null;
    this.#emit();
  }

  // Startet eine neue Host-Session nach Pflicht-Anzeigenamen-Validierung und Server-Pre-Flight
  async startHostSession(input: StartHostSessionInput): Promise<boolean> {
    if (this.#isDisabled) {
      this.#lastError = {
        code: "disabled",
        message: "WebRTC-Kollaboration ist in diesem Build deaktiviert.",
      };
      this.#emit();
      return false;
    }

    const nameResult = normalizeDisplayName(input.displayName);
    if (!nameResult.valid) {
      this.#lastError = {
        code: "invalid-display-name",
        message: nameResult.message,
      };
      this.#emit();
      return false;
    }

    this.#lastError = null;
    this.#lastRejectionMessage = null;
    this.#sessionClosedNotice = null;

    const explicitSidecar = input.sidecarBaseUrl?.trim() || undefined;
    const preflight = await this.#preflightFetcher({
      disabledOverride: this.#isDisabled,
      baseUrl: explicitSidecar,
      customOnlyOverride: this.#customOnlyOverride,
    });
    if (!preflight.ok) {
      this.#lastError = preflight.error;
      this.#emit();
      return false;
    }

    const effectiveAccessKey = (input.accessKey ?? loadCollabAccessKey()).trim();
    if (preflight.authRequired && effectiveAccessKey.length === 0) {
      this.#lastError = {
        code: "unauthorized",
        message: "Dieser Server erfordert einen Zugangsschlüssel (COLLAB_ACCESS_KEY) unter Hilfe → BYO SideCar...",
        httpStatus: 401,
        requiresAccessKey: true,
      };
      this.#emit();
      return false;
    }

    this.#cleanupTransport("restart");

    const storedSidecar = loadSidecarBaseUrl();
    const transportSidecar = explicitSidecar ?? (storedSidecar.length > 0 ? preflight.effectiveBaseUrl : undefined);
    const transport = this.#createAttachedTransport({
      sidecarBaseUrl: transportSidecar,
      customStunUrls: this.#getCustomStunUrls?.(),
      runtimeConfig: preflight.config,
      disabledOverride: this.#isDisabled,
    });

    try {
      const snap = await transport.startHostSession({
        accessKey: effectiveAccessKey.length > 0 ? effectiveAccessKey : undefined,
        displayName: nameResult.displayName,
      });

      this.#displayName = nameResult.displayName;
      saveCollabDisplayName(nameResult.displayName);
      this.#runtimeConfig = preflight.config;
      this.#activeSidecarUrl = preflight.effectiveBaseUrl;
      this.#isEphemeralSidecar = Boolean(explicitSidecar && explicitSidecar !== storedSidecar);
      this.#lastKnownRole = "host";
      this.#rosterRevision = 1;
      this.#roster.clear();
      this.#connectedPeersSentRoster.clear();

      if (snap.selfPeerId) {
        this.#roster.set(snap.selfPeerId, {
          peerId: snap.selfPeerId,
          role: "host",
          displayName: nameResult.displayName,
          nameLocked: false,
          handRaised: false,
          connectionState: "connected",
          isSelf: true,
        });
      }

      this.#transportSnapshot = snap;
      this.#isParticipantsPanelOpen = true;
      this.#emit();
      return true;
    } catch (error) {
      this.#cleanupTransport("start-failed");
      this.#lastError = mapSignalingErrorToCollabError(error);
      this.#emit();
      return false;
    }
  }

  // Tritt einer Session per Einladungslink bei (mit rein flüchtiger Sidecar-URL und ohne COLLAB_ACCESS_KEY)
  async joinSession(input: JoinCollabSessionInput): Promise<boolean> {
    if (this.#isDisabled) {
      this.#lastError = {
        code: "disabled",
        message: "WebRTC-Kollaboration ist in diesem Build deaktiviert.",
      };
      this.#emit();
      return false;
    }

    const nameResult = normalizeDisplayName(input.displayName);
    if (!nameResult.valid) {
      this.#lastError = {
        code: "invalid-display-name",
        message: nameResult.message,
      };
      this.#emit();
      return false;
    }

    const inviteToken = input.inviteToken.trim();
    if (inviteToken.length === 0) {
      this.#lastError = {
        code: "invite-invalid",
        message: "Fehlender oder ungültiger Einladungslink.",
      };
      this.#emit();
      return false;
    }

    this.#lastError = null;
    this.#lastRejectionMessage = null;
    this.#sessionClosedNotice = null;

    const ephemeralSidecar = input.sidecarBaseUrl?.trim() || undefined;
    const preflight = await this.#preflightFetcher({
      disabledOverride: this.#isDisabled,
      baseUrl: ephemeralSidecar,
      customOnlyOverride: this.#customOnlyOverride,
    });
    if (!preflight.ok) {
      this.#lastError = preflight.error;
      this.#emit();
      return false;
    }

    this.#cleanupTransport("rejoin");

    const storedSidecar = loadSidecarBaseUrl();
    const transportSidecar = ephemeralSidecar ?? (storedSidecar.length > 0 ? preflight.effectiveBaseUrl : undefined);
    const transport = this.#createAttachedTransport({
      sidecarBaseUrl: transportSidecar,
      customStunUrls: this.#getCustomStunUrls?.(),
      runtimeConfig: preflight.config,
      disabledOverride: this.#isDisabled,
    });

    try {
      const snap = await transport.joinSession({
        inviteToken,
        displayName: nameResult.displayName,
      });

      this.#displayName = nameResult.displayName;
      saveCollabDisplayName(nameResult.displayName);
      this.#runtimeConfig = preflight.config;
      this.#activeSidecarUrl = preflight.effectiveBaseUrl;
      this.#isEphemeralSidecar = input.isEphemeralSidecar ?? Boolean(ephemeralSidecar);
      this.#lastKnownRole = snap.selfRole;
      this.#pendingInviteLink = null;
      this.#roster.clear();
      this.#connectedPeersSentRoster.clear();

      if (snap.selfPeerId && snap.selfRole) {
        this.#roster.set(snap.selfPeerId, {
          peerId: snap.selfPeerId,
          role: snap.selfRole,
          displayName: nameResult.displayName,
          nameLocked: false,
          handRaised: false,
          connectionState: snap.state === "connected" ? "connected" : "connecting",
          isSelf: true,
        });
      }
      if (snap.hostPeerId) {
        this.#roster.set(snap.hostPeerId, {
          peerId: snap.hostPeerId,
          role: "host",
          displayName: "Host",
          nameLocked: false,
          handRaised: false,
          connectionState: snap.state === "connected" ? "connected" : "connecting",
        });
      }

      this.#transportSnapshot = snap;
      this.#isParticipantsPanelOpen = true;
      this.#emit();
      return true;
    } catch (error) {
      this.#cleanupTransport("join-failed");
      this.#lastError = mapSignalingErrorToCollabError(error);
      this.#emit();
      return false;
    }
  }

  // Erstellt einen 5-Minuten-Einladungslink (nur durch den aktiven Host)
  async createInviteLink(role: CollabInviteRole, ttlMs?: number): Promise<CollabActiveInvite | null> {
    if (this.#isDisabled || !this.#transport || this.#transportSnapshot?.selfRole !== "host") {
      return null;
    }

    try {
      const issued = await this.#transport.createInvite(role, ttlMs);
      const built = buildCollabInviteLink({
        inviteToken: issued.inviteToken,
        pageUrl: this.#getPageUrl?.(),
        sidecarBaseUrl: this.#activeSidecarUrl,
      });

      const entry: CollabActiveInvite = {
        inviteToken: issued.inviteToken,
        role: issued.role,
        url: built.url,
        createdAt: issued.createdAt,
        expiresAt: issued.expiresAt,
        ...(built.sidecarUrl ? { sidecarUrl: built.sidecarUrl } : {}),
        isLocalhostSidecar: built.isLocalhostSidecar,
      };
      this.pruneExpiredInvites();
      this.#activeInvites = [entry, ...this.#activeInvites];
      this.#emit();
      return entry;
    } catch (error) {
      this.#lastError = mapSignalingErrorToCollabError(error);
      this.#emit();
      return null;
    }
  }

  async revokeInviteLink(inviteToken: string): Promise<boolean> {
    if (this.#isDisabled || !this.#transport || this.#transportSnapshot?.selfRole !== "host") {
      return false;
    }

    try {
      await this.#transport.revokeInvite(inviteToken);
      this.#activeInvites = this.#activeInvites.filter((inv) => inv.inviteToken !== inviteToken);
      this.#emit();
      return true;
    } catch (error) {
      this.#lastError = mapSignalingErrorToCollabError(error);
      this.#emit();
      return false;
    }
  }

  pruneExpiredInvites(): void {
    const now = this.#now();
    const filtered = this.#activeInvites.filter((inv) => inv.expiresAt > now);
    if (filtered.length !== this.#activeInvites.length) {
      this.#activeInvites = filtered;
      this.#emit();
    }
  }

  // Schaltet die Rolle eines Teilnehmers auf Host-Seite zwischen Gast und Kollaborateur um
  async setParticipantRole(targetPeerId: string, role: CollabInviteRole): Promise<boolean> {
    if (!this.#transport || this.#transportSnapshot?.selfRole !== "host") {
      return false;
    }
    if (targetPeerId === this.#transportSnapshot.selfPeerId) {
      return false;
    }
    const participant = this.#roster.get(targetPeerId);
    if (!participant) {
      return false;
    }

    participant.role = role;
    this.#transport.updatePeerMetadata(targetPeerId, { role });
    await this.#broadcastRosterSnapshot();
    this.#emit();
    return true;
  }

  // Moderiert Anzeigenamen (mit Disambiguierung) und optionalen Sperrstatus (nameLocked) durch den Host
  async moderateParticipantName(targetPeerId: string, update: ModerateParticipantNameInput): Promise<boolean> {
    if (!this.#transport || this.#transportSnapshot?.selfRole !== "host") {
      return false;
    }
    const participant = this.#roster.get(targetPeerId);
    if (!participant) {
      return false;
    }

    let nextDisplayName = participant.displayName;
    if (update.displayName !== undefined) {
      const normalized = normalizeDisplayName(update.displayName);
      if (!normalized.valid) {
        this.#lastRejectionMessage = normalized.message;
        this.#emit();
        return false;
      }
      nextDisplayName = disambiguateDisplayName(
        normalized.displayName,
        Array.from(this.#roster.values()),
        targetPeerId,
      );
      participant.displayName = nextDisplayName;
      if (targetPeerId === this.#transportSnapshot.selfPeerId) {
        this.#displayName = nextDisplayName;
      } else {
        this.#transport.updatePeerMetadata(targetPeerId, { displayName: nextDisplayName });
      }
    }

    if (update.nameLocked !== undefined && targetPeerId !== this.#transportSnapshot.selfPeerId) {
      participant.nameLocked = update.nameLocked;
    }

    await this.#broadcastRosterSnapshot();
    this.#emit();
    return true;
  }

  // Eigenen Anzeigenamen ändern (Host direkt autoritativ, Nicht-Host sofern nicht gesperrt)
  async renameSelf(newName: string): Promise<boolean> {
    const snap = this.#transportSnapshot;
    if (!this.#transport || !snap?.sessionId || !snap.selfPeerId) {
      return false;
    }

    const normalized = normalizeDisplayName(newName);
    if (!normalized.valid) {
      this.#lastRejectionMessage = normalized.message;
      this.#emit();
      return false;
    }

    const selfEntry = this.#roster.get(snap.selfPeerId);
    if (snap.selfRole === "host") {
      const resolved = disambiguateDisplayName(
        normalized.displayName,
        Array.from(this.#roster.values()),
        snap.selfPeerId,
      );
      if (selfEntry) {
        selfEntry.displayName = resolved;
      }
      this.#displayName = resolved;
      saveCollabDisplayName(resolved);
      this.#lastRejectionMessage = null;
      await this.#broadcastRosterSnapshot();
      this.#emit();
      return true;
    }

    if (selfEntry?.nameLocked) {
      this.#lastRejectionMessage = "Dein Anzeigename wurde vom Host gesperrt und kann nicht eigenmächtig geändert werden.";
      this.#emit();
      return false;
    }

    this.#lastRejectionMessage = null;
    try {
      await this.#transport.sendToHost({
        kind: "control",
        action: COLLAB_CONTROL_ACTION_RENAME_SELF,
        payload: { displayName: normalized.displayName },
      });
      this.#displayName = normalized.displayName;
      saveCollabDisplayName(normalized.displayName);
      if (selfEntry) {
        selfEntry.displayName = normalized.displayName;
      }
      this.#emit();
      return true;
    } catch (error) {
      this.#lastError = mapSignalingErrorToCollabError(error);
      this.#emit();
      return false;
    }
  }

  // „Hand heben“ / „Hand senken“ für sich selbst umschalten
  async toggleHandRaised(raised?: boolean): Promise<boolean> {
    const snap = this.#transportSnapshot;
    if (!this.#transport || !snap?.sessionId || !snap.selfPeerId) {
      return false;
    }
    const selfEntry = this.#roster.get(snap.selfPeerId);
    const nextRaised = raised !== undefined ? raised : !(selfEntry?.handRaised ?? false);

    if (snap.selfRole === "host") {
      if (selfEntry) {
        selfEntry.handRaised = nextRaised;
      }
      await this.#broadcastRosterSnapshot();
      this.#emit();
      return true;
    }

    if (selfEntry) {
      selfEntry.handRaised = nextRaised;
      this.#emit();
    }
    try {
      await this.#transport.sendToHost({
        kind: "control",
        action: COLLAB_CONTROL_ACTION_HAND_STATE,
        payload: { raised: nextRaised },
      });
      return true;
    } catch (error) {
      this.#lastError = mapSignalingErrorToCollabError(error);
      this.#emit();
      return false;
    }
  }

  async lowerParticipantHand(targetPeerId: string): Promise<boolean> {
    const snap = this.#transportSnapshot;
    if (!this.#transport || snap?.selfRole !== "host") {
      return false;
    }
    const participant = this.#roster.get(targetPeerId);
    if (!participant || !participant.handRaised) {
      return false;
    }
    participant.handRaised = false;
    await this.#broadcastRosterSnapshot();
    this.#emit();
    return true;
  }

  async kickParticipant(targetPeerId: string, reason = "kicked"): Promise<boolean> {
    if (!this.#transport || this.#transportSnapshot?.selfRole !== "host") {
      return false;
    }
    if (targetPeerId === this.#transportSnapshot.selfPeerId) {
      return false;
    }
    try {
      this.#transport.kickPeer(targetPeerId, reason);
      this.#roster.delete(targetPeerId);
      this.#connectedPeersSentRoster.delete(targetPeerId);
      await this.#broadcastRosterSnapshot();
      this.#emit();
      return true;
    } catch (error) {
      this.#lastError = mapSignalingErrorToCollabError(error);
      this.#emit();
      return false;
    }
  }

  // Überträgt das Host-Recht an jeden verbundenen Teilnehmer (sowohl Kollaborateur als auch Gast)
  transferHostRole(targetPeerId: string): boolean {
    if (!this.#transport || this.#transportSnapshot?.selfRole !== "host") {
      return false;
    }
    if (!this.#roster.has(targetPeerId) || targetPeerId === this.#transportSnapshot.selfPeerId) {
      return false;
    }
    if (!this.#beforeTransferHostHook) {
      try {
        this.#transport.transferHost(targetPeerId);
        return true;
      } catch (error) {
        this.#lastError = mapSignalingErrorToCollabError(error);
        this.#emit();
        return false;
      }
    }

    if (this.#isTransferringHost) {
      return false;
    }
    this.#isTransferringHost = true;
    const hook = this.#beforeTransferHostHook;
    void (async () => {
      try {
        await hook(targetPeerId);
        this.#transport?.transferHost(targetPeerId);
      } catch (error) {
        this.#lastError = mapSignalingErrorToCollabError(error);
        this.#emit();
      } finally {
        this.#isTransferringHost = false;
      }
    })();
    return true;
  }

  async requestResync(reason: CollabResyncReason = "manual", fromRevision?: number): Promise<boolean> {
    if (!this.#transport || this.#transportSnapshot?.selfRole === "host") {
      return false;
    }
    try {
      const result = await this.#transport.requestResync(reason, fromRevision);
      return result.executed;
    } catch (error) {
      this.#lastError = mapSignalingErrorToCollabError(error);
      this.#emit();
      return false;
    }
  }

  endOrLeaveSession(reason?: string): void {
    const wasHost = this.#transportSnapshot?.selfRole === "host";
    const effectiveReason = reason ?? (wasHost ? "host-closed" : "left");
    this.#cleanupTransport(effectiveReason);
    this.#sessionClosedNotice = null;
    this.#emit();
  }

  dispose(): void {
    this.#cleanupTransport("disposed");
    this.#listeners.clear();
    this.#transportSnapshotListeners.clear();
    this.#transportMessageListeners.clear();
  }

  #createAttachedTransport(options: P2pSessionTransportOptions): P2pSessionTransport {
    const transport = this.#transportFactory({
      ...options,
      resyncHooks: {
        getUnconfirmedLocalChangesCount: () => this.#resyncHooks?.getUnconfirmedLocalChangesCount?.() ?? 0,
        getCurrentRevision: () => this.#resyncHooks?.getCurrentRevision?.(),
        confirmDiscardLocalChanges: (context) => {
          if (!this.#resyncHooks?.confirmDiscardLocalChanges) {
            return false;
          }
          return this.#resyncHooks.confirmDiscardLocalChanges(context);
        },
        onResyncRequested: (request) => {
          this.#resyncHooks?.onResyncRequested?.(request);
        },
        onLocalChangesDiscardedForResync: (context) => {
          this.#resyncHooks?.onLocalChangesDiscardedForResync?.(context);
        },
      },
    });
    this.#transport = transport;
    this.#unsubscribes = [
      transport.onStateChange((snapshot) => {
        this.#handleTransportSnapshot(snapshot);
      }),
      transport.onMessage((fromPeerId, message) => {
        void this.#handleTransportMessage(fromPeerId, message);
      }),
      transport.onError((error) => {
        this.#lastError = mapSignalingErrorToCollabError(error);
        this.#emit();
      }),
      transport.onSessionClosed((closedEvent) => {
        this.#handleRemoteSessionClosed(closedEvent);
      }),
    ];
    return transport;
  }

  #cleanupTransport(reason: string): void {
    for (const unsubscribe of this.#unsubscribes) {
      unsubscribe();
    }
    this.#unsubscribes = [];
    const current = this.#transport;
    this.#transport = null;
    if (current) {
      try {
        current.close(reason);
      } catch {
        // Transport konnte bereits geschlossen sein
      }
    }
    this.#transportSnapshot = null;
    this.#activeSidecarUrl = null;
    this.#isEphemeralSidecar = false;
    this.#runtimeConfig = null;
    this.#activeInvites = [];
    this.#roster.clear();
    this.#connectedPeersSentRoster.clear();
    this.#lastKnownRole = null;
    this.#requestedRosterForHostId = null;
    this.#receivedRosterForHostId = null;
    this.#isTransferringHost = false;
    this.#emitTransportSnapshot(null);
  }

  #handleRemoteSessionClosed(closedEvent: CollabSessionClosedEvent): void {
    this.#cleanupTransport(closedEvent.reason);
    this.#sessionClosedNotice = closedEvent;
    this.#isParticipantsPanelOpen = false;
    this.#emit();
  }

  #handleTransportSnapshot(snapshot: CollabTransportSnapshot): void {
    if (this.#isSyncingSnapshot) {
      this.#transportSnapshot = snapshot;
      return;
    }

    this.#isSyncingSnapshot = true;
    try {
      const previousRole = this.#lastKnownRole;
      this.#transportSnapshot = snapshot;
      this.#lastKnownRole = snapshot.selfRole;

      if (!snapshot.sessionId || snapshot.state === "disconnected" || snapshot.state === "idle") {
        this.#emitTransportSnapshot(snapshot);
        this.#emit();
        return;
      }

      if (snapshot.selfRole === "host") {
        this.#syncHostRosterFromSnapshot(snapshot, previousRole);
      } else {
        this.#syncNonHostRosterFromSnapshot(snapshot, previousRole);
      }

      this.#emitTransportSnapshot(snapshot);
      this.#emit();
    } finally {
      this.#isSyncingSnapshot = false;
    }
  }

  #syncHostRosterFromSnapshot(snapshot: CollabTransportSnapshot, previousRole: CollabRole | null): void {
    const justBecameHost = previousRole !== null && previousRole !== "host";
    if (justBecameHost) {
      this.#activeInvites = [];
      this.#connectedPeersSentRoster.clear();
    }

    let rosterChanged = justBecameHost;
    const activeIds = new Set<string>();
    const metadataUpdates: Array<{ peerId: string; role: CollabRole; displayName: string }> = [];

    if (snapshot.selfPeerId) {
      activeIds.add(snapshot.selfPeerId);
      const existingSelf = this.#roster.get(snapshot.selfPeerId);
      if (!existingSelf) {
        this.#roster.set(snapshot.selfPeerId, {
          peerId: snapshot.selfPeerId,
          role: "host",
          displayName: this.#displayName || "Host",
          nameLocked: false,
          handRaised: false,
          connectionState: "connected",
          isSelf: true,
        });
        rosterChanged = true;
      } else {
        if (existingSelf.role !== "host" || existingSelf.nameLocked || existingSelf.connectionState !== "connected") {
          existingSelf.role = "host";
          existingSelf.nameLocked = false;
          existingSelf.connectionState = "connected";
          existingSelf.isSelf = true;
          rosterChanged = true;
        }
      }
    }

    for (const peer of snapshot.peers) {
      activeIds.add(peer.peerId);
      const existing = this.#roster.get(peer.peerId);
      if (!existing) {
        const rawCandidate = (peer.displayName ?? "").trim() || "Teilnehmer";
        const resolvedName = disambiguateDisplayName(
          rawCandidate,
          Array.from(this.#roster.values()),
          peer.peerId,
        );
        this.#roster.set(peer.peerId, {
          peerId: peer.peerId,
          role: peer.role,
          displayName: resolvedName,
          nameLocked: false,
          handRaised: false,
          connectionState: peer.state,
        });
        if (peer.displayName !== resolvedName) {
          metadataUpdates.push({
            peerId: peer.peerId,
            role: peer.role,
            displayName: resolvedName,
          });
        }
        rosterChanged = true;
      } else {
        if (justBecameHost) {
          const desiredRole = peer.role;
          if (existing.role !== desiredRole) {
            existing.role = desiredRole;
            rosterChanged = true;
          }
          existing.isSelf = false;
        }
        if (existing.connectionState !== peer.state) {
          existing.connectionState = peer.state;
          rosterChanged = true;
        }
      }

      if (peer.state === "connected" && !this.#connectedPeersSentRoster.has(peer.peerId)) {
        this.#connectedPeersSentRoster.add(peer.peerId);
        rosterChanged = true;
      }
    }

    for (const existingPeerId of Array.from(this.#roster.keys())) {
      if (!activeIds.has(existingPeerId)) {
        this.#roster.delete(existingPeerId);
        this.#connectedPeersSentRoster.delete(existingPeerId);
        rosterChanged = true;
      }
    }

    for (const update of metadataUpdates) {
      this.#transport?.updatePeerMetadata(update.peerId, {
        role: update.role,
        displayName: update.displayName,
      });
    }

    if (rosterChanged && snapshot.peers.some((p) => p.state === "connected")) {
      void this.#broadcastRosterSnapshot();
    }
  }

  #syncNonHostRosterFromSnapshot(snapshot: CollabTransportSnapshot, previousRole: CollabRole | null): void {
    if (previousRole === "host") {
      this.#activeInvites = [];
    }

    if (snapshot.selfPeerId && snapshot.selfRole) {
      const selfEntry = this.#roster.get(snapshot.selfPeerId);
      if (selfEntry) {
        selfEntry.role = snapshot.selfRole;
        selfEntry.connectionState = snapshot.state === "connected" ? "connected" : "connecting";
        selfEntry.isSelf = true;
      }
    }

    if (snapshot.hostPeerId) {
      for (const entry of this.#roster.values()) {
        if (entry.peerId === snapshot.hostPeerId) {
          entry.role = "host";
          entry.isSelf = false;
        } else if (entry.role === "host" && entry.peerId !== snapshot.hostPeerId) {
          entry.role = "collaborator";
        }
      }
      if (!this.#roster.has(snapshot.hostPeerId)) {
        this.#roster.set(snapshot.hostPeerId, {
          peerId: snapshot.hostPeerId,
          role: "host",
          displayName: "Host",
          nameLocked: false,
          handRaised: false,
          connectionState: snapshot.state === "connected" ? "connected" : "connecting",
        });
      }

      if (
        snapshot.state === "connected" &&
        this.#receivedRosterForHostId !== snapshot.hostPeerId &&
        this.#requestedRosterForHostId !== snapshot.hostPeerId
      ) {
        const expectedHostId = snapshot.hostPeerId;
        this.#requestedRosterForHostId = expectedHostId;
        queueMicrotask(() => {
          if (
            this.#transport &&
            this.#transportSnapshot?.hostPeerId === expectedHostId &&
            this.#transportSnapshot?.selfRole !== "host" &&
            this.#receivedRosterForHostId !== expectedHostId
          ) {
            void this.#transport.sendToHost({
              kind: "control",
              action: COLLAB_CONTROL_ACTION_ROSTER_REQUEST,
            }).catch(() => {});
          }
        });
      }
    }
  }

  async #handleTransportMessage(fromPeerId: string, message: CollabDataChannelMessage): Promise<void> {
    const snap = this.#transportSnapshot;
    if (!this.#transport || !snap?.sessionId) {
      return;
    }

    if (snap.selfRole === "host") {
      const auth = authorizeCollabAction(fromPeerId, message, this.#roster);
      if (!auth.allowed) {
        try {
          await this.#transport.sendToPeer(fromPeerId, {
            kind: "control",
            action: COLLAB_CONTROL_ACTION_ACTION_REJECTED,
            payload: {
              action: auth.action,
              code: auth.code,
              message: auth.message,
              targetPeerId: fromPeerId,
            } satisfies CollabActionRejectedPayload,
          });
        } catch {
          // Peer-Kanal konnte bereits geschlossen sein
        }
        return;
      }

      if (message.kind === "control") {
        if (message.action === COLLAB_CONTROL_ACTION_ROSTER_REQUEST) {
          await this.#sendRosterSnapshotToPeer(fromPeerId);
          return;
        }

        if (message.action === COLLAB_CONTROL_ACTION_RENAME_SELF) {
          const payload = message.payload as CollabRenameSelfPayload;
          const normalized = normalizeDisplayName(payload.displayName);
          if (!normalized.valid) {
            return;
          }
          const resolved = disambiguateDisplayName(
            normalized.displayName,
            Array.from(this.#roster.values()),
            fromPeerId,
          );
          const participant = this.#roster.get(fromPeerId);
          if (participant) {
            participant.displayName = resolved;
            this.#transport.updatePeerMetadata(fromPeerId, { displayName: resolved });
            await this.#broadcastRosterSnapshot();
            this.#emit();
          }
          return;
        }

        if (message.action === COLLAB_CONTROL_ACTION_HAND_STATE) {
          const payload = message.payload as CollabHandStatePayload;
          const targetId = payload.targetPeerId ?? fromPeerId;
          const participant = this.#roster.get(targetId);
          if (participant) {
            participant.handRaised = payload.raised;
            await this.#broadcastRosterSnapshot();
            this.#emit();
          }
        }
        return;
      }

      this.#emitTransportMessage(fromPeerId, message);
      return;
    }

    if (message.kind === "control") {
      if (message.action === COLLAB_CONTROL_ACTION_ROSTER_SNAPSHOT) {
        const payload = message.payload as Partial<CollabRosterSnapshotPayload> | undefined;
        if (!payload || !Array.isArray(payload.participants)) {
          return;
        }
        this.#receivedRosterForHostId = snap.hostPeerId;
        this.#roster.clear();
        for (const entry of payload.participants) {
          const isSelf = entry.peerId === snap.selfPeerId;
          this.#roster.set(entry.peerId, {
            ...entry,
            isSelf,
          });
          if (isSelf) {
            this.#displayName = entry.displayName;
          }
        }
        const selfEntry = snap.selfPeerId ? this.#roster.get(snap.selfPeerId) : undefined;
        if (selfEntry && snap.selfRole !== selfEntry.role) {
          this.#transportSnapshot = {
            ...snap,
            selfRole: selfEntry.role,
          };
          this.#lastKnownRole = selfEntry.role;
          this.#emitTransportSnapshot(this.#transportSnapshot);
        }
        this.#emit();
        return;
      }

      if (message.action === COLLAB_CONTROL_ACTION_ACTION_REJECTED) {
        const payload = message.payload as Partial<CollabActionRejectedPayload> | undefined;
        if (typeof payload?.message === "string" && payload.message.length > 0) {
          this.#lastRejectionMessage = payload.message;
          this.#emit();
        }
      }
      return;
    }

    this.#emitTransportMessage(fromPeerId, message);
  }

  #buildRosterSnapshotMessage(): CollabDataChannelMessage {
    this.#rosterRevision += 1;
    const participants = sortCollabParticipants(
      Array.from(this.#roster.values()).map(({ isSelf: _ignored, ...rest }) => rest),
    );
    return {
      kind: "control",
      action: COLLAB_CONTROL_ACTION_ROSTER_SNAPSHOT,
      payload: {
        participants,
        revision: this.#rosterRevision,
      } satisfies CollabRosterSnapshotPayload,
    };
  }

  async #sendRosterSnapshotToPeer(peerId: string): Promise<void> {
    if (!this.#transport || this.#transportSnapshot?.selfRole !== "host") {
      return;
    }
    try {
      await this.#transport.sendToPeer(peerId, this.#buildRosterSnapshotMessage());
    } catch {
      // Peer-Kanal konnte noch nicht bereit sein
    }
  }

  async #broadcastRosterSnapshot(): Promise<void> {
    if (!this.#transport || this.#transportSnapshot?.selfRole !== "host") {
      return;
    }
    try {
      await this.#transport.broadcast(this.#buildRosterSnapshotMessage());
    } catch {
      // Einzelne noch nicht geöffnete Channels werden beim Verbindungsaufbau synchronisiert
    }
  }

  #emit(): void {
    const state = this.getState();
    for (const listener of this.#listeners) {
      listener(state);
    }
  }

  #emitTransportSnapshot(snapshot: CollabTransportSnapshot | null): void {
    for (const listener of this.#transportSnapshotListeners) {
      listener(snapshot);
    }
  }

  #emitTransportMessage(fromPeerId: string, message: CollabDataChannelMessage): void {
    for (const listener of this.#transportMessageListeners) {
      listener(fromPeerId, message);
    }
  }
}

export {
  COLLAB_CONTROL_ACTION_MODERATE_NAME,
  COLLAB_CONTROL_ACTION_ROLE_UPDATE,
};
export default CollabSessionController;
