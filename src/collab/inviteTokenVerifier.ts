import type { CollabInviteRole } from "../types/collab/collabRole";

import { DEFAULT_COLLAB_INVITE_TTL_MS } from "./collabEvents";

export type IssuedInviteToken = {
  inviteToken: string;
  sessionId: string;
  role: CollabInviteRole;
  createdAt: number;
  expiresAt: number;
  tokenProof: string;
};

export type InviteVerificationFailureReason =
  | "unknown-token"
  | "session-mismatch"
  | "role-mismatch"
  | "proof-mismatch"
  | "token-revoked"
  | "token-expired";

export type InviteVerificationResult =
  | {
    valid: true;
    role: CollabInviteRole;
    inviteToken: string;
    expiresAt: number;
  }
  | {
    valid: false;
    reason: InviteVerificationFailureReason;
  };

export type VerifyJoinParams = {
  sessionId: string;
  inviteToken: string;
  claimedRole: unknown;
  tokenProof?: string;
};

export type InviteTokenVerifierOptions = {
  sessionId: string;
  defaultTtlMs?: number;
  now?: () => number;
};

type StoredInviteRecord = IssuedInviteToken & {
  revoked: boolean;
};

const MIN_INVITE_TTL_MS = 10000;
const utf8Encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function constantTimeStringEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function createRandomToken(byteLength = 24): string {
  const bytes = new Uint8Array(byteLength);
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("Web Crypto randomBytes ist in dieser Laufzeitumgebung nicht verfügbar.");
  }
  globalThis.crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

// Hostseitige Erzeugung und HMAC-SHA256-Prüfung rollengebundener 5-Minuten-Einladungslinks
class InviteTokenVerifier {
  readonly #sessionId: string;
  readonly #defaultTtlMs: number;
  readonly #now: () => number;
  readonly #rawSecret: Uint8Array;
  readonly #issued = new Map<string, StoredInviteRecord>();
  #signingKeyPromise: Promise<CryptoKey> | null = null;

  constructor(options: InviteTokenVerifierOptions) {
    const trimmedSessionId = options.sessionId.trim();
    if (trimmedSessionId.length === 0) {
      throw new Error("sessionId darf für InviteTokenVerifier nicht leer sein.");
    }

    this.#sessionId = trimmedSessionId;
    this.#defaultTtlMs = Math.max(
      MIN_INVITE_TTL_MS,
      Math.min(options.defaultTtlMs ?? DEFAULT_COLLAB_INVITE_TTL_MS, DEFAULT_COLLAB_INVITE_TTL_MS),
    );
    this.#now = options.now ?? (() => Date.now());

    const secret = new Uint8Array(32);
    if (typeof globalThis.crypto?.getRandomValues !== "function") {
      throw new Error("Web Crypto getRandomValues ist in dieser Laufzeitumgebung nicht verfügbar.");
    }
    globalThis.crypto.getRandomValues(secret);
    this.#rawSecret = secret;
  }

  get sessionId(): string {
    return this.#sessionId;
  }

  async issueInvite(role: CollabInviteRole, ttlMs?: number): Promise<IssuedInviteToken> {
    if (role !== "guest" && role !== "collaborator") {
      throw new Error("Nur die Rollen 'guest' und 'collaborator' sind für Einladungslinks zulässig.");
    }

    this.cleanupExpired();

    const createdAt = this.#now();
    const requestedTtl = typeof ttlMs === "number" && Number.isFinite(ttlMs) ? Math.floor(ttlMs) : this.#defaultTtlMs;
    const effectiveTtl = Math.max(MIN_INVITE_TTL_MS, Math.min(requestedTtl, DEFAULT_COLLAB_INVITE_TTL_MS));
    const expiresAt = createdAt + effectiveTtl;

    let inviteToken = createRandomToken(24);
    while (this.#issued.has(inviteToken)) {
      inviteToken = createRandomToken(24);
    }

    const tokenProof = await this.#signRecord(this.#sessionId, inviteToken, role, expiresAt);
    const record: StoredInviteRecord = {
      inviteToken,
      sessionId: this.#sessionId,
      role,
      createdAt,
      expiresAt,
      tokenProof,
      revoked: false,
    };

    this.#issued.set(inviteToken, record);
    return {
      inviteToken: record.inviteToken,
      sessionId: record.sessionId,
      role: record.role,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      tokenProof: record.tokenProof,
    };
  }

  revokeInvite(inviteToken: string): boolean {
    const record = this.#issued.get(inviteToken.trim());
    if (!record || record.revoked) {
      return false;
    }
    record.revoked = true;
    return true;
  }

  revokeAll(): void {
    for (const record of this.#issued.values()) {
      record.revoked = true;
    }
  }

  async verifyJoin(params: VerifyJoinParams): Promise<InviteVerificationResult> {
    const now = this.#now();
    const normalizedSessionId = params.sessionId.trim();
    if (normalizedSessionId !== this.#sessionId) {
      return { valid: false, reason: "session-mismatch" };
    }

    const token = params.inviteToken.trim();
    const record = this.#issued.get(token);
    if (!record) {
      return { valid: false, reason: "unknown-token" };
    }

    if (record.revoked) {
      return { valid: false, reason: "token-revoked" };
    }

    if (now >= record.expiresAt) {
      this.#issued.delete(token);
      return { valid: false, reason: "token-expired" };
    }

    if (params.claimedRole !== record.role) {
      return { valid: false, reason: "role-mismatch" };
    }

    if (typeof params.tokenProof !== "string" || params.tokenProof.length === 0) {
      return { valid: false, reason: "proof-mismatch" };
    }

    const expectedProof = await this.#signRecord(record.sessionId, record.inviteToken, record.role, record.expiresAt);
    if (
      !constantTimeStringEquals(params.tokenProof, expectedProof) ||
      !constantTimeStringEquals(record.tokenProof, expectedProof)
    ) {
      return { valid: false, reason: "proof-mismatch" };
    }

    return {
      valid: true,
      role: record.role,
      inviteToken: record.inviteToken,
      expiresAt: record.expiresAt,
    };
  }

  listActiveInvites(): IssuedInviteToken[] {
    this.cleanupExpired();
    const result: IssuedInviteToken[] = [];
    for (const record of this.#issued.values()) {
      if (!record.revoked) {
        result.push({
          inviteToken: record.inviteToken,
          sessionId: record.sessionId,
          role: record.role,
          createdAt: record.createdAt,
          expiresAt: record.expiresAt,
          tokenProof: record.tokenProof,
        });
      }
    }
    return result;
  }

  cleanupExpired(): number {
    const now = this.#now();
    let removed = 0;
    for (const [token, record] of this.#issued.entries()) {
      if (now >= record.expiresAt) {
        this.#issued.delete(token);
        removed += 1;
      }
    }
    return removed;
  }

  async #getSigningKey(): Promise<CryptoKey> {
    if (!this.#signingKeyPromise) {
      const subtle = globalThis.crypto?.subtle;
      if (!subtle) {
        throw new Error("Web Crypto SubtleCrypto ist in dieser Laufzeitumgebung nicht verfügbar.");
      }
      const keyData = new Uint8Array(this.#rawSecret);
      this.#signingKeyPromise = subtle.importKey(
        "raw",
        keyData.buffer,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
    }
    return this.#signingKeyPromise;
  }

  async #signRecord(
    sessionId: string,
    inviteToken: string,
    role: CollabInviteRole,
    expiresAt: number,
  ): Promise<string> {
    const key = await this.#getSigningKey();
    const payload = `v1|${sessionId}|${inviteToken}|${role}|${expiresAt}`;
    const signature = await globalThis.crypto.subtle.sign("HMAC", key, utf8Encoder.encode(payload));
    return toBase64Url(new Uint8Array(signature));
  }
}

export default InviteTokenVerifier;
