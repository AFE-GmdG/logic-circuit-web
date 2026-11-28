import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import CollabContext, { type CollabContextType } from "../../contexts/collabContext";

import type { ParsedCollabInviteLink } from "../../types/collab/sessionState";

import { MAX_COLLAB_DISPLAY_NAME_LENGTH, normalizeDisplayName } from "../../collab/collabAuthorization";
import type { CollabSessionError } from "../../utils/collabIceConfig";
import { parseCollabInviteLink } from "../../utils/collabInviteLink";
import { loadCollabDisplayName } from "../../utils/collabStorage";

import { OPEN_PRIVACY_DIALOG_EVENT } from "../app/privacyDialog";

export type JoinCollabSessionDialogProps = Omit<React.ComponentPropsWithoutRef<"div">, "children"> & {
  isOpen: boolean;
  onClose: () => void;
  onOpenPrivacy?: () => void;
  onSaveProjectBeforeJoin?: () => Promise<boolean>;
  hasUnsavedChanges?: boolean;
  collabOverride?: CollabContextType;
  pendingInviteOverride?: ParsedCollabInviteLink | null;
  initialErrorOverride?: CollabSessionError | null;
};

function extractSidecarHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).host;
  } catch {
    return rawUrl;
  }
}

export function resolveJoinCollabErrorMessage(
  error: CollabSessionError,
  t: TFunction,
): string {
  switch (error.code) {
    case "invite-expired":
      return t("collabJoinDialog.errorInviteExpired");
    case "invite-revoked":
      return t("collabJoinDialog.errorInviteRevoked");
    case "invite-invalid":
      return t("collabJoinDialog.errorInviteInvalid");
    case "session-not-found":
      return t("collabJoinDialog.errorSessionNotFound");
    case "peer-limit-reached":
      return t("collabJoinDialog.errorPeerLimitReached");
    case "rate-limited":
      return error.retryAfterSeconds !== undefined
        ? t("collabJoinDialog.errorRateLimited", { seconds: error.retryAfterSeconds })
        : t("collabJoinDialog.errorRateLimitedGeneric");
    case "service-unavailable":
      return t("collabJoinDialog.errorServiceUnavailable");
    case "sidecar-required":
    case "invalid-sidecar-url":
    case "forbidden":
      return t("collabJoinDialog.errorSidecarRequired");
    case "invalid-display-name":
      return t("collabJoinDialog.displayNameRequiredError");
    case "network-error":
      return t("collabJoinDialog.errorNetwork");
    case "timeout":
      return t("collabJoinDialog.errorTimeout");
    default:
      return error.message;
  }
}

// Modaler Dialog zum direkten Beitritt per Einladungslink (GDPR-Hinweis, Custom-Sidecar-Opt-in & Speicher-Rückfrage)
const JoinCollabSessionDialog = styled(({
  isOpen,
  onClose,
  onOpenPrivacy,
  onSaveProjectBeforeJoin,
  hasUnsavedChanges = false,
  collabOverride,
  pendingInviteOverride,
  initialErrorOverride,
  ...other
}: JoinCollabSessionDialogProps) => {
  const { t } = useTranslation();
  const liveCollab = React.useContext(CollabContext);
  const collab = collabOverride ?? liveCollab;

  const effectivePendingInvite = pendingInviteOverride !== undefined
    ? pendingInviteOverride
    : (collab?.pendingInviteLink ?? null);

  const initialDisplayName = collabOverride
    ? (collabOverride.displayName || loadCollabDisplayName())
    : loadCollabDisplayName();

  const [displayNameInput, setDisplayNameInput] = React.useState(
    () => initialDisplayName,
  );
  const [inviteInput, setInviteInput] = React.useState("");
  const [remoteSidecarConfirmed, setRemoteSidecarConfirmed] = React.useState(false);
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isJoining, setIsJoining] = React.useState(false);

  const initialDisplayNameRef = React.useRef(initialDisplayName);
  initialDisplayNameRef.current = initialDisplayName;

  // Zustand ausschließlich beim Öffnen/Schließen zurücksetzen, damit Tippen bei PrivacyDialog-Wechseln erhalten bleibt
  React.useEffect(
    () => {
      if (!isOpen) {
        setInviteInput("");
        setRemoteSidecarConfirmed(false);
        setValidationError(null);
        setIsSaving(false);
        setIsJoining(false);
        return;
      }
      setDisplayNameInput(initialDisplayNameRef.current);
      setRemoteSidecarConfirmed(false);
      setValidationError(null);
    },
    [isOpen],
  );

  const parsedInvite = effectivePendingInvite
    ?? (inviteInput.trim().length > 0
      ? parseCollabInviteLink(inviteInput, typeof window !== "undefined" ? window.location : undefined)
      : null);

  const detectedSidecarUrl = parsedInvite?.sidecarUrl ?? "";
  React.useEffect(
    () => {
      setRemoteSidecarConfirmed(false);
    },
    [detectedSidecarUrl],
  );

  React.useEffect(
    () => {
      if (!isOpen) {
        return undefined;
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          if (typeof document !== "undefined" && document.querySelector("[data-component='PrivacyDialog']")) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      };

      window.addEventListener("keydown", handleKeyDown, { capture: true });
      return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
    },
    [isOpen, onClose],
  );

  if (!isOpen || collab?.isDisabled) {
    return null;
  }

  const effectiveError = initialErrorOverride !== undefined
    ? initialErrorOverride
    : (collab?.lastError ?? null);

  const handleOpenPrivacy = () => {
    if (onOpenPrivacy) {
      onOpenPrivacy();
      return;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(OPEN_PRIVACY_DIALOG_EVENT));
    }
  };

  const executeJoin = async (saveFirst: boolean) => {
    const normalizedName = normalizeDisplayName(displayNameInput);
    if (!normalizedName.valid) {
      setValidationError(t("collabJoinDialog.displayNameRequiredError"));
      return;
    }

    if (!effectivePendingInvite && inviteInput.trim().length === 0) {
      setValidationError(t("collabJoinDialog.inviteLinkRequiredError"));
      return;
    }

    if (!parsedInvite) {
      setValidationError(t("collabJoinDialog.inviteLinkInvalidError"));
      return;
    }

    if (parsedInvite.sidecarError) {
      setValidationError(parsedInvite.sidecarError);
      return;
    }

    if (parsedInvite.isRemoteSidecar && !remoteSidecarConfirmed) {
      setValidationError(t("collabJoinDialog.remoteSidecarConfirmRequiredError"));
      return;
    }

    if (!collab) {
      return;
    }

    setValidationError(null);

    if (saveFirst && onSaveProjectBeforeJoin) {
      setIsSaving(true);
      try {
        const saved = await onSaveProjectBeforeJoin();
        if (!saved) {
          return;
        }
      } finally {
        setIsSaving(false);
      }
    }

    setIsJoining(true);
    try {
      const ok = await collab.joinSession({
        inviteToken: parsedInvite.inviteToken,
        displayName: normalizedName.displayName,
        ...(parsedInvite.sidecarUrl
          ? { sidecarBaseUrl: parsedInvite.sidecarUrl, isEphemeralSidecar: true }
          : {}),
      });
      if (ok) {
        onClose();
      }
    } finally {
      setIsJoining(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void executeJoin(hasUnsavedChanges);
  };

  const remoteSidecarHost = parsedInvite?.isRemoteSidecar && parsedInvite.sidecarUrl
    ? extractSidecarHost(parsedInvite.sidecarUrl)
    : null;
  const displayedError = validationError
    ?? parsedInvite?.sidecarError
    ?? (effectiveError ? resolveJoinCollabErrorMessage(effectiveError, t) : null);
  const isBusy = isSaving || isJoining;

  const dialog = (
    <div
      {...other}
      data-component="JoinCollabSessionDialog"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="collab-join-dialog-title"
      >
        <div className="dialog-header">
          <h2 id="collab-join-dialog-title" className="dialog-title">
            {t("collabJoinDialog.title")}
          </h2>
          <button
            type="button"
            className="close-btn"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <form className="dialog-body" onSubmit={handleSubmit}>
          <p className="dialog-description">
            {t("collabJoinDialog.description")}
          </p>

          {effectivePendingInvite ? (
            <div className="detected-invite-banner" data-testid="collab-join-detected-invite">
              {t("collabJoinDialog.detectedInviteNotice")}
            </div>
          ) : (
            <div className="field-group">
              <label className="field-label" htmlFor="collab-join-link-input">
                {t("collabJoinDialog.inviteLinkLabel")}
              </label>
              <input
                id="collab-join-link-input"
                type="text"
                className="text-input"
                data-testid="collab-join-link-input"
                placeholder={t("collabJoinDialog.inviteLinkPlaceholder")}
                value={inviteInput}
                onChange={(event) => {
                  setInviteInput(event.target.value);
                  if (validationError) {
                    setValidationError(null);
                  }
                }}
              />
            </div>
          )}

          <div className="field-group">
            <label className="field-label" htmlFor="collab-join-display-name">
              {t("collabJoinDialog.displayNameLabel")}
            </label>
            <input
              id="collab-join-display-name"
              type="text"
              className="text-input"
              data-testid="collab-join-display-name-input"
              maxLength={MAX_COLLAB_DISPLAY_NAME_LENGTH}
              placeholder={t("collabJoinDialog.displayNamePlaceholder")}
              value={displayNameInput}
              onChange={(event) => {
                setDisplayNameInput(event.target.value);
                if (validationError) {
                  setValidationError(null);
                }
              }}
              autoFocus
            />
          </div>

          <div className="privacy-notice" data-testid="collab-join-privacy-notice">
            <div className="notice-title">{t("collabJoinDialog.privacyTitle")}</div>
            <p className="notice-body">{t("collabJoinDialog.privacyBody")}</p>
            <button
              type="button"
              className="link-btn"
              data-testid="collab-join-open-privacy-btn"
              onClick={handleOpenPrivacy}
            >
              {t("collabJoinDialog.openPrivacyButton")}
            </button>
          </div>

          {remoteSidecarHost && (
            <div className="warning-notice" data-testid="collab-join-remote-sidecar-box" role="status">
              <div className="notice-title">{t("collabJoinDialog.remoteSidecarTitle")}</div>
              <p className="notice-body">
                {t("collabJoinDialog.remoteSidecarBody", { host: remoteSidecarHost })}
              </p>
              <p className="notice-body">{t("collabJoinDialog.remoteSidecarEphemeralNote")}</p>
              <label className="checkbox-label" htmlFor="collab-join-confirm-sidecar">
                <input
                  id="collab-join-confirm-sidecar"
                  type="checkbox"
                  data-testid="collab-join-confirm-sidecar-checkbox"
                  checked={remoteSidecarConfirmed}
                  onChange={(event) => {
                    setRemoteSidecarConfirmed(event.target.checked);
                    if (validationError) {
                      setValidationError(null);
                    }
                  }}
                />
                <span>{t("collabJoinDialog.remoteSidecarConfirmLabel", { host: remoteSidecarHost })}</span>
              </label>
            </div>
          )}

          {hasUnsavedChanges && (
            <div className="unsaved-notice" data-testid="collab-join-unsaved-warning" role="status">
              <div className="notice-title">{t("collabJoinDialog.unsavedTitle")}</div>
              <p className="notice-body">{t("collabJoinDialog.unsavedBody")}</p>
            </div>
          )}

          {displayedError && (
            <div
              className="error-box"
              role="alert"
              data-testid={parsedInvite?.sidecarError ? "collab-join-sidecar-error" : "collab-join-error-box"}
            >
              {displayedError}
            </div>
          )}

          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-btn"
              data-testid="collab-join-cancel-btn"
              onClick={onClose}
              disabled={isBusy}
            >
              {t("collabJoinDialog.cancelButton")}
            </button>

            {hasUnsavedChanges ? (
              <>
                <button
                  type="button"
                  className="secondary-btn"
                  data-testid="collab-join-without-save-btn"
                  onClick={() => void executeJoin(false)}
                  disabled={isBusy}
                >
                  {isJoining ? t("collabJoinDialog.joiningButton") : t("collabJoinDialog.joinWithoutSavingButton")}
                </button>
                <button
                  type="submit"
                  className="primary-btn"
                  data-testid="collab-join-save-and-join-btn"
                  disabled={isBusy}
                >
                  {isSaving
                    ? t("collabJoinDialog.savingButton")
                    : isJoining
                      ? t("collabJoinDialog.joiningButton")
                      : t("collabJoinDialog.saveAndJoinButton")}
                </button>
              </>
            ) : (
              <button
                type="submit"
                className="primary-btn"
                data-testid="collab-join-submit-btn"
                disabled={isBusy}
              >
                {isJoining ? t("collabJoinDialog.joiningButton") : t("collabJoinDialog.joinButton")}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );

  if (typeof document !== "undefined") {
    return ReactDOM.createPortal(dialog, document.body);
  }
  return dialog;
})({
  position: "fixed",
  inset: 0,
  zIndex: 1100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "1rem",
  backgroundColor: "rgba(0, 0, 0, 0.62)",

  "& > .dialog-card": {
    width: "100%",
    maxWidth: "32rem",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: "var(--color-bg-surface)",
    border: "1px solid var(--color-border-strong)",
    borderRadius: "0.5rem",
    boxShadow: "0 1rem 2.5rem rgba(0, 0, 0, 0.6)",
    color: "var(--color-text-primary)",
    overflow: "hidden",

    "& > .dialog-header": {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0.85rem 1.1rem",
      backgroundColor: "var(--color-bg-elevated)",
      borderBottom: "1px solid var(--color-border-subtle)",

      "& > .dialog-title": {
        margin: 0,
        fontSize: "1rem",
        fontWeight: 600,
      },

      "& > .close-btn": {
        background: "transparent",
        border: "none",
        color: "var(--color-text-secondary)",
        fontSize: "1.25rem",
        lineHeight: 1,
        cursor: "pointer",
        padding: "0.15rem 0.35rem",
        borderRadius: "0.25rem",

        "&:hover": {
          color: "var(--color-text-primary)",
          backgroundColor: "var(--color-surface-hover)",
        },
      },
    },

    "& > .dialog-body": {
      display: "flex",
      flexDirection: "column",
      gap: "0.75rem",
      padding: "1rem 1.1rem",
      overflowY: "auto",

      "& > .dialog-description": {
        margin: 0,
        fontSize: "0.84rem",
        lineHeight: 1.45,
        color: "var(--color-text-secondary)",
      },

      "& > .detected-invite-banner": {
        padding: "0.55rem 0.75rem",
        borderRadius: "0.3rem",
        backgroundColor: "var(--color-accent-primary-bg)",
        border: "1px solid var(--color-accent-primary)",
        fontSize: "0.8rem",
        lineHeight: 1.4,
      },

      "& > .field-group": {
        display: "flex",
        flexDirection: "column",
        gap: "0.3rem",

        "& > .field-label": {
          fontSize: "0.82rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        },

        "& > .text-input": {
          padding: "0.5rem 0.65rem",
          backgroundColor: "var(--color-bg-base)",
          border: "1px solid var(--color-border-strong)",
          borderRadius: "0.3rem",
          color: "var(--color-text-primary)",
          fontSize: "0.86rem",

          "&:focus": {
            outline: "none",
            borderColor: "var(--color-accent-primary)",
          },
        },
      },

      "& > .privacy-notice": {
        display: "flex",
        flexDirection: "column",
        gap: "0.3rem",
        padding: "0.65rem 0.8rem",
        borderRadius: "0.35rem",
        backgroundColor: "var(--color-info-bg)",
        border: "1px solid var(--color-info-border)",
        fontSize: "0.78rem",
        lineHeight: 1.45,

        "& > .notice-title": {
          fontWeight: 600,
          color: "var(--color-text-primary)",
        },

        "& > .notice-body": {
          margin: 0,
          color: "var(--color-text-secondary)",
        },

        "& > .link-btn": {
          alignSelf: "flex-start",
          padding: 0,
          background: "transparent",
          border: "none",
          color: "var(--color-accent-primary)",
          fontSize: "0.78rem",
          fontWeight: 600,
          cursor: "pointer",
          textDecoration: "underline",

          "&:hover": {
            color: "var(--color-accent-primary-hover)",
          },
        },
      },

      "& > .warning-notice, & > .unsaved-notice": {
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",
        padding: "0.65rem 0.8rem",
        borderRadius: "0.35rem",
        backgroundColor: "var(--color-warning-bg)",
        border: "1px solid var(--color-warning-border)",
        fontSize: "0.78rem",
        lineHeight: 1.45,

        "& > .notice-title": {
          fontWeight: 600,
          color: "var(--color-warning)",
        },

        "& > .notice-body": {
          margin: 0,
          color: "var(--color-text-primary)",
        },

        "& > .checkbox-label": {
          display: "flex",
          alignItems: "flex-start",
          gap: "0.45rem",
          marginTop: "0.15rem",
          cursor: "pointer",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        },
      },

      "& > .error-box": {
        padding: "0.55rem 0.75rem",
        borderRadius: "0.3rem",
        backgroundColor: "var(--color-error-bg)",
        border: "1px solid var(--color-error-border)",
        color: "var(--color-error-text)",
        fontSize: "0.8rem",
        lineHeight: 1.4,
      },

      "& > .dialog-actions": {
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "flex-end",
        gap: "0.5rem",
        marginTop: "0.25rem",
      },
    },
  },

  "& .primary-btn, & .secondary-btn": {
    padding: "0.45rem 0.85rem",
    borderRadius: "0.3rem",
    fontSize: "0.82rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s ease",

    "&:disabled": {
      opacity: 0.6,
      cursor: "not-allowed",
    },
  },

  "& .primary-btn": {
    backgroundColor: "var(--color-accent-primary)",
    border: "1px solid var(--color-accent-primary)",
    color: "var(--color-text-on-accent)",

    "&:hover:not(:disabled)": {
      backgroundColor: "var(--color-accent-primary-hover)",
    },
  },

  "& .secondary-btn": {
    backgroundColor: "var(--color-bg-elevated)",
    border: "1px solid var(--color-border-strong)",
    color: "var(--color-text-primary)",

    "&:hover:not(:disabled)": {
      borderColor: "var(--color-accent-primary)",
    },
  },
});

export default JoinCollabSessionDialog;
