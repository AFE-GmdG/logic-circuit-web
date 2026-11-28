import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import type { CollabResyncReason } from "../../types/collab/dataChannelMessage";

export type ResyncWarningDialogProps = Omit<React.ComponentPropsWithoutRef<"div">, "children"> & {
  isOpen: boolean;
  reason: CollabResyncReason;
  unconfirmedLocalChangesCount: number;
  onConfirm: () => void;
  onCancel: () => void;
};

function getReasonLabelKey(reason: CollabResyncReason): string {
  switch (reason) {
    case "reconnected":
      return "dialog.resyncWarning.reasonReconnected";
    case "revision-gap":
      return "dialog.resyncWarning.reasonRevisionGap";
    case "conflict":
      return "dialog.resyncWarning.reasonConflict";
    case "manual":
    default:
      return "dialog.resyncWarning.reasonManual";
  }
}

// Modaler Warnungsdialog vor dem Verwerfen unbestätigter lokaler Änderungen beim Host-Resync
const ResyncWarningDialog = styled(({
  isOpen,
  reason,
  unconfirmedLocalChangesCount,
  onConfirm,
  onCancel,
  ...other
}: ResyncWarningDialogProps) => {
  const { t } = useTranslation();

  React.useEffect(
    () => {
      if (!isOpen) {
        return;
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      };

      window.addEventListener("keydown", handleKeyDown, { capture: true });
      return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
    },
    [isOpen, onCancel],
  );

  if (!isOpen) {
    return null;
  }

  const safeCount = Math.max(0, Math.floor(unconfirmedLocalChangesCount));

  const modalContent = (
    <div
      {...other}
      data-component="ResyncWarningDialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="resync-warning-dialog-title"
      aria-describedby="resync-warning-dialog-message"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="modal-card">
        <div className="modal-header">
          <h2 id="resync-warning-dialog-title" className="modal-title">
            {t("dialog.resyncWarning.title")}
          </h2>
          <button
            type="button"
            className="close-btn"
            aria-label={t("common.close")}
            onClick={onCancel}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p className="resync-reason" data-testid="resync-warning-reason">
            {t("dialog.resyncWarning.reasonLabel", { reason: t(getReasonLabelKey(reason)) })}
          </p>
          <p id="resync-warning-dialog-message" className="resync-message">
            {t("dialog.resyncWarning.message")}
          </p>
          {safeCount > 0 && (
            <div className="unconfirmed-box" data-testid="resync-unconfirmed-count">
              {t("dialog.resyncWarning.unconfirmedChanges", { count: safeCount })}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            data-testid="resync-confirm-btn"
            onClick={onConfirm}
            autoFocus={true}
          >
            {t("dialog.resyncWarning.confirmButton")}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document !== "undefined" && document.body) {
    return ReactDOM.createPortal(modalContent, document.body);
  }

  return modalContent;
})({
  position: "fixed",
  inset: 0,
  zIndex: 1120,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "rgba(0, 0, 0, 0.65)",
  padding: "1rem",

  "& > .modal-card": {
    width: "100%",
    maxWidth: "30rem",
    backgroundColor: "var(--color-bg-surface)",
    border: "1px solid var(--color-border-strong)",
    borderRadius: "0.5rem",
    boxShadow: "0 1rem 2.5rem rgba(0, 0, 0, 0.55)",
    color: "var(--color-text-primary)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",

    "& > .modal-header": {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0.85rem 1.15rem",
      borderBottom: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-bg-elevated)",

      "& > .modal-title": {
        margin: 0,
        fontSize: "0.95rem",
        fontWeight: 600,
        color: "var(--color-text-primary)",
      },

      "& > .close-btn": {
        background: "transparent",
        border: "none",
        color: "var(--color-text-secondary)",
        fontSize: "1rem",
        cursor: "pointer",
        padding: "0.2rem 0.4rem",
        borderRadius: "0.25rem",

        "&:hover": {
          color: "var(--color-text-primary)",
          backgroundColor: "var(--color-bg-surface)",
        },
      },
    },

    "& > .modal-body": {
      padding: "1.15rem",
      display: "flex",
      flexDirection: "column",
      gap: "0.75rem",

      "& > .resync-reason": {
        margin: 0,
        fontSize: "0.8rem",
        fontWeight: 600,
        color: "var(--color-text-primary)",
      },

      "& > .resync-message": {
        margin: 0,
        fontSize: "0.85rem",
        lineHeight: 1.5,
        color: "var(--color-text-secondary)",
      },

      "& > .unconfirmed-box": {
        padding: "0.6rem 0.75rem",
        borderRadius: "0.35rem",
        border: "1px solid var(--color-warning-border)",
        backgroundColor: "var(--color-warning-bg)",
        color: "var(--color-text-primary)",
        fontSize: "0.8125rem",
        fontWeight: 600,
      },
    },

    "& > .modal-footer": {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: "0.6rem",
      padding: "0.85rem 1.15rem",
      borderTop: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-bg-elevated)",

      "& > .btn": {
        padding: "0.45rem 0.9rem",
        borderRadius: "0.3rem",
        fontSize: "0.85rem",
        fontWeight: 500,
        cursor: "pointer",
        border: "1px solid transparent",
        transition: "all 0.12s ease",

        "&.btn-secondary": {
          backgroundColor: "var(--color-bg-surface)",
          color: "var(--color-text-primary)",
          borderColor: "var(--color-border-strong)",

          "&:hover": {
            backgroundColor: "var(--color-bg-base)",
          },
        },

        "&.btn-danger": {
          backgroundColor: "var(--color-status-stopped)",
          color: "var(--color-text-on-strong)",
          fontWeight: 600,

          "&:hover": {
            filter: "brightness(1.1)",
          },
        },
      },
    },
  },
});

export default ResyncWarningDialog;
