import React from "react";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CollabContext from "../../contexts/collabContext";
import LibraryContext from "../../contexts/libraryContext";
import SimulationContext from "../../contexts/simulationContext";

import type CollabParticipant from "../../types/collab/sessionState";

import type { CollabUndoConflict } from "../../collab/collabUndoManager";
import type { ResyncConfirmationContext } from "../../collab/p2pSessionTransport";
import { pickAutoParticipantColor } from "../../utils/collabParticipantColors";

import CollabParticipantsPanel from "./collabParticipantsPanel";
import ConnectionDiagnosticsBanner from "./connectionDiagnosticsBanner";
import ResyncWarningDialog from "./resyncWarningDialog";
import TransferHostWarningDialog from "./transferHostWarningDialog";

const GUEST_READONLY_NOTICE_TIMEOUT_MS = 5000;

export type CollabWorkspaceOverlayProps = Omit<React.ComponentPropsWithoutRef<"div">, "children">;

type PendingResyncConfirm = {
  context: ResyncConfirmationContext;
  resolve: (confirmed: boolean) => void;
};

function formatUndoConflictMessage(
  conflict: CollabUndoConflict,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  switch (conflict.code) {
    case "spatial-collision":
      return t("collabSync.undoConflictSpatialCollision");
    case "entity-locked":
      return t("collabSync.undoConflictEntityLocked", {
        name: conflict.lockedByDisplayName ?? "?",
      });
    case "entity-modified":
      return t("collabSync.undoConflictEntityModified");
    case "wire-topology-conflict":
      return t("collabSync.undoConflictWireTopology");
    case "circuit-missing":
    case "entity-missing":
      return t("collabSync.undoConflictEntityMissing");
    default:
      return conflict.message || t("collabSync.undoConflictGeneric");
  }
}

// Schwebender Workspace-Container für Verbindungsdiagnose-/Sync-Banner (oben) und Teilnehmer-Panel (unten rechts)
const CollabWorkspaceOverlay = styled(({ ...other }: CollabWorkspaceOverlayProps) => {
  const { t } = useTranslation();
  const collab = React.useContext(CollabContext);
  const libraryContext = React.useContext(LibraryContext);
  const simulationContext = React.useContext(SimulationContext);
  const isEditingLibrary = libraryContext?.isEditingLibrary ?? false;
  const [dismissedKey, setDismissedKey] = React.useState<string | null>(null);
  const [isGuestBadgeDismissed, setIsGuestBadgeDismissed] = React.useState<boolean>(false);
  const [transferTarget, setTransferTarget] = React.useState<CollabParticipant | null>(null);
  const [pendingResyncConfirm, setPendingResyncConfirm] = React.useState<PendingResyncConfirm | null>(null);
  const pendingResyncRef = React.useRef<PendingResyncConfirm | null>(null);
  pendingResyncRef.current = pendingResyncConfirm;
  const registerResyncConfirmHandler = collab?.registerResyncConfirmHandler;

  const currentDiagKey = collab ? `${collab.transportState}:${collab.diagnostic.code}` : "";
  const transferTargetValid = Boolean(
    collab?.isHost &&
    transferTarget &&
    collab.participants.some((participant) => participant.peerId === transferTarget.peerId && !participant.isSelf),
  );

  React.useEffect(
    () => {
      if (dismissedKey && dismissedKey !== currentDiagKey) {
        setDismissedKey(null);
      }
    },
    [currentDiagKey, dismissedKey],
  );

  React.useEffect(
    () => {
      if (transferTarget && !transferTargetValid) {
        setTransferTarget(null);
      }
    },
    [transferTarget, transferTargetValid],
  );

  const isGuestRoleActive = Boolean(
    collab && !collab.isDisabled && collab.isInSession && collab.modelSyncState?.isReadOnlyForGuest,
  );

  React.useEffect(
    () => {
      if (!isGuestRoleActive) {
        setIsGuestBadgeDismissed(false);
        return undefined;
      }
      setIsGuestBadgeDismissed(false);
      const timer = setTimeout(() => {
        setIsGuestBadgeDismissed(true);
      }, GUEST_READONLY_NOTICE_TIMEOUT_MS);
      return () => clearTimeout(timer);
    },
    [isGuestRoleActive],
  );

  React.useEffect(
    () => {
      if (!registerResyncConfirmHandler || !collab?.isInSession) {
        return undefined;
      }
      registerResyncConfirmHandler(
        (context) =>
          new Promise<boolean>((resolve) => {
            if (pendingResyncRef.current) {
              pendingResyncRef.current.resolve(false);
            }
            setPendingResyncConfirm({ context, resolve });
          }),
      );
      return () => {
        registerResyncConfirmHandler(null);
        if (pendingResyncRef.current) {
          pendingResyncRef.current.resolve(false);
          setPendingResyncConfirm(null);
        }
      };
    },
    [collab?.isInSession, registerResyncConfirmHandler],
  );

  if (!collab || collab.isDisabled || !collab.isInSession) {
    return null;
  }

  const showDiagnosticsBanner = dismissedKey !== currentDiagKey;
  const showHostLoadingOverlay = Boolean(
    !collab.isHost &&
    collab.modelSyncState?.isQuiesced &&
    collab.modelSyncState.quiesceReason === "project-loading",
  );
  const showHandoverQuiesceBanner = Boolean(
    !collab.isHost &&
    collab.modelSyncState?.isQuiesced &&
    collab.modelSyncState.quiesceReason === "host-handover",
  );
  const syncRejection = collab.modelSyncState?.lastSyncRejection ?? null;
  const undoConflict = collab.modelSyncState?.lastUndoConflict ?? null;
  const softLockNotice = collab.softLockBlockedNotice ?? null;
  const showGuestReadOnlyBadge = Boolean(
    isGuestRoleActive && !isEditingLibrary && !isGuestBadgeDismissed,
  );
  const followingPeerId = collab.followingPeerId ?? null;
  const followedParticipant = followingPeerId
    ? collab.participants.find((participant) => participant.peerId === followingPeerId)
    : undefined;
  const followedDisplayName = followedParticipant?.displayName ?? followingPeerId ?? "";
  const followColor = followingPeerId
    ? (collab.getParticipantColor?.(followingPeerId, followedDisplayName)
      ?? pickAutoParticipantColor(new Set(), followedDisplayName))
    : undefined;
  const isCollabSnapshotSim = Boolean(
    collab &&
    !collab.isDisabled &&
    collab.isInSession &&
    !isEditingLibrary &&
    (simulationContext?.isSimulating || collab.modelSyncState?.isLocalSimulationBuffered),
  );
  const pendingSimDeltaCount = collab.modelSyncState?.pendingSimulationDeltaCount ?? 0;
  const hasPendingProjectSwitch = Boolean(collab.modelSyncState?.hasPendingProjectSwitchDuringSim);
  const requiresResyncAfterSim = Boolean(collab.modelSyncState?.requiresResyncAfterSimulation);
  const hasPendingSimUpdates = isCollabSnapshotSim && (
    pendingSimDeltaCount > 0 || hasPendingProjectSwitch || requiresResyncAfterSim
  );
  const snapshotBannerTitle = hasPendingProjectSwitch
    ? t("collabSync.snapshotSimProjectSwitchTitle")
    : requiresResyncAfterSim
      ? t("collabSync.snapshotSimResyncPendingTitle")
      : pendingSimDeltaCount > 0
        ? t("collabSync.snapshotSimUpdatesTitle", { count: pendingSimDeltaCount })
        : t("collabSync.snapshotSimActiveTitle");
  const snapshotBannerBody = hasPendingProjectSwitch
    ? t("collabSync.snapshotSimProjectSwitchBody")
    : requiresResyncAfterSim
      ? t("collabSync.snapshotSimResyncPendingBody")
      : pendingSimDeltaCount > 0
        ? t("collabSync.snapshotSimUpdatesBody")
        : t("collabSync.snapshotSimActiveBody");
  const hasAnyBanner =
    showDiagnosticsBanner ||
    showHostLoadingOverlay ||
    showHandoverQuiesceBanner ||
    syncRejection !== null ||
    undoConflict !== null ||
    softLockNotice !== null ||
    showGuestReadOnlyBadge ||
    Boolean(followingPeerId) ||
    isCollabSnapshotSim;

  return (
    <div {...other} data-component="CollabWorkspaceOverlay">
      {hasAnyBanner && (
        <div className="diagnostics-slot">
          {showHostLoadingOverlay && (
            <div
              className="host-loading-overlay"
              data-testid="collab-host-loading-overlay"
              role="status"
              aria-live="polite"
            >
              <span className="host-loading-dot" aria-hidden="true" />
              <div className="host-loading-text">
                <div className="host-loading-title">{t("collabSync.hostLoadingProjectTitle")}</div>
                <p className="host-loading-body">{t("collabSync.hostLoadingProjectBody")}</p>
              </div>
            </div>
          )}
          {showHandoverQuiesceBanner && (
            <div
              className="sync-feedback-banner is-warning"
              data-testid="collab-handover-quiesce-banner"
              role="status"
              aria-live="polite"
            >
              <div className="banner-content">
                <div className="banner-title">{t("collabSync.hostHandoverQuiesceTitle")}</div>
                <p className="banner-body">{t("collabSync.hostHandoverQuiesceBody")}</p>
              </div>
            </div>
          )}
          {syncRejection && (
            <div
              className="sync-feedback-banner is-error"
              data-testid="collab-sync-rejection-banner"
              role="alert"
            >
              <div className="banner-content">
                <div className="banner-title">{t("collabSync.syncRejectionTitle")}</div>
                <p className="banner-body">
                  {syncRejection.message || t("collabSync.syncRejectionFallback")}
                </p>
              </div>
              <button
                type="button"
                className="banner-close-btn"
                aria-label={t("common.close")}
                onClick={() => collab.clearSyncRejection?.()}
              >
                ×
              </button>
            </div>
          )}
          {undoConflict && (
            <div
              className="sync-feedback-banner is-warning"
              data-testid="collab-undo-conflict-banner"
              role="alert"
            >
              <div className="banner-content">
                <div className="banner-title">{t("collabSync.undoConflictTitle")}</div>
                <p className="banner-body">
                  {formatUndoConflictMessage(
                    undoConflict,
                    (key, options) => String(options ? t(key, options) : t(key)),
                  )}
                </p>
              </div>
              <button
                type="button"
                className="banner-close-btn"
                aria-label={t("common.close")}
                onClick={() => collab.clearUndoConflict?.()}
              >
                ×
              </button>
            </div>
          )}
          {softLockNotice && (
            <div
              className="sync-feedback-banner is-warning"
              data-testid="collab-soft-lock-notice-banner"
              role="status"
            >
              <div className="banner-content">
                <div className="banner-title">{t("collabSync.softLockBlockedTitle")}</div>
                <p className="banner-body">
                  {t("collabSync.softLockBlockedBody", { name: softLockNotice.ownerDisplayName })}
                </p>
              </div>
              <button
                type="button"
                className="banner-close-btn"
                aria-label={t("common.close")}
                onClick={() => collab.clearSoftLockBlockedNotice?.()}
              >
                ×
              </button>
            </div>
          )}
          {showGuestReadOnlyBadge && (
            <div
              className="sync-feedback-banner is-readonly"
              data-testid="collab-guest-readonly-badge"
              role="status"
            >
              <div className="banner-content">
                <div className="banner-title">{t("collabSync.guestReadOnlyBadgeTitle")}</div>
                <p className="banner-body">{t("collabSync.guestReadOnlyBadgeBody")}</p>
              </div>
              <button
                type="button"
                className="banner-close-btn"
                data-testid="collab-guest-readonly-close-btn"
                aria-label={t("common.close")}
                onClick={() => setIsGuestBadgeDismissed(true)}
              >
                ×
              </button>
            </div>
          )}
          {followingPeerId && (
            <div
              className="sync-feedback-banner is-following"
              data-testid="collab-follow-banner"
              data-following-peer-id={followingPeerId}
              data-color={followColor}
              style={followColor ? { borderLeft: `0.25rem solid ${followColor}` } : undefined}
              role="status"
            >
              <div className="banner-content">
                <div className="banner-title follow-title-row">
                  <span
                    className="follow-color-dot"
                    style={followColor ? { backgroundColor: followColor } : undefined}
                    aria-hidden="true"
                  />
                  <span>{t("collabPanel.presence.followingBanner", { name: followedDisplayName })}</span>
                </div>
              </div>
              <button
                type="button"
                className="follow-stop-btn"
                data-testid="collab-stop-following-btn"
                onClick={() => collab.stopFollowingPeer?.()}
              >
                {t("collabPanel.presence.stopFollowingButton")}
              </button>
            </div>
          )}
          {isCollabSnapshotSim && (
            <div
              className={`sync-feedback-banner is-snapshot-sim ${hasPendingSimUpdates ? "is-warning" : "is-readonly"}`}
              data-testid="collab-snapshot-sim-banner"
              data-has-pending-updates={hasPendingSimUpdates ? "true" : "false"}
              role="status"
              aria-live="polite"
            >
              <div className="banner-content">
                <div className="banner-title">{snapshotBannerTitle}</div>
                <p className="banner-body">{snapshotBannerBody}</p>
              </div>
              {hasPendingSimUpdates && (
                <button
                  type="button"
                  className="snapshot-stop-btn"
                  data-testid="collab-snapshot-sim-stop-btn"
                  onClick={() => {
                    void simulationContext?.stopSimulation();
                  }}
                >
                  {t("collabSync.snapshotSimStopAndApplyButton")}
                </button>
              )}
            </div>
          )}
          {showDiagnosticsBanner && (
            <ConnectionDiagnosticsBanner
              transportState={collab.transportState}
              diagnostic={collab.diagnostic}
              gracePeriodMs={collab.gracePeriodMs}
              onManualResync={!collab.isHost ? () => void collab.requestResync() : undefined}
              onDismiss={() => setDismissedKey(currentDiagKey)}
            />
          )}
        </div>
      )}
      <CollabParticipantsPanel
        onRequestTransferHost={(participant) => setTransferTarget(participant)}
      />
      <TransferHostWarningDialog
        isOpen={transferTarget !== null}
        targetParticipant={transferTarget}
        onConfirm={(targetPeerId) => {
          collab.transferHostRole(targetPeerId);
          setTransferTarget(null);
        }}
        onCancel={() => setTransferTarget(null)}
      />
      <ResyncWarningDialog
        isOpen={pendingResyncConfirm !== null}
        reason={pendingResyncConfirm?.context.reason ?? "manual"}
        unconfirmedLocalChangesCount={pendingResyncConfirm?.context.unconfirmedLocalChangesCount ?? 0}
        onConfirm={() => {
          const pending = pendingResyncConfirm;
          setPendingResyncConfirm(null);
          pending?.resolve(true);
        }}
        onCancel={() => {
          const pending = pendingResyncConfirm;
          setPendingResyncConfirm(null);
          pending?.resolve(false);
        }}
      />
    </div>
  );
})({
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  zIndex: 440,

  "& > *": {
    pointerEvents: "auto",
  },

  "& > .diagnostics-slot": {
    position: "absolute",
    top: "0.75rem",
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(36rem, calc(100% - 1.5rem))",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    zIndex: 460,

    "& > .host-loading-overlay": {
      display: "flex",
      alignItems: "flex-start",
      gap: "0.75rem",
      padding: "0.75rem 1rem",
      borderRadius: "0.45rem",
      backgroundColor: "var(--color-warning-bg)",
      border: "1px solid var(--color-warning-border)",
      boxShadow: "0 0.5rem 1.5rem rgba(0, 0, 0, 0.35)",
      color: "var(--color-text-primary)",

      "& > .host-loading-dot": {
        flexShrink: 0,
        width: "0.6rem",
        height: "0.6rem",
        marginTop: "0.3rem",
        borderRadius: "999px",
        backgroundColor: "var(--color-warning-border)",
      },

      "& > .host-loading-text": {
        display: "flex",
        flexDirection: "column",
        gap: "0.2rem",
        minWidth: 0,

        "& > .host-loading-title": {
          fontSize: "0.85rem",
          fontWeight: 700,
          color: "var(--color-text-primary)",
        },

        "& > .host-loading-body": {
          margin: 0,
          fontSize: "0.78rem",
          lineHeight: 1.4,
          color: "var(--color-text-secondary)",
        },
      },
    },

    "& > .sync-feedback-banner": {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: "0.75rem",
      padding: "0.6rem 0.9rem",
      borderRadius: "0.45rem",
      backgroundColor: "var(--color-bg-surface)",
      border: "1px solid var(--color-border-strong)",
      boxShadow: "0 0.4rem 1.25rem rgba(0, 0, 0, 0.35)",
      color: "var(--color-text-primary)",

      "&.is-warning": {
        backgroundColor: "var(--color-warning-bg)",
        borderColor: "var(--color-warning-border)",
      },

      "&.is-error": {
        backgroundColor: "var(--color-error-bg)",
        borderColor: "var(--color-status-stopped)",
      },

      "&.is-readonly": {
        backgroundColor: "var(--color-bg-elevated)",
        borderColor: "var(--color-border-strong)",
      },

      "&.is-following": {
        alignItems: "center",
        backgroundColor: "var(--color-bg-elevated)",
      },

      "& > .banner-content": {
        display: "flex",
        flexDirection: "column",
        gap: "0.15rem",
        minWidth: 0,

        "& > .banner-title": {
          fontSize: "0.8rem",
          fontWeight: 700,
          color: "var(--color-text-primary)",

          "&.follow-title-row": {
            display: "flex",
            alignItems: "center",
            gap: "0.45rem",

            "& > .follow-color-dot": {
              width: "0.6rem",
              height: "0.6rem",
              borderRadius: "50%",
              flexShrink: 0,
            },
          },
        },

        "& > .banner-body": {
          margin: 0,
          fontSize: "0.76rem",
          lineHeight: 1.35,
          color: "var(--color-text-secondary)",
        },
      },

      "& > .follow-stop-btn, & > .snapshot-stop-btn": {
        flexShrink: 0,
        padding: "0.25rem 0.6rem",
        borderRadius: "0.25rem",
        border: "1px solid var(--color-border-strong)",
        backgroundColor: "var(--color-bg-surface)",
        color: "var(--color-text-primary)",
        fontSize: "0.74rem",
        fontWeight: 600,
        cursor: "pointer",

        "&:hover": {
          borderColor: "var(--color-accent-primary)",
        },
      },

      "& > .banner-close-btn": {
        flexShrink: 0,
        background: "transparent",
        border: "none",
        color: "var(--color-text-secondary)",
        fontSize: "1rem",
        lineHeight: 1,
        cursor: "pointer",
        padding: "0.1rem 0.25rem",
        borderRadius: "0.25rem",

        "&:hover": {
          color: "var(--color-text-primary)",
          backgroundColor: "var(--color-surface-hover)",
        },
      },
    },
  },
});

export default CollabWorkspaceOverlay;
