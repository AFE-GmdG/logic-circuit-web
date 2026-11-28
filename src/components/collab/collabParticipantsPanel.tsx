import React from "react";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CircuitContext from "../../contexts/circuitContext";
import CollabContext, { type CollabContextType } from "../../contexts/collabContext";
import LibraryContext from "../../contexts/libraryContext";
import SimulationContext from "../../contexts/simulationContext";

import type CollabRole from "../../types/collab/collabRole";
import type CollabParticipant from "../../types/collab/sessionState";
import type { CollabPeerConnectionState } from "../../types/collab/transportState";
import { COLLAB_CURSOR_VISIBILITY_MODES } from "../../types/settings/collabCursorVisibilityMode";

import { MAX_COLLAB_DISPLAY_NAME_LENGTH } from "../../collab/collabAuthorization";
import {
  getCursorVisibilityModeTranslationKey,
  resolveCollabCursorVisibilityMode,
} from "../../utils/appSettingsStorage";
import { isLocalhostSidecarUrl } from "../../utils/collabInviteLink";
import {
  COLLAB_PARTICIPANT_COLOR_PALETTE,
  pickAutoParticipantColor,
} from "../../utils/collabParticipantColors";
import { isLoopbackHostname } from "../../utils/sidecarStorage";

export type CollabParticipantsPanelProps = Omit<React.ComponentPropsWithoutRef<"section">, "children"> & {
  collabOverride?: CollabContextType;
  renderParticipantActions?: (participant: CollabParticipant) => React.ReactNode;
  onRequestTransferHost?: (participant: CollabParticipant) => void;
  initialModeratingPeerId?: string | null;
  initialColorPickerPeerId?: string | null;
};

function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  return Promise.resolve(false);
}

function formatRemainingTime(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const PANEL_ERROR_AUTO_DISMISS_MS = 5000;

export function getRoleTranslationKey(role: CollabRole): string {
  switch (role) {
    case "host":
      return "collabPanel.roles.host";
    case "collaborator":
      return "collabPanel.roles.collaborator";
    case "guest":
      return "collabPanel.roles.guest";
  }
}

function getConnectionStateTranslationKey(state: CollabPeerConnectionState): string {
  switch (state) {
    case "connecting":
      return "collabPanel.connectionStates.connecting";
    case "connected":
      return "collabPanel.connectionStates.connected";
    case "degraded":
      return "collabPanel.connectionStates.degraded";
    case "reconnecting":
      return "collabPanel.connectionStates.reconnecting";
    case "failed":
      return "collabPanel.connectionStates.failed";
    case "disconnected":
      return "collabPanel.connectionStates.disconnected";
  }
}

// Schwebendes, einklappbares Teilnehmer-Panel unten rechts oberhalb der StatusBar
const CollabParticipantsPanel = styled(({
  collabOverride,
  renderParticipantActions,
  onRequestTransferHost,
  initialModeratingPeerId = null,
  initialColorPickerPeerId = null,
  ...other
}: CollabParticipantsPanelProps) => {
  const { t } = useTranslation();
  const circuitContext = React.useContext(CircuitContext);
  const libraryContext = React.useContext(LibraryContext);
  const simulationContext = React.useContext(SimulationContext);
  const liveCollab = React.useContext(CollabContext);
  const collab = collabOverride ?? liveCollab;

  const initialModeratedParticipant = initialModeratingPeerId
    ? collab?.participants.find((participant) => participant.peerId === initialModeratingPeerId)
    : undefined;
  const initialColorPickerParticipant = initialColorPickerPeerId
    ? collab?.participants.find((participant) => participant.peerId === initialColorPickerPeerId && !participant.isSelf)
    : undefined;

  const [selfNameDraft, setSelfNameDraft] = React.useState(collab?.displayName ?? "");
  const [copiedToken, setCopiedToken] = React.useState<string | null>(null);
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const [moderatingPeerId, setModeratingPeerId] = React.useState<string | null>(
    initialModeratedParticipant ? initialModeratedParticipant.peerId : null,
  );
  const [moderateNameDraft, setModerateNameDraft] = React.useState(
    initialModeratedParticipant?.displayName ?? "",
  );
  const [moderateNameLocked, setModerateNameLocked] = React.useState(
    initialModeratedParticipant?.nameLocked ?? false,
  );
  const [colorPickerPeerId, setColorPickerPeerId] = React.useState<string | null>(
    initialColorPickerParticipant ? initialColorPickerParticipant.peerId : null,
  );

  const isExpanded = collab?.isParticipantsPanelOpen ?? false;
  const activeInvitesCount = collab?.activeInvites.length ?? 0;
  const hasModeratedParticipant = Boolean(
    collab?.isHost &&
    moderatingPeerId &&
    collab.participants.some((participant) => participant.peerId === moderatingPeerId),
  );
  const hasColorPickerParticipant = Boolean(
    isExpanded &&
    colorPickerPeerId &&
    collab?.participants.some((participant) => participant.peerId === colorPickerPeerId && !participant.isSelf),
  );

  React.useEffect(
    () => {
      if (moderatingPeerId && !hasModeratedParticipant) {
        setModeratingPeerId(null);
      }
    },
    [hasModeratedParticipant, moderatingPeerId],
  );

  React.useEffect(
    () => {
      if (colorPickerPeerId && !hasColorPickerParticipant) {
        setColorPickerPeerId(null);
      }
    },
    [colorPickerPeerId, hasColorPickerParticipant],
  );

  React.useEffect(
    () => {
      setSelfNameDraft(collab?.selfParticipant?.displayName ?? collab?.displayName ?? "");
    },
    [collab?.displayName, collab?.selfParticipant?.displayName],
  );

  React.useEffect(
    () => {
      if (!isExpanded || activeInvitesCount === 0) {
        return undefined;
      }
      setNowMs(Date.now());
      const timer = setInterval(() => {
        setNowMs(Date.now());
      }, 1000);
      return () => clearInterval(timer);
    },
    [activeInvitesCount, isExpanded],
  );

  React.useEffect(
    () => {
      if (!copiedToken) {
        return undefined;
      }
      const timer = setTimeout(() => setCopiedToken(null), 1800);
      return () => clearTimeout(timer);
    },
    [copiedToken],
  );

  const panelErrorText = collab?.lastRejectionMessage ?? collab?.lastError?.message ?? null;
  const clearPanelError = collab?.clearError;

  React.useEffect(
    () => {
      if (!panelErrorText || !clearPanelError) {
        return undefined;
      }
      const timer = setTimeout(() => {
        clearPanelError();
      }, PANEL_ERROR_AUTO_DISMISS_MS);
      return () => clearTimeout(timer);
    },
    [clearPanelError, panelErrorText],
  );

  if (!collab || collab.isDisabled || !collab.isInSession) {
    return null;
  }

  const {
    participants,
    selfParticipant,
    raisedHandCount,
    isHost,
    activeInvites,
    activeSidecarUrl,
  } = collab;

  const isSelfNameLocked = Boolean(selfParticipant?.nameLocked && !isHost);
  const selfHandRaised = selfParticipant?.handRaised ?? false;
  const isLocalEditingLibrary = libraryContext?.isEditingLibrary ?? false;
  const isLocalSimulating = simulationContext?.isSimulating ?? false;
  const cursorVisibilityMode = resolveCollabCursorVisibilityMode(
    circuitContext?.appSettings?.collabCursorVisibilityMode,
  );
  const localCircuitName = circuitContext?.currentCircuit?.name ?? null;
  const circuitNamesById = new Map<string, string>(
    (circuitContext?.project?.logicalCircuits ?? []).map((circuit) => [circuit.logicalCircuitId, circuit.name]),
  );
  const pageHostname = typeof window !== "undefined" && window.location ? window.location.hostname : "";
  const isLocalhostSidecarActive =
    activeInvites.some((inv) => inv.isLocalhostSidecar) ||
    (activeSidecarUrl ? isLocalhostSidecarUrl(activeSidecarUrl) : isLoopbackHostname(pageHostname));

  const handleRenameSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (isSelfNameLocked) {
      return;
    }
    void collab.renameSelf(selfNameDraft);
  };

  const handleCopyInvite = (token: string, url: string) => {
    void copyToClipboard(url).then((ok) => {
      if (ok) {
        setCopiedToken(token);
      }
    });
  };

  const handleCreateInvite = async (role: "guest" | "collaborator") => {
    const created = await collab.createInviteLink(role);
    if (created) {
      handleCopyInvite(created.inviteToken, created.url);
    }
  };

  const handleRegenerateInvite = async (oldToken: string, role: "guest" | "collaborator") => {
    await collab.revokeInviteLink(oldToken);
    await handleCreateInvite(role);
  };

  const handleOpenModeration = (participant: CollabParticipant) => {
    if (moderatingPeerId === participant.peerId) {
      setModeratingPeerId(null);
      return;
    }
    setModeratingPeerId(participant.peerId);
    setModerateNameDraft(participant.displayName);
    setModerateNameLocked(participant.nameLocked);
  };

  const handleModerateSubmit = (event: React.FormEvent, targetPeerId: string) => {
    event.preventDefault();
    void collab.moderateParticipantName(targetPeerId, {
      displayName: moderateNameDraft,
      nameLocked: moderateNameLocked,
    }).then((ok) => {
      if (ok) {
        setModeratingPeerId(null);
      }
    });
  };

  return (
    <section
      {...other}
      data-component="CollabParticipantsPanel"
      data-expanded={isExpanded ? "true" : "false"}
      aria-label={t("collabPanel.title")}
    >
      <button
        type="button"
        className="panel-header-toggle"
        data-testid="collab-panel-toggle-btn"
        aria-expanded={isExpanded}
        aria-label={isExpanded ? t("collabPanel.collapseAriaLabel") : t("collabPanel.expandAriaLabel")}
        onClick={() => collab.setParticipantsPanelOpen(!isExpanded)}
      >
        <span className="header-left">
          <span className={`transport-dot ${collab.transportState}`} aria-hidden="true" />
          <span className="panel-title">{t("collabPanel.title")}</span>
        </span>
        <span className="header-summary" data-testid="collab-panel-collapsed-summary">
          <span className="count-pill">
            {t("collabPanel.participantCount", { count: participants.length })}
          </span>
          {raisedHandCount > 0 && (
            <span className="hand-summary-pill" data-testid="collab-panel-raised-hands-summary">
              ✋ {t("collabPanel.raisedHands", { count: raisedHandCount })}
            </span>
          )}
          <span className="chevron" aria-hidden="true">{isExpanded ? "▾" : "▴"}</span>
        </span>
      </button>

      {isExpanded && (
        <div className="panel-body">
          <div className="self-controls">
            <button
              type="button"
              className={`hand-btn${selfHandRaised ? " active" : ""}`}
              data-testid="collab-toggle-hand-btn"
              aria-pressed={selfHandRaised}
              onClick={() => void collab.toggleHandRaised()}
            >
              ✋ {selfHandRaised ? t("collabPanel.lowerHandButton") : t("collabPanel.raiseHandButton")}
            </button>

            <form className="self-name-form" onSubmit={handleRenameSubmit}>
              <input
                type="text"
                className="name-input"
                aria-label={t("collabPanel.selfNameLabel")}
                data-testid="collab-self-name-input"
                maxLength={MAX_COLLAB_DISPLAY_NAME_LENGTH}
                value={selfNameDraft}
                disabled={isSelfNameLocked}
                onChange={(event) => setSelfNameDraft(event.target.value)}
              />
              <button
                type="submit"
                className="mini-btn"
                data-testid="collab-self-name-save-btn"
                disabled={isSelfNameLocked}
              >
                {t("collabPanel.selfNameSaveButton")}
              </button>
            </form>

            {isSelfNameLocked && (
              <div className="locked-hint" data-testid="collab-name-locked-hint" role="status">
                {t("collabPanel.nameLockedHint")}
              </div>
            )}

            <div className="cursor-filter-row">
              <label htmlFor="collab-panel-cursor-visibility" className="cursor-filter-label">
                {t("collabPanel.presence.cursorVisibilityLabel")}
              </label>
              <select
                id="collab-panel-cursor-visibility"
                data-testid="collab-panel-cursor-visibility"
                className="cursor-filter-select"
                value={cursorVisibilityMode}
                onChange={(event) => {
                  circuitContext?.updateAppSettings({
                    collabCursorVisibilityMode: resolveCollabCursorVisibilityMode(event.target.value),
                  });
                }}
              >
                {COLLAB_CURSOR_VISIBILITY_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(getCursorVisibilityModeTranslationKey(mode))}
                  </option>
                ))}
              </select>
            </div>

            {panelErrorText && (
              <div className="panel-error" role="alert" data-testid="collab-panel-error">
                <span className="panel-error-text">{panelErrorText}</span>
                <button
                  type="button"
                  className="panel-error-close"
                  data-testid="collab-panel-error-close"
                  aria-label={t("common.close")}
                  onClick={() => collab.clearError()}
                >
                  ×
                </button>
              </div>
            )}
          </div>

          <ul className="participants-list" data-testid="collab-participants-list">
            {participants.map((participant) => {
              const participantColor = participant.isSelf
                ? null
                : (collab.getParticipantColor?.(participant.peerId, participant.displayName)
                  ?? pickAutoParticipantColor(new Set(), participant.displayName));
              const peerPresence = collab.presenceState?.peers[participant.peerId];
              const isPeerInLibrary = participant.isSelf
                ? isLocalEditingLibrary
                : Boolean(peerPresence?.inLibraryMode);
              const peerCircuitId = participant.isSelf
                ? (circuitContext?.currentCircuit?.logicalCircuitId ?? null)
                : (peerPresence?.logicalCircuitId ?? null);
              const peerCircuitLabel = isPeerInLibrary
                ? t("collabPanel.presence.inLibrary")
                : participant.isSelf
                  ? (localCircuitName ?? t("collabPanel.presence.unknownCircuit"))
                  : (peerCircuitId && circuitNamesById.get(peerCircuitId)) || t("collabPanel.presence.unknownCircuit");
              const canJump = Boolean(
                !participant.isSelf &&
                !isLocalEditingLibrary &&
                !isLocalSimulating &&
                !isPeerInLibrary &&
                peerCircuitId &&
                circuitNamesById.has(peerCircuitId),
              );
              const isFollowing = collab.followingPeerId === participant.peerId;
              const isColorPickerOpen = !participant.isSelf && colorPickerPeerId === participant.peerId;

              return (
                <li
                  key={participant.peerId}
                  className="participant-row"
                  data-testid={`collab-participant-${participant.peerId}`}
                  data-role={participant.role}
                >
                  <div className="participant-main">
                    {!participant.isSelf && participantColor && (
                      <button
                        type="button"
                        className="color-swatch-btn"
                        data-testid={`collab-color-btn-${participant.peerId}`}
                        data-color={participantColor}
                        style={{ backgroundColor: participantColor }}
                        title={t("collabPanel.presence.changeColorTooltip", { name: participant.displayName })}
                        aria-label={t("collabPanel.presence.changeColorTooltip", { name: participant.displayName })}
                        aria-expanded={isColorPickerOpen}
                        onClick={() =>
                          setColorPickerPeerId((prev) => (prev === participant.peerId ? null : participant.peerId))
                        }
                      />
                    )}
                    <span
                      className={`peer-dot ${participant.connectionState}`}
                      title={t(getConnectionStateTranslationKey(participant.connectionState))}
                      aria-hidden="true"
                    />
                    <span className="participant-name">{participant.displayName}</span>
                    {participant.isSelf && (
                      <span className="self-tag">({t("collabPanel.selfBadge")})</span>
                    )}
                    {participant.nameLocked && (
                      <span
                        className="lock-tag"
                        data-testid={`collab-name-locked-${participant.peerId}`}
                        title={t("collabPanel.nameLockedBadge")}
                      >
                        🔒
                      </span>
                    )}
                    <span className={`role-badge ${participant.role}`}>
                      {t(getRoleTranslationKey(participant.role))}
                    </span>
                    {participant.handRaised && (
                      <span
                        className="hand-badge"
                        data-testid="collab-hand-raised-badge"
                        title={t("collabPanel.handRaisedBadge")}
                      >
                        ✋
                      </span>
                    )}
                  </div>
                  <div className="participant-presence-row">
                    <span
                      className={`participant-circuit${isPeerInLibrary ? " is-library" : ""}`}
                      data-testid={`collab-participant-circuit-${participant.peerId}`}
                      data-in-library={isPeerInLibrary ? "true" : undefined}
                      title={peerCircuitLabel}
                    >
                      {peerCircuitLabel}
                    </span>
                    {!participant.isSelf && (
                      <div className="participant-nav-actions">
                        <button
                          type="button"
                          className="mini-btn"
                          data-testid={`collab-jump-${participant.peerId}`}
                          disabled={!canJump}
                          title={
                            isLocalSimulating
                              ? t("collabPanel.presence.disabledWhileSimulatingTooltip")
                              : t("collabPanel.presence.jumpTooltip", { name: participant.displayName })
                          }
                          onClick={() => collab.jumpToParticipant?.(participant.peerId)}
                        >
                          {t("collabPanel.presence.jumpButton")}
                        </button>
                        <button
                          type="button"
                          className={`mini-btn${isFollowing ? " primary" : ""}`}
                          data-testid={`collab-follow-${participant.peerId}`}
                          disabled={isLocalEditingLibrary || isLocalSimulating}
                          aria-pressed={isFollowing}
                          title={
                            isLocalSimulating
                              ? t("collabPanel.presence.disabledWhileSimulatingTooltip")
                              : undefined
                          }
                          onClick={() => {
                            if (isFollowing) {
                              collab.stopFollowingPeer?.();
                            } else {
                              collab.startFollowingPeer?.(participant.peerId);
                            }
                          }}
                        >
                          {isFollowing
                            ? t("collabPanel.presence.followingButton")
                            : t("collabPanel.presence.followButton")}
                        </button>
                      </div>
                    )}
                  </div>
                  {isColorPickerOpen && participantColor && (
                    <div
                      className="color-picker-popover"
                      data-testid={`collab-color-picker-${participant.peerId}`}
                      role="group"
                      aria-label={t("collabPanel.presence.colorPickerTitle", { name: participant.displayName })}
                    >
                      <div className="color-swatches-grid">
                        {COLLAB_PARTICIPANT_COLOR_PALETTE.map((swatch) => (
                          <button
                            key={swatch}
                            type="button"
                            className={`swatch-option${participantColor === swatch ? " active" : ""}`}
                            data-testid={`collab-color-preset-${participant.peerId}-${swatch.slice(1)}`}
                            style={{ backgroundColor: swatch }}
                            aria-label={swatch}
                            aria-pressed={participantColor === swatch}
                            onClick={() => {
                              collab.setParticipantColor?.(participant.peerId, swatch);
                              setColorPickerPeerId(null);
                            }}
                          />
                        ))}
                      </div>
                      <label className="custom-color-row">
                        <span>{t("collabPanel.presence.customColorLabel")}</span>
                        <input
                          type="color"
                          className="custom-color-input"
                          data-testid={`collab-color-input-${participant.peerId}`}
                          value={participantColor}
                          onChange={(event) => {
                            collab.setParticipantColor?.(participant.peerId, event.target.value);
                          }}
                        />
                      </label>
                    </div>
                  )}
                  {renderParticipantActions ? (
                    <div className="participant-actions">
                      {renderParticipantActions(participant)}
                    </div>
                  ) : (
                    isHost && !participant.isSelf && (
                      <div
                        className="participant-actions host-moderation-bar"
                        data-testid={`collab-host-actions-${participant.peerId}`}
                      >
                        <button
                          type="button"
                          className="mini-btn"
                          data-testid={`collab-toggle-role-${participant.peerId}`}
                          onClick={() => void collab.setParticipantRole(
                            participant.peerId,
                            participant.role === "guest" ? "collaborator" : "guest",
                          )}
                        >
                          {participant.role === "guest"
                            ? t("collabPanel.moderation.makeCollaborator")
                            : t("collabPanel.moderation.makeGuest")}
                        </button>
                        <button
                          type="button"
                          className="mini-btn"
                          data-testid={`collab-moderate-name-btn-${participant.peerId}`}
                          onClick={() => handleOpenModeration(participant)}
                        >
                          {t("collabPanel.moderation.editName")}
                        </button>
                        {participant.handRaised && (
                          <button
                            type="button"
                            className="mini-btn"
                            data-testid={`collab-lower-hand-${participant.peerId}`}
                            onClick={() => void collab.lowerParticipantHand(participant.peerId)}
                          >
                            {t("collabPanel.moderation.lowerHand")}
                          </button>
                        )}
                        {onRequestTransferHost && (
                          <button
                            type="button"
                            className="mini-btn"
                            data-testid={`collab-transfer-host-${participant.peerId}`}
                            onClick={() => onRequestTransferHost(participant)}
                          >
                            {t("collabPanel.moderation.transferHost")}
                          </button>
                        )}
                        <button
                          type="button"
                          className="mini-btn danger"
                          data-testid={`collab-kick-${participant.peerId}`}
                          onClick={() => void collab.kickParticipant(participant.peerId)}
                        >
                          {t("collabPanel.moderation.kick")}
                        </button>
                      </div>
                    )
                  )}
                  {isHost && moderatingPeerId === participant.peerId && (
                    <form
                      className="moderate-form"
                      data-testid={`collab-moderate-form-${participant.peerId}`}
                      onSubmit={(event) => handleModerateSubmit(event, participant.peerId)}
                    >
                      <input
                        type="text"
                        className="moderate-name-input"
                        aria-label={t("collabPanel.moderation.nameInputLabel", { name: participant.displayName })}
                        data-testid={`collab-moderate-name-input-${participant.peerId}`}
                        maxLength={MAX_COLLAB_DISPLAY_NAME_LENGTH}
                        value={moderateNameDraft}
                        onChange={(event) => setModerateNameDraft(event.target.value)}
                      />
                      <label className="moderate-lock-row" htmlFor={`collab-moderate-lock-${participant.peerId}`}>
                        <input
                          id={`collab-moderate-lock-${participant.peerId}`}
                          type="checkbox"
                          data-testid={`collab-moderate-lock-checkbox-${participant.peerId}`}
                          checked={moderateNameLocked}
                          onChange={(event) => setModerateNameLocked(event.target.checked)}
                        />
                        <span>{t("collabPanel.moderation.lockNameLabel")}</span>
                      </label>
                      <div className="moderate-actions">
                        <button
                          type="submit"
                          className="mini-btn primary"
                          data-testid={`collab-moderate-name-save-${participant.peerId}`}
                        >
                          {t("collabPanel.moderation.saveName")}
                        </button>
                        <button
                          type="button"
                          className="mini-btn"
                          data-testid={`collab-moderate-name-cancel-${participant.peerId}`}
                          onClick={() => setModeratingPeerId(null)}
                        >
                          {t("collabPanel.moderation.cancelEdit")}
                        </button>
                      </div>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>

          {isHost && (
            <div className="host-invites-section" data-testid="collab-host-invites-section">
              <div className="section-title">{t("collabPanel.invitesTitle")}</div>

              {isLocalhostSidecarActive && (
                <div className="localhost-warning" data-testid="collab-localhost-warning" role="status">
                  {t("collabPanel.localhostWarning")}
                </div>
              )}

              <div className="invite-create-row">
                <button
                  type="button"
                  className="mini-btn primary"
                  data-testid="collab-create-guest-invite-btn"
                  onClick={() => void handleCreateInvite("guest")}
                >
                  {t("collabPanel.createGuestInviteButton")}
                </button>
                <button
                  type="button"
                  className="mini-btn primary"
                  data-testid="collab-create-collab-invite-btn"
                  onClick={() => void handleCreateInvite("collaborator")}
                >
                  {t("collabPanel.createCollaboratorInviteButton")}
                </button>
              </div>

              {activeInvites.length > 0 && (
                <ul className="invites-list" data-testid="collab-active-invites-list">
                  {activeInvites.map((invite) => {
                    const remaining = formatRemainingTime(invite.expiresAt - nowMs);
                    const isCopied = copiedToken === invite.inviteToken;
                    return (
                      <li
                        key={invite.inviteToken}
                        className="invite-row"
                        data-testid={`collab-invite-${invite.inviteToken}`}
                      >
                        <div className="invite-meta">
                          <span className={`role-badge ${invite.role}`}>
                            {t(getRoleTranslationKey(invite.role))}
                          </span>
                          <span className="invite-ttl" data-testid={`collab-invite-ttl-${invite.inviteToken}`}>
                            {t("collabPanel.inviteExpiresIn", { remaining })}
                          </span>
                        </div>
                        <div className="invite-actions">
                          <button
                            type="button"
                            className="mini-btn"
                            data-testid={`collab-copy-invite-${invite.inviteToken}`}
                            onClick={() => handleCopyInvite(invite.inviteToken, invite.url)}
                          >
                            {isCopied ? t("collabPanel.copiedInviteButton") : t("collabPanel.copyInviteButton")}
                          </button>
                          <button
                            type="button"
                            className="mini-btn"
                            data-testid={`collab-regen-invite-${invite.inviteToken}`}
                            onClick={() => void handleRegenerateInvite(invite.inviteToken, invite.role)}
                          >
                            {t("collabPanel.regenerateInviteButton")}
                          </button>
                          <button
                            type="button"
                            className="mini-btn danger"
                            data-testid={`collab-revoke-invite-${invite.inviteToken}`}
                            onClick={() => void collab.revokeInviteLink(invite.inviteToken)}
                          >
                            {t("collabPanel.revokeInviteButton")}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          <div className="panel-footer">
            <button
              type="button"
              className="mini-btn danger"
              data-testid="collab-end-leave-btn"
              onClick={() => collab.endOrLeaveSession()}
            >
              {isHost ? t("collabPanel.endSessionButton") : t("collabPanel.leaveSessionButton")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
})({
  position: "absolute",
  right: "0.75rem",
  bottom: "0.75rem",
  zIndex: 450,
  display: "flex",
  flexDirection: "column",
  width: "22.5rem",
  maxWidth: "calc(100% - 1.5rem)",
  maxHeight: "calc(100% - 1.5rem)",
  backgroundColor: "var(--color-bg-surface)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.45rem",
  boxShadow: "0 0.65rem 1.75rem rgba(0, 0, 0, 0.52)",
  overflow: "hidden",
  color: "var(--color-text-primary)",
  fontSize: "0.8rem",

  "&[data-expanded=\"false\"]": {
    width: "auto",
    minWidth: "15rem",
  },

  "& > .panel-header-toggle": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.65rem",
    width: "100%",
    padding: "0.5rem 0.7rem",
    backgroundColor: "var(--color-bg-elevated)",
    border: "none",
    color: "var(--color-text-primary)",
    cursor: "pointer",
    textAlign: "left",

    "&:hover": {
      backgroundColor: "var(--color-surface-hover)",
    },

    "& > .header-left": {
      display: "flex",
      alignItems: "center",
      gap: "0.4rem",
      fontWeight: 600,

      "& > .transport-dot": {
        width: "0.5rem",
        height: "0.5rem",
        borderRadius: "50%",
        backgroundColor: "var(--color-text-muted)",

        "&.connected": {
          backgroundColor: "var(--color-status-running)",
        },

        "&.degraded, &.reconnecting, &.migrating-host, &.connecting": {
          backgroundColor: "var(--color-warning)",
        },

        "&.failed": {
          backgroundColor: "var(--color-status-stopped)",
        },
      },
    },

    "& > .header-summary": {
      display: "flex",
      alignItems: "center",
      gap: "0.4rem",
      fontSize: "0.74rem",
      color: "var(--color-text-secondary)",

      "& > .hand-summary-pill": {
        padding: "0.08rem 0.35rem",
        borderRadius: "0.25rem",
        backgroundColor: "var(--color-warning-bg)",
        border: "1px solid var(--color-warning-border)",
        color: "var(--color-warning)",
        fontWeight: 600,
      },
    },
  },

  "& > .panel-body": {
    display: "flex",
    flexDirection: "column",
    gap: "0.65rem",
    padding: "0.65rem 0.75rem",
    borderTop: "1px solid var(--color-border-subtle)",
    overflowY: "auto",

    "& > .self-controls": {
      display: "flex",
      flexDirection: "column",
      gap: "0.4rem",

      "& > .hand-btn": {
        padding: "0.38rem 0.65rem",
        borderRadius: "0.3rem",
        border: "1px solid var(--color-border-strong)",
        backgroundColor: "var(--color-bg-elevated)",
        color: "var(--color-text-primary)",
        fontSize: "0.78rem",
        fontWeight: 600,
        cursor: "pointer",

        "&.active": {
          backgroundColor: "var(--color-warning-bg-strong)",
          borderColor: "var(--color-warning-border)",
          color: "var(--color-warning)",
        },
      },

      "& > .self-name-form": {
        display: "flex",
        gap: "0.35rem",

        "& > .name-input": {
          flex: 1,
          minWidth: 0,
          padding: "0.3rem 0.5rem",
          borderRadius: "0.25rem",
          border: "1px solid var(--color-border-strong)",
          backgroundColor: "var(--color-bg-base)",
          color: "var(--color-text-primary)",
          fontSize: "0.78rem",

          "&:disabled": {
            opacity: 0.6,
            cursor: "not-allowed",
          },
        },
      },

      "& > .locked-hint": {
        fontSize: "0.72rem",
        color: "var(--color-warning)",
      },

      "& > .cursor-filter-row": {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.4rem",

        "& > .cursor-filter-label": {
          fontSize: "0.74rem",
          color: "var(--color-text-secondary)",
          whiteSpace: "nowrap",
        },

        "& > .cursor-filter-select": {
          flex: 1,
          minWidth: 0,
          padding: "0.24rem 0.4rem",
          borderRadius: "0.25rem",
          border: "1px solid var(--color-border-strong)",
          backgroundColor: "var(--color-bg-base)",
          color: "var(--color-text-primary)",
          fontSize: "0.74rem",
          cursor: "pointer",
        },
      },

      "& > .panel-error": {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "0.4rem",
        padding: "0.4rem 0.55rem",
        borderRadius: "0.25rem",
        backgroundColor: "var(--color-error-bg)",
        border: "1px solid var(--color-error-border)",
        color: "var(--color-error-text)",
        fontSize: "0.74rem",

        "& > .panel-error-text": {
          flex: 1,
          minWidth: 0,
        },

        "& > .panel-error-close": {
          flexShrink: 0,
          background: "transparent",
          border: "none",
          color: "inherit",
          fontSize: "0.95rem",
          lineHeight: 1,
          cursor: "pointer",
          padding: 0,
          opacity: 0.8,

          "&:hover": {
            opacity: 1,
          },
        },
      },
    },

    "& > .participants-list": {
      listStyle: "none",
      margin: 0,
      padding: 0,
      display: "flex",
      flexDirection: "column",
      gap: "0.35rem",

      "& > .participant-row": {
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
        padding: "0.38rem 0.5rem",
        borderRadius: "0.3rem",
        backgroundColor: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border-subtle)",

        "& > .participant-main": {
          display: "flex",
          alignItems: "center",
          gap: "0.35rem",
          flexWrap: "wrap",

          "& > .color-swatch-btn": {
            width: "0.75rem",
            height: "0.75rem",
            padding: 0,
            borderRadius: "50%",
            border: "1px solid rgba(255, 255, 255, 0.55)",
            cursor: "pointer",
            flexShrink: 0,

            "&:hover": {
              transform: "scale(1.15)",
            },
          },

          "& > .peer-dot": {
            width: "0.45rem",
            height: "0.45rem",
            borderRadius: "50%",
            backgroundColor: "var(--color-text-muted)",
            flexShrink: 0,

            "&.connected": {
              backgroundColor: "var(--color-status-running)",
            },

            "&.degraded, &.reconnecting, &.connecting": {
              backgroundColor: "var(--color-warning)",
            },

            "&.failed": {
              backgroundColor: "var(--color-status-stopped)",
            },
          },

          "& > .participant-name": {
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "9.5rem",
          },

          "& > .self-tag": {
            fontSize: "0.72rem",
            color: "var(--color-text-muted)",
          },

          "& > .hand-badge": {
            marginLeft: "auto",
            fontSize: "0.85rem",
          },
        },

        "& > .participant-presence-row": {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.35rem",

          "& > .participant-circuit": {
            flex: 1,
            minWidth: 0,
            fontSize: "0.71rem",
            color: "var(--color-text-secondary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",

            "&.is-library": {
              color: "var(--color-library-accent)",
              fontWeight: 600,
            },
          },

          "& > .participant-nav-actions": {
            display: "flex",
            gap: "0.25rem",
            flexShrink: 0,
          },
        },

        "& > .color-picker-popover": {
          display: "flex",
          flexDirection: "column",
          gap: "0.35rem",
          padding: "0.4rem 0.45rem",
          borderRadius: "0.25rem",
          backgroundColor: "var(--color-bg-base)",
          border: "1px solid var(--color-border-subtle)",

          "& > .color-swatches-grid": {
            display: "flex",
            flexWrap: "wrap",
            gap: "0.3rem",

            "& > .swatch-option": {
              width: "1.05rem",
              height: "1.05rem",
              padding: 0,
              borderRadius: "50%",
              border: "1px solid rgba(255, 255, 255, 0.3)",
              cursor: "pointer",

              "&.active": {
                outline: "0.125rem solid var(--color-text-primary)",
                outlineOffset: "1px",
              },
            },
          },

          "& > .custom-color-row": {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.4rem",
            fontSize: "0.72rem",
            color: "var(--color-text-secondary)",

            "& > .custom-color-input": {
              width: "2rem",
              height: "1.35rem",
              padding: 0,
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.2rem",
              background: "transparent",
              cursor: "pointer",
            },
          },
        },

        "& > .host-moderation-bar": {
          display: "flex",
          flexWrap: "wrap",
          gap: "0.28rem",
          paddingTop: "0.15rem",
        },

        "& > .moderate-form": {
          display: "flex",
          flexDirection: "column",
          gap: "0.35rem",
          marginTop: "0.2rem",
          padding: "0.4rem 0.45rem",
          borderRadius: "0.25rem",
          backgroundColor: "var(--color-bg-base)",
          border: "1px solid var(--color-border-subtle)",

          "& > .moderate-name-input": {
            padding: "0.28rem 0.45rem",
            borderRadius: "0.25rem",
            border: "1px solid var(--color-border-strong)",
            backgroundColor: "var(--color-bg-surface)",
            color: "var(--color-text-primary)",
            fontSize: "0.76rem",
          },

          "& > .moderate-lock-row": {
            display: "flex",
            alignItems: "center",
            gap: "0.35rem",
            fontSize: "0.72rem",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
          },

          "& > .moderate-actions": {
            display: "flex",
            gap: "0.3rem",
          },
        },
      },
    },

    "& > .host-invites-section": {
      display: "flex",
      flexDirection: "column",
      gap: "0.45rem",
      paddingTop: "0.45rem",
      borderTop: "1px solid var(--color-border-subtle)",

      "& > .section-title": {
        fontSize: "0.75rem",
        fontWeight: 700,
        color: "var(--color-text-secondary)",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
      },

      "& > .localhost-warning": {
        padding: "0.4rem 0.55rem",
        borderRadius: "0.25rem",
        backgroundColor: "var(--color-warning-bg)",
        border: "1px solid var(--color-warning-border)",
        color: "var(--color-warning)",
        fontSize: "0.73rem",
        lineHeight: 1.4,
      },

      "& > .invite-create-row": {
        display: "flex",
        gap: "0.35rem",
        flexWrap: "wrap",
      },

      "& > .invites-list": {
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",

        "& > .invite-row": {
          display: "flex",
          flexDirection: "column",
          gap: "0.3rem",
          padding: "0.4rem 0.5rem",
          borderRadius: "0.25rem",
          backgroundColor: "var(--color-bg-base)",
          border: "1px solid var(--color-border-subtle)",

          "& > .invite-meta": {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.4rem",

            "& > .invite-ttl": {
              fontFamily: "var(--font-family-mono)",
              fontSize: "0.72rem",
              color: "var(--color-text-secondary)",
            },
          },

          "& > .invite-actions": {
            display: "flex",
            gap: "0.3rem",
            flexWrap: "wrap",
          },
        },
      },
    },

    "& > .panel-footer": {
      display: "flex",
      justifyContent: "flex-end",
      paddingTop: "0.35rem",
      borderTop: "1px solid var(--color-border-subtle)",
    },
  },

  "& .role-badge": {
    padding: "0.08rem 0.35rem",
    borderRadius: "0.2rem",
    fontSize: "0.68rem",
    fontWeight: 600,
    backgroundColor: "var(--color-bg-surface)",
    border: "1px solid var(--color-border-subtle)",
    color: "var(--color-text-secondary)",

    "&.host": {
      backgroundColor: "var(--color-accent-primary-bg)",
      borderColor: "var(--color-accent-primary)",
      color: "var(--color-text-primary)",
    },

    "&.collaborator": {
      backgroundColor: "var(--color-info-bg)",
      borderColor: "var(--color-info-border)",
      color: "var(--color-text-primary)",
    },
  },

  "& .mini-btn": {
    padding: "0.25rem 0.5rem",
    borderRadius: "0.25rem",
    border: "1px solid var(--color-border-strong)",
    backgroundColor: "var(--color-bg-elevated)",
    color: "var(--color-text-primary)",
    fontSize: "0.73rem",
    fontWeight: 600,
    cursor: "pointer",

    "&:hover:not(:disabled)": {
      borderColor: "var(--color-accent-primary)",
    },

    "&:disabled": {
      opacity: 0.55,
      cursor: "not-allowed",
    },

    "&.primary": {
      backgroundColor: "var(--color-accent-primary)",
      borderColor: "var(--color-accent-primary)",
      color: "var(--color-text-on-accent)",
    },

    "&.danger": {
      borderColor: "var(--color-error-border)",
      backgroundColor: "var(--color-error-bg)",
      color: "var(--color-error-text)",
    },
  },
});

export default CollabParticipantsPanel;
