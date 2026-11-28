import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type CollabParticipant from "../../types/collab/sessionState";

import { getRoleTranslationKey } from "./collabParticipantsPanel";

export type TransferHostWarningDialogProps = Omit<React.ComponentPropsWithoutRef<"div">, "children"> & {
  isOpen: boolean;
  targetParticipant: CollabParticipant | null;
  onConfirm: (targetPeerId: string) => void;
  onCancel: () => void;
};

function getTargetSummaryText(
  participant: CollabParticipant,
  t: TFunction,
): string {
  return t("collabTransferHostDialog.targetSummary", {
    name: participant.displayName,
    role: t(getRoleTranslationKey(participant.role)),
  });
}

// Expliziter Warnungs- und Bestätigungsdialog vor Übertragung der Host-Rolle gegen versehentliche Einzelklicks
const TransferHostWarningDialog = styled(({
  isOpen,
  targetParticipant,
  onConfirm,
  onCancel,
  ...other
}: TransferHostWarningDialogProps) => {
  const { t } = useTranslation();

  React.useEffect(
    () => {
      if (!isOpen || !targetParticipant) {
        return undefined;
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
    [
      isOpen,
      onCancel,
      targetParticipant,
    ],
  );

  if (!isOpen || !targetParticipant) {
    return null;
  }

  const isGuestTarget = targetParticipant.role === "guest";

  const dialog = (
    <div
      {...other}
      data-component="TransferHostWarningDialog"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        className="dialog-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="collab-transfer-host-title"
      >
        <div className="dialog-header">
          <h2 id="collab-transfer-host-title" className="dialog-title">
            {t("collabTransferHostDialog.title")}
          </h2>
          <button
            type="button"
            className="close-btn"
            aria-label={t("common.close")}
            onClick={onCancel}
          >
            ×
          </button>
        </div>

        <div className="dialog-body">
          <p className="summary-text" data-testid="collab-transfer-target-summary">
            {getTargetSummaryText(targetParticipant, t)}
          </p>

          {isGuestTarget && (
            <div className="guest-warning" data-testid="collab-transfer-guest-warning" role="status">
              <div className="warning-title">{t("collabTransferHostDialog.guestWarningTitle")}</div>
              <p className="warning-body">
                {t("collabTransferHostDialog.guestWarningBody", { name: targetParticipant.displayName })}
              </p>
            </div>
          )}

          <div className="consequences-box" data-testid="collab-transfer-consequences">
            <div className="consequences-title">{t("collabTransferHostDialog.consequencesTitle")}</div>
            <ul className="consequences-list">
              <li>{t("collabTransferHostDialog.consequencesDemote")}</li>
              <li>{t("collabTransferHostDialog.consequencesMcp")}</li>
              <li>{t("collabTransferHostDialog.consequencesPreserve")}</li>
            </ul>
          </div>
        </div>

        <div className="dialog-actions">
          <button
            type="button"
            className="secondary-btn"
            data-testid="collab-transfer-cancel-btn"
            onClick={onCancel}
            autoFocus
          >
            {t("collabTransferHostDialog.cancelButton")}
          </button>
          <button
            type="button"
            className="danger-btn"
            data-testid="collab-transfer-confirm-btn"
            onClick={() => onConfirm(targetParticipant.peerId)}
          >
            {t("collabTransferHostDialog.confirmButton")}
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
  backgroundColor: "rgba(0, 0, 0, 0.65)",

  "& > .dialog-card": {
    width: "100%",
    maxWidth: "31rem",
    backgroundColor: "var(--color-bg-surface)",
    border: "1px solid var(--color-warning-border)",
    borderRadius: "0.5rem",
    boxShadow: "0 1rem 2.5rem rgba(0, 0, 0, 0.62)",
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
        color: "var(--color-warning)",
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

      "& > .summary-text": {
        margin: 0,
        fontSize: "0.88rem",
        lineHeight: 1.5,
      },

      "& > .guest-warning": {
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
        padding: "0.65rem 0.8rem",
        borderRadius: "0.35rem",
        backgroundColor: "var(--color-warning-bg-strong)",
        border: "1px solid var(--color-warning-border)",
        fontSize: "0.8rem",
        lineHeight: 1.45,

        "& > .warning-title": {
          fontWeight: 700,
          color: "var(--color-warning)",
        },

        "& > .warning-body": {
          margin: 0,
          color: "var(--color-text-primary)",
        },
      },

      "& > .consequences-box": {
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",
        padding: "0.65rem 0.8rem",
        borderRadius: "0.35rem",
        backgroundColor: "var(--color-bg-base)",
        border: "1px solid var(--color-border-subtle)",
        fontSize: "0.8rem",
        lineHeight: 1.45,

        "& > .consequences-title": {
          fontWeight: 600,
          color: "var(--color-text-primary)",
        },

        "& > .consequences-list": {
          margin: 0,
          paddingLeft: "1.1rem",
          color: "var(--color-text-secondary)",
          display: "flex",
          flexDirection: "column",
          gap: "0.25rem",
        },
      },
    },

    "& > .dialog-actions": {
      display: "flex",
      justifyContent: "flex-end",
      gap: "0.55rem",
      padding: "0.8rem 1.1rem",
      backgroundColor: "var(--color-bg-elevated)",
      borderTop: "1px solid var(--color-border-subtle)",

      "& > .secondary-btn, & > .danger-btn": {
        padding: "0.45rem 0.85rem",
        borderRadius: "0.3rem",
        fontSize: "0.82rem",
        fontWeight: 600,
        cursor: "pointer",
      },

      "& > .secondary-btn": {
        backgroundColor: "var(--color-bg-surface)",
        border: "1px solid var(--color-border-strong)",
        color: "var(--color-text-primary)",

        "&:hover": {
          borderColor: "var(--color-accent-primary)",
        },
      },

      "& > .danger-btn": {
        backgroundColor: "var(--color-error-bg)",
        border: "1px solid var(--color-error-border)",
        color: "var(--color-error-text)",

        "&:hover": {
          filter: "brightness(1.1)",
        },
      },
    },
  },
});

export default TransferHostWarningDialog;
