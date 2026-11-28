import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import CollabContext from "../../contexts/collabContext";

import type { CollabSessionClosedEvent, CollabSessionClosedReason } from "../../types/collab/sessionState";

export type SessionEndedDialogProps = Omit<React.ComponentPropsWithoutRef<"div">, "children"> & {
  noticeOverride?: CollabSessionClosedEvent | null;
  onDismissOverride?: () => void;
  isDisabledOverride?: boolean;
};

function resolveSessionEndedCopy(
  reason: CollabSessionClosedReason,
  t: TFunction,
): { title: string; body: string } {
  if (reason === "kicked") {
    return {
      title: t("collabSessionEndedDialog.kickedTitle"),
      body: t("collabSessionEndedDialog.kickedBody"),
    };
  }
  if (reason === "host-closed" || reason === "session-closed" || reason === "host-left") {
    return {
      title: t("collabSessionEndedDialog.hostClosedTitle"),
      body: t("collabSessionEndedDialog.hostClosedBody"),
    };
  }
  if (reason === "host-disconnected") {
    return {
      title: t("collabSessionEndedDialog.hostDisconnectedTitle"),
      body: t("collabSessionEndedDialog.hostDisconnectedBody"),
    };
  }
  return {
    title: t("collabSessionEndedDialog.genericTitle"),
    body: t("collabSessionEndedDialog.genericBody"),
  };
}

// Modale Benachrichtigung bei Beendigung einer Kollaborations-Session (Host-Ende, Kick oder Abbruch) inkl. Kopie-Hinweis
const SessionEndedDialog = styled(({
  noticeOverride,
  onDismissOverride,
  isDisabledOverride,
  ...other
}: SessionEndedDialogProps) => {
  const { t } = useTranslation();
  const collab = React.useContext(CollabContext);

  const isDisabled = isDisabledOverride ?? collab?.isDisabled ?? false;
  const notice = noticeOverride !== undefined
    ? noticeOverride
    : (collab?.sessionClosedNotice ?? null);

  const handleDismiss = React.useCallback(
    () => {
      collab?.dismissSessionClosedNotice();
      onDismissOverride?.();
    },
    [collab, onDismissOverride],
  );

  React.useEffect(
    () => {
      if (isDisabled || !notice) {
        return undefined;
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          handleDismiss();
        }
      };

      window.addEventListener("keydown", handleKeyDown, { capture: true });
      return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
    },
    [
      handleDismiss,
      isDisabled,
      notice,
    ],
  );

  if (isDisabled || !notice) {
    return null;
  }

  const copy = resolveSessionEndedCopy(notice.reason, t);

  const dialog = (
    <div
      {...other}
      data-component="SessionEndedDialog"
      data-reason={notice.reason}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          handleDismiss();
        }
      }}
    >
      <div
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="collab-session-ended-title"
      >
        <div className="dialog-header">
          <h2 id="collab-session-ended-title" className="dialog-title">
            {copy.title}
          </h2>
          <button
            type="button"
            className="close-btn"
            aria-label={t("common.close")}
            onClick={handleDismiss}
          >
            ×
          </button>
        </div>

        <div className="dialog-body">
          <p className="ended-body" data-testid="collab-ended-reason-body">
            {copy.body}
          </p>

          <div className="local-copy-box" data-testid="collab-ended-local-copy-note" role="status">
            <div className="notice-title">{t("collabSessionEndedDialog.localCopyTitle")}</div>
            <p className="notice-body">{t("collabSessionEndedDialog.localCopyBody")}</p>
          </div>
        </div>

        <div className="dialog-actions">
          <button
            type="button"
            className="primary-btn"
            data-testid="collab-ended-dismiss-btn"
            onClick={handleDismiss}
            autoFocus
          >
            {t("collabSessionEndedDialog.okButton")}
          </button>
        </div>
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
  zIndex: 1120,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "1rem",
  backgroundColor: "rgba(0, 0, 0, 0.62)",

  "& > .dialog-card": {
    width: "100%",
    maxWidth: "29rem",
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

      "& > .ended-body": {
        margin: 0,
        fontSize: "0.86rem",
        lineHeight: 1.5,
      },

      "& > .local-copy-box": {
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
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
      },
    },

    "& > .dialog-actions": {
      display: "flex",
      justifyContent: "flex-end",
      padding: "0.8rem 1.1rem",
      backgroundColor: "var(--color-bg-elevated)",
      borderTop: "1px solid var(--color-border-subtle)",

      "& > .primary-btn": {
        padding: "0.45rem 0.9rem",
        borderRadius: "0.3rem",
        backgroundColor: "var(--color-accent-primary)",
        border: "1px solid var(--color-accent-primary)",
        color: "var(--color-text-on-accent)",
        fontSize: "0.82rem",
        fontWeight: 600,
        cursor: "pointer",

        "&:hover": {
          backgroundColor: "var(--color-accent-primary-hover)",
        },
      },
    },
  },
});

export default SessionEndedDialog;
