import type CollabRole from "../types/collab/collabRole";
import type {
  CollabSoftLockEntry,
  CollabSoftLockPayload,
  CollabSoftLockReason,
  CollabSoftLockTargetType,
} from "../types/collab/modelSyncMessage";

import { generateEntityUuid } from "../utils/entityId";

export const DEFAULT_SOFT_LOCK_TTL_MS = 14_000;
export const DEFAULT_SOFT_LOCK_RENEW_INTERVAL_MS = 5_000;
export const DEFAULT_SOFT_LOCK_SWEEP_INTERVAL_MS = 1_000;

const MIN_REMOTE_LEASE_TTL_MS = 1_000;

export type CollabSoftLockTarget = {
  targetType: CollabSoftLockTargetType;
  targetId: string;
  logicalCircuitId: string;
};

export type CollabSoftLockAcquireResult =
  | {
    ok: true;
    acquired: CollabSoftLockEntry[];
  }
  | {
    ok: false;
    blockedBy: CollabSoftLockEntry[];
  };

export type CollabSoftLockSessionConfig = {
  isActive: boolean;
  selfPeerId: string | null;
  selfDisplayName: string;
  selfRole: CollabRole | null;
};

export type CollabSoftLockManagerOptions = {
  ttlMs?: number;
  renewIntervalMs?: number;
  sweepIntervalMs?: number;
  now?: () => number;
  sendLockMessage?: (payload: CollabSoftLockPayload) => void;
  onLocksChanged?: (locks: CollabSoftLockEntry[]) => void;
};

function buildLockKey(targetType: CollabSoftLockTargetType, targetId: string): string {
  return `${targetType}:${targetId}`;
}

function isValidTargetType(value: unknown): value is CollabSoftLockTargetType {
  return value === "symbol" || value === "textNote" || value === "logicalCircuit";
}

function isValidLockEntryShape(entry: Partial<CollabSoftLockEntry> | null | undefined): entry is CollabSoftLockEntry {
  return Boolean(
    entry &&
    typeof entry.targetId === "string" &&
    entry.targetId.trim().length > 0 &&
    typeof entry.logicalCircuitId === "string" &&
    isValidTargetType(entry.targetType),
  );
}

// Verwaltet ephemere Soft-Locks (Leases) mit kurzem TTL, Auto-Renew und Freigabe bei Disconnect/Handover
class CollabSoftLockManager {
  readonly #ttlMs: number;
  readonly #renewIntervalMs: number;
  readonly #sweepIntervalMs: number;
  readonly #now: () => number;
  readonly #sendLockMessage?: (payload: CollabSoftLockPayload) => void;
  readonly #onLocksChanged?: (locks: CollabSoftLockEntry[]) => void;

  readonly #locks = new Map<string, CollabSoftLockEntry>();
  readonly #localHeldKeys = new Set<string>();

  #isSessionActive = false;
  #selfPeerId: string | null = null;
  #selfDisplayName = "";
  #selfRole: CollabRole | null = null;
  #renewTimer: ReturnType<typeof setInterval> | null = null;
  #sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: CollabSoftLockManagerOptions) {
    this.#ttlMs = Math.max(500, Math.floor(options?.ttlMs ?? DEFAULT_SOFT_LOCK_TTL_MS));
    this.#renewIntervalMs = Math.max(100, Math.floor(options?.renewIntervalMs ?? DEFAULT_SOFT_LOCK_RENEW_INTERVAL_MS));
    this.#sweepIntervalMs = Math.max(100, Math.floor(options?.sweepIntervalMs ?? DEFAULT_SOFT_LOCK_SWEEP_INTERVAL_MS));
    this.#now = options?.now ?? (() => Date.now());
    this.#sendLockMessage = options?.sendLockMessage;
    this.#onLocksChanged = options?.onLocksChanged;
  }

  // Aktualisiert Session-Metadaten, räumt bei Rollenverlust/Ende eigene Locks ab und steuert Lease-Timer
  configureSession(config: CollabSoftLockSessionConfig): void {
    const previousPeerId = this.#selfPeerId;
    this.#isSessionActive = config.isActive;
    this.#selfPeerId = config.selfPeerId;
    this.#selfDisplayName = config.selfDisplayName.trim() || config.selfPeerId || "Teilnehmer";
    this.#selfRole = config.selfRole;

    if (!config.isActive) {
      const hadLocks = this.#locks.size > 0 || this.#localHeldKeys.size > 0;
      this.#locks.clear();
      this.#localHeldKeys.clear();
      this.#stopRenewTimer();
      this.#stopSweepTimer();
      if (hadLocks) {
        this.#emitChanged();
      }
      return;
    }

    this.#ensureSweepTimer();

    if (previousPeerId && config.selfPeerId && previousPeerId !== config.selfPeerId) {
      this.#releaseAllLocalLocksInternal();
    }

    if (config.selfRole === "guest") {
      this.#releaseAllLocalLocksInternal();
      this.#stopRenewTimer();
      return;
    }

    if (this.#localHeldKeys.size > 0) {
      this.#ensureRenewTimer();
    } else {
      this.#stopRenewTimer();
    }
  }

  // Liefert alle aktiven, nicht abgelaufenen Soft-Locks deterministisch sortiert
  getActiveLocks(): CollabSoftLockEntry[] {
    this.pruneExpired();
    return Array.from(this.#locks.values())
      .map((entry) => ({ ...entry }))
      .sort((a, b) => {
        if (a.acquiredAt !== b.acquiredAt) {
          return a.acquiredAt - b.acquiredAt;
        }
        return a.targetId.localeCompare(b.targetId);
      });
  }

  getLockForTarget(targetType: CollabSoftLockTargetType, targetId: string): CollabSoftLockEntry | null {
    this.pruneExpired();
    const found = this.#locks.get(buildLockKey(targetType, targetId));
    return found ? { ...found } : null;
  }

  getForeignLockForTarget(
    targetType: CollabSoftLockTargetType,
    targetId: string,
    selfPeerIdOverride?: string | null,
  ): CollabSoftLockEntry | null {
    const existing = this.getLockForTarget(targetType, targetId);
    const selfId = selfPeerIdOverride !== undefined ? selfPeerIdOverride : this.#selfPeerId;
    if (!existing || (selfId && existing.ownerPeerId === selfId)) {
      return null;
    }
    return existing;
  }

  getForeignLocks(selfPeerIdOverride?: string | null): CollabSoftLockEntry[] {
    const selfId = selfPeerIdOverride !== undefined ? selfPeerIdOverride : this.#selfPeerId;
    return this.getActiveLocks().filter((lock) => !selfId || lock.ownerPeerId !== selfId);
  }

  findForeignLocks(
    targets: ReadonlyArray<{ targetType: CollabSoftLockTargetType; targetId: string }>,
    selfPeerIdOverride?: string | null,
  ): CollabSoftLockEntry[] {
    this.pruneExpired();
    const selfId = selfPeerIdOverride !== undefined ? selfPeerIdOverride : this.#selfPeerId;
    const seen = new Set<string>();
    const blocked: CollabSoftLockEntry[] = [];

    for (const target of targets) {
      const key = buildLockKey(target.targetType, target.targetId);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const entry = this.#locks.get(key);
      if (entry && (!selfId || entry.ownerPeerId !== selfId)) {
        blocked.push({ ...entry });
      }
    }

    return blocked;
  }

  isTargetLockedByOther(
    targetType: CollabSoftLockTargetType,
    targetId: string,
    selfPeerIdOverride?: string | null,
  ): boolean {
    return this.getForeignLockForTarget(targetType, targetId, selfPeerIdOverride) !== null;
  }

  // Erwirbt Soft-Locks atomar für alle Ziel-Elemente oder blockiert bei fremden Leases
  acquireLocks(
    targets: ReadonlyArray<CollabSoftLockTarget>,
    reason: CollabSoftLockReason,
  ): CollabSoftLockAcquireResult {
    this.pruneExpired();
    if (!this.#isSessionActive) {
      return { ok: true, acquired: [] };
    }
    if (this.#selfRole === "guest" || !this.#selfPeerId) {
      return { ok: false, blockedBy: [] };
    }

    const uniqueTargets: CollabSoftLockTarget[] = [];
    const seenKeys = new Set<string>();
    for (const target of targets) {
      const key = buildLockKey(target.targetType, target.targetId);
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      uniqueTargets.push(target);
    }

    if (uniqueTargets.length === 0) {
      return { ok: true, acquired: [] };
    }

    const blockedBy = this.findForeignLocks(uniqueTargets);
    if (blockedBy.length > 0) {
      return { ok: false, blockedBy };
    }

    const now = this.#now();
    const acquired: CollabSoftLockEntry[] = [];
    for (const target of uniqueTargets) {
      const key = buildLockKey(target.targetType, target.targetId);
      const existing = this.#locks.get(key);
      const entry: CollabSoftLockEntry = {
        lockId: existing && existing.ownerPeerId === this.#selfPeerId ? existing.lockId : generateEntityUuid(),
        targetType: target.targetType,
        targetId: target.targetId,
        logicalCircuitId: target.logicalCircuitId,
        ownerPeerId: this.#selfPeerId,
        ownerDisplayName: this.#selfDisplayName || this.#selfPeerId,
        reason,
        acquiredAt: existing && existing.ownerPeerId === this.#selfPeerId ? existing.acquiredAt : now,
        expiresAt: now + this.#ttlMs,
      };
      this.#locks.set(key, entry);
      this.#localHeldKeys.add(key);
      acquired.push({ ...entry });
    }

    this.#ensureRenewTimer();
    this.#sendLockMessage?.({
      action: "acquire",
      locks: acquired,
      senderPeerId: this.#selfPeerId,
    });
    this.#emitChanged();

    return { ok: true, acquired };
  }

  // Verlängert die TTL aller angegebenen oder aktuell lokal gehaltenen Soft-Locks
  renewLocalLocks(
    targets?: ReadonlyArray<{ targetType: CollabSoftLockTargetType; targetId: string }>,
  ): CollabSoftLockEntry[] {
    this.pruneExpired();
    if (!this.#isSessionActive || !this.#selfPeerId || this.#selfRole === "guest") {
      return [];
    }

    const keysToRenew = targets
      ? targets.map((t) => buildLockKey(t.targetType, t.targetId))
      : Array.from(this.#localHeldKeys);

    if (keysToRenew.length === 0) {
      this.#stopRenewTimer();
      return [];
    }

    const now = this.#now();
    const renewed: CollabSoftLockEntry[] = [];
    for (const key of keysToRenew) {
      const existing = this.#locks.get(key);
      if (!existing || existing.ownerPeerId !== this.#selfPeerId) {
        this.#localHeldKeys.delete(key);
        continue;
      }
      const nextEntry: CollabSoftLockEntry = {
        ...existing,
        expiresAt: now + this.#ttlMs,
      };
      this.#locks.set(key, nextEntry);
      renewed.push({ ...nextEntry });
    }

    if (this.#localHeldKeys.size === 0) {
      this.#stopRenewTimer();
    }

    if (renewed.length > 0) {
      this.#sendLockMessage?.({
        action: "renew",
        locks: renewed,
        senderPeerId: this.#selfPeerId,
      });
      this.#emitChanged();
    }

    return renewed;
  }

  // Gibt angegebene oder sämtliche eigenen Soft-Locks explizit frei
  releaseLocks(
    targets?: ReadonlyArray<{ targetType: CollabSoftLockTargetType; targetId: string }>,
  ): CollabSoftLockEntry[] {
    if (!targets) {
      return this.#releaseAllLocalLocksInternal();
    }

    const released: CollabSoftLockEntry[] = [];
    const seenKeys = new Set<string>();
    for (const target of targets) {
      const key = buildLockKey(target.targetType, target.targetId);
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      const existing = this.#locks.get(key);
      if (existing && (!this.#selfPeerId || existing.ownerPeerId === this.#selfPeerId)) {
        this.#locks.delete(key);
        this.#localHeldKeys.delete(key);
        released.push({ ...existing });
      }
    }

    if (this.#localHeldKeys.size === 0) {
      this.#stopRenewTimer();
    }

    if (released.length > 0) {
      this.#sendLockMessage?.({
        action: "release",
        locks: released,
        senderPeerId: this.#selfPeerId ?? undefined,
      });
      this.#emitChanged();
    }

    return released;
  }

  // Entfernt alle Locks eines getrennten oder zum Gast herabgestuften Teilnehmers
  releaseLocksByOwner(peerId: string): CollabSoftLockEntry[] {
    const released: CollabSoftLockEntry[] = [];
    for (const [key, entry] of Array.from(this.#locks.entries())) {
      if (entry.ownerPeerId === peerId) {
        this.#locks.delete(key);
        this.#localHeldKeys.delete(key);
        released.push({ ...entry });
      }
    }

    if (this.#localHeldKeys.size === 0) {
      this.#stopRenewTimer();
    }

    if (released.length > 0) {
      this.#emitChanged();
    }
    return released;
  }

  clearAllLocks(broadcast = false): void {
    const hadLocks = this.#locks.size > 0 || this.#localHeldKeys.size > 0;
    this.#locks.clear();
    this.#localHeldKeys.clear();
    this.#stopRenewTimer();
    if (broadcast) {
      this.#sendLockMessage?.({
        action: "snapshot",
        locks: [],
        senderPeerId: this.#selfPeerId ?? undefined,
      });
    }
    if (hadLocks) {
      this.#emitChanged();
    }
  }

  createSnapshotPayload(): CollabSoftLockPayload {
    return {
      action: "snapshot",
      locks: this.getActiveLocks(),
      senderPeerId: this.#selfPeerId ?? undefined,
    };
  }

  // Verarbeitet eingehende Lock-Nachrichten (host-autoritativ mit Konfliktauflösung oder lokal spiegelnd)
  handleIncomingPayload(
    fromPeerId: string,
    payload: CollabSoftLockPayload,
    isHostAuthority: boolean,
    ownerDisplayNameFallback?: string,
  ): {
    broadcast?: CollabSoftLockPayload;
    replySnapshot?: CollabSoftLockPayload;
  } {
    this.pruneExpired();
    const now = this.#now();

    if (payload.action === "snapshot") {
      if (isHostAuthority) {
        return {};
      }
      this.#locks.clear();
      const nextKeys = new Set<string>();
      for (const rawEntry of payload.locks) {
        if (!isValidLockEntryShape(rawEntry) || rawEntry.expiresAt <= now) {
          continue;
        }
        const key = buildLockKey(rawEntry.targetType, rawEntry.targetId);
        this.#locks.set(key, { ...rawEntry });
        if (this.#selfPeerId && rawEntry.ownerPeerId === this.#selfPeerId) {
          nextKeys.add(key);
        }
      }
      for (const localKey of Array.from(this.#localHeldKeys)) {
        if (!nextKeys.has(localKey)) {
          this.#localHeldKeys.delete(localKey);
        }
      }
      if (this.#localHeldKeys.size === 0) {
        this.#stopRenewTimer();
      }
      this.#emitChanged();
      return {};
    }

    if (payload.action === "acquire" || payload.action === "renew") {
      if (isHostAuthority) {
        const accepted: CollabSoftLockEntry[] = [];
        let hadConflict = false;
        const resolvedName = ownerDisplayNameFallback?.trim() || fromPeerId;

        for (const rawEntry of payload.locks) {
          if (!isValidLockEntryShape(rawEntry)) {
            continue;
          }
          const key = buildLockKey(rawEntry.targetType, rawEntry.targetId);
          const existing = this.#locks.get(key);
          if (existing && existing.ownerPeerId !== fromPeerId) {
            hadConflict = true;
            continue;
          }
          const boundedExpiresAt =
            typeof rawEntry.expiresAt === "number" && Number.isFinite(rawEntry.expiresAt)
              ? Math.min(now + this.#ttlMs, Math.max(now + MIN_REMOTE_LEASE_TTL_MS, rawEntry.expiresAt))
              : now + this.#ttlMs;
          const normalized: CollabSoftLockEntry = {
            lockId: existing?.lockId ?? (rawEntry.lockId?.trim() || generateEntityUuid()),
            targetType: rawEntry.targetType,
            targetId: rawEntry.targetId,
            logicalCircuitId: rawEntry.logicalCircuitId,
            ownerPeerId: fromPeerId,
            ownerDisplayName: rawEntry.ownerDisplayName?.trim() || resolvedName,
            reason: rawEntry.reason ?? existing?.reason ?? "drag",
            acquiredAt: existing ? existing.acquiredAt : (rawEntry.acquiredAt || now),
            expiresAt: boundedExpiresAt,
          };
          this.#locks.set(key, normalized);
          accepted.push({ ...normalized });
        }

        if (accepted.length > 0) {
          this.#emitChanged();
        }

        return {
          ...(accepted.length > 0
            ? {
              broadcast: {
                action: payload.action,
                locks: accepted,
                senderPeerId: fromPeerId,
              },
            }
            : {}),
          ...(hadConflict ? { replySnapshot: this.createSnapshotPayload() } : {}),
        };
      }

      let changed = false;
      for (const rawEntry of payload.locks) {
        if (!isValidLockEntryShape(rawEntry) || rawEntry.expiresAt <= now) {
          continue;
        }
        const key = buildLockKey(rawEntry.targetType, rawEntry.targetId);
        this.#locks.set(key, { ...rawEntry });
        if (this.#selfPeerId && rawEntry.ownerPeerId !== this.#selfPeerId) {
          this.#localHeldKeys.delete(key);
        }
        changed = true;
      }
      if (this.#localHeldKeys.size === 0) {
        this.#stopRenewTimer();
      }
      if (changed) {
        this.#emitChanged();
      }
      return {};
    }

    if (payload.action === "release") {
      const removed: CollabSoftLockEntry[] = [];
      for (const rawEntry of payload.locks) {
        if (!isValidTargetType(rawEntry.targetType) || typeof rawEntry.targetId !== "string") {
          continue;
        }
        const key = buildLockKey(rawEntry.targetType, rawEntry.targetId);
        const existing = this.#locks.get(key);
        if (!existing) {
          continue;
        }
        const expectedOwner = isHostAuthority ? fromPeerId : (rawEntry.ownerPeerId || payload.senderPeerId || fromPeerId);
        if (expectedOwner && existing.ownerPeerId !== expectedOwner) {
          continue;
        }
        this.#locks.delete(key);
        this.#localHeldKeys.delete(key);
        removed.push({ ...existing });
      }
      if (this.#localHeldKeys.size === 0) {
        this.#stopRenewTimer();
      }
      if (removed.length > 0) {
        this.#emitChanged();
        if (isHostAuthority) {
          return {
            broadcast: {
              action: "release",
              locks: removed,
              senderPeerId: fromPeerId,
            },
          };
        }
      }
    }

    return {};
  }

  // Entfernt abgelaufene Leases anhand der aktuellen Uhrzeit
  pruneExpired(): CollabSoftLockEntry[] {
    const now = this.#now();
    const expired: CollabSoftLockEntry[] = [];
    for (const [key, entry] of Array.from(this.#locks.entries())) {
      if (entry.expiresAt <= now) {
        this.#locks.delete(key);
        this.#localHeldKeys.delete(key);
        expired.push({ ...entry });
      }
    }
    if (this.#localHeldKeys.size === 0) {
      this.#stopRenewTimer();
    }
    if (expired.length > 0) {
      this.#emitChanged();
    }
    return expired;
  }

  dispose(): void {
    this.#stopRenewTimer();
    this.#stopSweepTimer();
    this.#locks.clear();
    this.#localHeldKeys.clear();
  }

  #releaseAllLocalLocksInternal(): CollabSoftLockEntry[] {
    const released: CollabSoftLockEntry[] = [];
    for (const [key, entry] of Array.from(this.#locks.entries())) {
      if (this.#localHeldKeys.has(key) || (this.#selfPeerId && entry.ownerPeerId === this.#selfPeerId)) {
        this.#locks.delete(key);
        this.#localHeldKeys.delete(key);
        released.push({ ...entry });
      }
    }
    this.#stopRenewTimer();
    if (released.length > 0) {
      this.#sendLockMessage?.({
        action: "release",
        locks: released,
        senderPeerId: this.#selfPeerId ?? undefined,
      });
      this.#emitChanged();
    }
    return released;
  }

  #ensureRenewTimer(): void {
    if (this.#renewTimer !== null) {
      return;
    }
    this.#renewTimer = setInterval(() => {
      this.renewLocalLocks();
    }, this.#renewIntervalMs);
  }

  #stopRenewTimer(): void {
    if (this.#renewTimer !== null) {
      clearInterval(this.#renewTimer);
      this.#renewTimer = null;
    }
  }

  #ensureSweepTimer(): void {
    if (this.#sweepTimer !== null) {
      return;
    }
    this.#sweepTimer = setInterval(() => {
      this.pruneExpired();
    }, this.#sweepIntervalMs);
  }

  #stopSweepTimer(): void {
    if (this.#sweepTimer !== null) {
      clearInterval(this.#sweepTimer);
      this.#sweepTimer = null;
    }
  }

  #emitChanged(): void {
    this.#onLocksChanged?.(
      Array.from(this.#locks.values())
        .map((entry) => ({ ...entry }))
        .sort((a, b) => (a.acquiredAt !== b.acquiredAt ? a.acquiredAt - b.acquiredAt : a.targetId.localeCompare(b.targetId))),
    );
  }
}

export default CollabSoftLockManager;
