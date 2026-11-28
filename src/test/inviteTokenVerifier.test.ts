import { describe, expect, it } from "vitest";

import InviteTokenVerifier from "../collab/inviteTokenVerifier";

describe("InviteTokenVerifier", () => {
  it("erzeugt rollengebundene 5-Minuten-Tokens und verhindert Rollen-Eskalation sowie Proof-Manipulation", async () => {
    let nowMs = 5_000_000;
    const verifier = new InviteTokenVerifier({
      sessionId: "sess-aaaa-bbbb-cccc",
      now: () => nowMs,
    });

    const guestInvite = await verifier.issueInvite("guest");
    const collabInvite = await verifier.issueInvite("collaborator");

    expect(guestInvite.expiresAt - guestInvite.createdAt).toBe(5 * 60 * 1000);
    expect(guestInvite.inviteToken).toMatch(/^[A-Za-z0-9_-]{16,128}$/);

    // Mehrfache gleichzeitige Verifikation desselben gültigen Links ist zulässig
    const ok1 = await verifier.verifyJoin({
      sessionId: "sess-aaaa-bbbb-cccc",
      inviteToken: guestInvite.inviteToken,
      claimedRole: "guest",
      tokenProof: guestInvite.tokenProof,
    });
    const ok2 = await verifier.verifyJoin({
      sessionId: "sess-aaaa-bbbb-cccc",
      inviteToken: guestInvite.inviteToken,
      claimedRole: "guest",
      tokenProof: guestInvite.tokenProof,
    });
    expect(ok1).toEqual({
      valid: true,
      role: "guest",
      inviteToken: guestInvite.inviteToken,
      expiresAt: guestInvite.expiresAt,
    });
    expect(ok2.valid).toBe(true);

    // Versuch einer Rollen-Eskalation (Gast gibt sich als Kollaborateur oder Host aus) wird blockiert
    const escalationCollab = await verifier.verifyJoin({
      sessionId: "sess-aaaa-bbbb-cccc",
      inviteToken: guestInvite.inviteToken,
      claimedRole: "collaborator",
      tokenProof: guestInvite.tokenProof,
    });
    expect(escalationCollab).toEqual({ valid: false, reason: "role-mismatch" });

    const escalationHost = await verifier.verifyJoin({
      sessionId: "sess-aaaa-bbbb-cccc",
      inviteToken: collabInvite.inviteToken,
      claimedRole: "host",
      tokenProof: collabInvite.tokenProof,
    });
    expect(escalationHost).toEqual({ valid: false, reason: "role-mismatch" });

    // Manipulierter tokenProof oder fremde SessionID wird abgewiesen
    const tamperedProof = await verifier.verifyJoin({
      sessionId: "sess-aaaa-bbbb-cccc",
      inviteToken: guestInvite.inviteToken,
      claimedRole: "guest",
      tokenProof: `${guestInvite.tokenProof.slice(0, -1)}X`,
    });
    expect(tamperedProof).toEqual({ valid: false, reason: "proof-mismatch" });

    const wrongSession = await verifier.verifyJoin({
      sessionId: "sess-other",
      inviteToken: guestInvite.inviteToken,
      claimedRole: "guest",
      tokenProof: guestInvite.tokenProof,
    });
    expect(wrongSession).toEqual({ valid: false, reason: "session-mismatch" });

    // Widerruf blockiert den Link sofort
    expect(verifier.revokeInvite(guestInvite.inviteToken)).toBe(true);
    const revokedRes = await verifier.verifyJoin({
      sessionId: "sess-aaaa-bbbb-cccc",
      inviteToken: guestInvite.inviteToken,
      claimedRole: "guest",
      tokenProof: guestInvite.tokenProof,
    });
    expect(revokedRes).toEqual({ valid: false, reason: "token-revoked" });

    // Ablauf nach 5 Minuten macht auch nicht-widerrufene Links ungültig
    nowMs += 5 * 60 * 1000;
    const expiredRes = await verifier.verifyJoin({
      sessionId: "sess-aaaa-bbbb-cccc",
      inviteToken: collabInvite.inviteToken,
      claimedRole: "collaborator",
      tokenProof: collabInvite.tokenProof,
    });
    expect(expiredRes).toEqual({ valid: false, reason: "token-expired" });
    expect(verifier.listActiveInvites()).toHaveLength(0);
  });

  it("widerruft mit revokeAll sämtliche aktiven Einladungs-Tokens", async () => {
    const verifier = new InviteTokenVerifier({ sessionId: "sess-1234-5678-9012" });
    const invite = await verifier.issueInvite("collaborator");
    expect(verifier.listActiveInvites()).toHaveLength(1);

    verifier.revokeAll();
    expect(verifier.listActiveInvites()).toHaveLength(0);

    const check = await verifier.verifyJoin({
      sessionId: "sess-1234-5678-9012",
      inviteToken: invite.inviteToken,
      claimedRole: "collaborator",
      tokenProof: invite.tokenProof,
    });
    expect(check).toEqual({ valid: false, reason: "token-revoked" });
  });
});
