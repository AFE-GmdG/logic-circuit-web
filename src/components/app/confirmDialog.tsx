import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

export type ConfirmDialogProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  title: string;
  message: string;
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  isDanger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// Bestätigungsdialog für destruktive oder unwiderrufliche Aktionen
const ConfirmDialog = styled(({
  isOpen,
  title,
  message,
  details,
  confirmLabel,
  cancelLabel,
  isDanger = false,
  onConfirm,
  onCancel,
  ...other
}: ConfirmDialogProps) => {
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

  const resolvedConfirmLabel = confirmLabel ?? t("common.confirm");
  const resolvedCancelLabel = cancelLabel ?? t("common.cancel");

  const modalContent = (
    <div
      {...other}
      data-component="ConfirmDialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className={details && details.length > 0 ? "modal-card has-details" : "modal-card"}>
        <div className="modal-header">
          <h2 id="confirm-dialog-title" className="modal-title">{title}</h2>
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
          <p id="confirm-dialog-message" className="confirm-message">{message}</p>
          {details && details.length > 0 && (
            <ul className="confirm-details" data-testid="confirm-dialog-details">
              {details.map((item, idx) => (
                <li key={`${idx}-${item}`}>{item}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
          >
            {resolvedCancelLabel}
          </button>
          <button
            type="button"
            className={isDanger ? "btn btn-danger" : "btn btn-primary"}
            onClick={onConfirm}
            autoFocus={true}
          >
            {resolvedConfirmLabel}
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
  zIndex: 1100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "rgba(0, 0, 0, 0.65)",
  padding: "1rem",

  "& > .modal-card": {
    width: "100%",
    maxWidth: "26rem",
    backgroundColor: "var(--color-bg-surface)",
    border: "1px solid var(--color-border-strong)",
    borderRadius: "0.5rem",
    boxShadow: "0 1rem 2.5rem rgba(0, 0, 0, 0.55)",
    color: "var(--color-text-primary)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",

    "&.has-details": {
      maxWidth: "34rem",
    },

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

      "& > .confirm-message": {
        margin: 0,
        fontSize: "0.875rem",
        lineHeight: 1.5,
        color: "var(--color-text-secondary)",
      },

      "& > .confirm-details": {
        margin: "0.75rem 0 0",
        padding: "0.65rem 0.85rem 0.65rem 1.6rem",
        maxHeight: "14rem",
        overflowY: "auto",
        borderRadius: "0.35rem",
        border: "1px solid var(--color-warning-border)",
        backgroundColor: "var(--color-warning-bg)",
        color: "var(--color-text-primary)",
        fontSize: "0.8125rem",
        lineHeight: 1.45,
        display: "flex",
        flexDirection: "column",
        gap: "0.4rem",
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

        "&.btn-primary": {
          backgroundColor: "var(--color-accent-primary)",
          color: "var(--color-text-on-accent)",
          fontWeight: 600,

          "&:hover": {
            backgroundColor: "var(--color-accent-primary-hover)",
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

export default ConfirmDialog;
