import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import CollabContext, { type CollabContextType } from "../../contexts/collabContext";

import { MAX_COLLAB_DISPLAY_NAME_LENGTH, normalizeDisplayName } from "../../collab/collabAuthorization";
import type { CollabSessionError } from "../../utils/collabIceConfig";
import { loadCollabDisplayName } from "../../utils/collabStorage";
import { loadSidecarBaseUrl } from "../../utils/sidecarStorage";

import { OPEN_OPTIONS_DIALOG_EVENT } from "../app/optionsDialog";
import { OPEN_PRIVACY_DIALOG_EVENT } from "../app/privacyDialog";

export const OPEN_START_COLLAB_DIALOG_EVENT = "logic-circuit:open-start-collab-dialog";
export const OPEN_JOIN_COLLAB_DIALOG_EVENT = "logic-circuit:open-join-collab-dialog";

export type StartCollabSessionDialogProps = Omit<React.ComponentPropsWithoutRef<"div">, "children"> & {
  isOpen: boolean;
  onClose: () => void;
  onOpenPrivacy?: () => void;
  onOpenByoSidecar?: () => void;
  collabOverride?: CollabContextType;
  initialErrorOverride?: CollabSessionError | null;
  customSidecarRequiredOverride?: boolean;
};

function resolveCollabErrorMessage(
  error: CollabSessionError,
  t: TFunction,
): string {
  if (error.code === "rate-limited") {
    return error.retryAfterSeconds !== undefined
      ? t("collabStartDialog.rateLimitedError", { seconds: error.retryAfterSeconds })
      : t("collabStartDialog.rateLimitedErrorGeneric");
  }
  if (error.code === "service-unavailable") {
    return t("collabStartDialog.serviceUnavailableError");
  }
  if (error.code === "invalid-display-name") {
    return t("collabStartDialog.displayNameRequiredError");
  }
  return error.message;
}

// Modaler Dialog zum Starten einer Kollaborations-Session (Pflicht-Anzeigename, GDPR-Hinweis & BYO-SideCar-Führung)
const StartCollabSessionDialog = styled(({
  isOpen,
  onClose,
  onOpenPrivacy,
  onOpenByoSidecar,
  collabOverride,
  initialErrorOverride,
  customSidecarRequiredOverride,
  ...other
}: StartCollabSessionDialogProps) => {
  const { t } = useTranslation();
  const liveCollab = React.useContext(CollabContext);
  const collab = collabOverride ?? liveCollab;

  const initialDisplayName = collabOverride
    ? (collabOverride.displayName || loadCollabDisplayName())
    : loadCollabDisplayName();
  const [displayNameInput, setDisplayNameInput] = React.useState(
    () => initialDisplayName,
  );
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [isStarting, setIsStarting] = React.useState(false);
  const initialDisplayNameRef = React.useRef(initialDisplayName);
  initialDisplayNameRef.current = initialDisplayName;

  // Übernimmt den gespeicherten Namen ausschließlich beim Öffnen, damit laufende Eingaben bei Re-Renders erhalten bleiben
  React.useEffect(
    () => {
      if (!isOpen) {
        setValidationError(null);
        setIsStarting(false);
        return;
      }
      setDisplayNameInput(initialDisplayNameRef.current);
    },
    [isOpen],
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
  const isCustomSidecarRequired = customSidecarRequiredOverride ?? collab?.customSidecarRequired ?? false;
  const hasStoredSidecarUrl = loadSidecarBaseUrl().trim().length > 0;
  const needsSidecarSetup =
    effectiveError?.code === "sidecar-required" ||
    effectiveError?.code === "invalid-sidecar-url" ||
    effectiveError?.code === "forbidden" ||
    effectiveError?.requiresSidecarSetup === true ||
    (isCustomSidecarRequired && !hasStoredSidecarUrl);
  const needsAccessKeySetup =
    effectiveError?.code === "unauthorized" ||
    effectiveError?.requiresAccessKey === true;

  const handleOpenPrivacy = () => {
    if (onOpenPrivacy) {
      onOpenPrivacy();
      return;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(OPEN_PRIVACY_DIALOG_EVENT));
    }
  };

  const handleOpenByoSidecar = () => {
    onClose();
    if (onOpenByoSidecar) {
      onOpenByoSidecar();
      return;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(OPEN_OPTIONS_DIALOG_EVENT, { detail: { tab: "sidecar" } }));
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = normalizeDisplayName(displayNameInput);
    if (!normalized.valid) {
      setValidationError(t("collabStartDialog.displayNameRequiredError"));
      return;
    }
    if (!collab) {
      return;
    }

    setValidationError(null);
    setIsStarting(true);
    try {
      const ok = await collab.startHostSession({
        displayName: normalized.displayName,
      });
      if (ok) {
        onClose();
      }
    } finally {
      setIsStarting(false);
    }
  };

  const dialog = (
    <div
      {...other}
      data-component="StartCollabSessionDialog"
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
        aria-labelledby="collab-start-dialog-title"
      >
        <div className="dialog-header">
          <h2 id="collab-start-dialog-title" className="dialog-title">
            {t("collabStartDialog.title")}
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

        <form className="dialog-body" onSubmit={(event) => void handleSubmit(event)}>
          <p className="dialog-description">
            {t("collabStartDialog.description")}
          </p>

          <label className="field-label" htmlFor="collab-start-display-name">
            {t("collabStartDialog.displayNameLabel")}
          </label>
          <input
            id="collab-start-display-name"
            type="text"
            className="text-input"
            data-testid="collab-start-display-name-input"
            maxLength={MAX_COLLAB_DISPLAY_NAME_LENGTH}
            placeholder={t("collabStartDialog.displayNamePlaceholder")}
            value={displayNameInput}
            onChange={(event) => {
              setDisplayNameInput(event.target.value);
              if (validationError) {
                setValidationError(null);
              }
            }}
            autoFocus
          />

          <div className="privacy-notice" data-testid="collab-start-privacy-notice">
            <div className="notice-title">{t("collabStartDialog.privacyTitle")}</div>
            <p className="notice-body">{t("collabStartDialog.privacyBody")}</p>
            <button
              type="button"
              className="link-btn"
              data-testid="collab-start-open-privacy-btn"
              onClick={handleOpenPrivacy}
            >
              {t("collabStartDialog.openPrivacyButton")}
            </button>
          </div>

          {(needsSidecarSetup || needsAccessKeySetup) && (
            <div className="sidecar-guidance" data-testid="collab-start-sidecar-guidance" role="status">
              <div className="guidance-title">
                {needsAccessKeySetup
                  ? t("collabStartDialog.accessKeyRequiredTitle")
                  : t("collabStartDialog.sidecarRequiredTitle")}
              </div>
              <p className="guidance-body">
                {needsAccessKeySetup
                  ? t("collabStartDialog.accessKeyRequiredBody")
                  : t("collabStartDialog.sidecarRequiredBody")}
              </p>
              <button
                type="button"
                className="secondary-btn"
                data-testid="collab-start-open-byo-sidecar-btn"
                onClick={handleOpenByoSidecar}
              >
                {t("collabStartDialog.openByoSidecarButton")}
              </button>
            </div>
          )}

          {(validationError || effectiveError) && (
            <div className="error-box" role="alert" data-testid="collab-start-error-box">
              {validationError ?? resolveCollabErrorMessage(effectiveError!, t)}
            </div>
          )}

          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={onClose}
            >
              {t("collabStartDialog.cancelButton")}
            </button>
            <button
              type="submit"
              className="primary-btn"
              data-testid="collab-start-submit-btn"
              disabled={isStarting}
            >
              {isStarting ? t("collabStartDialog.startingButton") : t("collabStartDialog.startButton")}
            </button>
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
    maxWidth: "30rem",
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

      "& > .dialog-description": {
        margin: 0,
        fontSize: "0.84rem",
        lineHeight: 1.45,
        color: "var(--color-text-secondary)",
      },

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
        fontSize: "0.88rem",

        "&:focus": {
          outline: "none",
          borderColor: "var(--color-accent-primary)",
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

      "& > .sidecar-guidance": {
        display: "flex",
        flexDirection: "column",
        gap: "0.4rem",
        padding: "0.65rem 0.8rem",
        borderRadius: "0.35rem",
        backgroundColor: "var(--color-warning-bg)",
        border: "1px solid var(--color-warning-border)",
        fontSize: "0.78rem",
        lineHeight: 1.45,

        "& > .guidance-title": {
          fontWeight: 600,
          color: "var(--color-warning)",
        },

        "& > .guidance-body": {
          margin: 0,
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
        justifyContent: "flex-end",
        gap: "0.55rem",
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
  },

  "& .primary-btn": {
    backgroundColor: "var(--color-accent-primary)",
    border: "1px solid var(--color-accent-primary)",
    color: "var(--color-text-on-accent)",

    "&:hover:not(:disabled)": {
      backgroundColor: "var(--color-accent-primary-hover)",
    },

    "&:disabled": {
      opacity: 0.6,
      cursor: "not-allowed",
    },
  },

  "& .secondary-btn": {
    alignSelf: "flex-start",
    backgroundColor: "var(--color-bg-elevated)",
    border: "1px solid var(--color-border-strong)",
    color: "var(--color-text-primary)",

    "&:hover": {
      borderColor: "var(--color-accent-primary)",
    },
  },
});

export default StartCollabSessionDialog;
