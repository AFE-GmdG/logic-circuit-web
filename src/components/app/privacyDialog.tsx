import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import { isMcpDisabledByEnv } from "../../hooks/useMcpBridge";

import type PrivacyConfig from "../../types/privacyConfig";

import { isCollabDisabledByEnv } from "../../utils/collabIceConfig";
import {
  fetchRuntimePrivacyConfig,
  getBuildPrivacyConfig,
  mergePrivacyConfig,
} from "../../utils/privacyConfig";
import { isCustomSidecarRequired } from "../../utils/sidecarStorage";

export const OPEN_PRIVACY_DIALOG_EVENT = "logic-circuit:open-privacy-dialog";

export type PrivacyDialogProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  initialConfig?: Partial<PrivacyConfig>;
  onClose: () => void;
};

// Minimaler DSGVO-/Datenschutz-Dialog mit über Umgebungsvariablen steuerbaren Betreiberangaben
const PrivacyDialog = styled(({
  isOpen,
  initialConfig,
  onClose,
  ...other
}: PrivacyDialogProps) => {
  const { t } = useTranslation();
  const mcpDisabled = isMcpDisabledByEnv();
  const collabDisabled = isCollabDisabledByEnv();
  const isStaticCustomOnly = isCustomSidecarRequired();
  const baseConfig = React.useMemo(
    () => mergePrivacyConfig(getBuildPrivacyConfig(), initialConfig),
    [initialConfig],
  );
  const [config, setConfig] = React.useState<PrivacyConfig>(baseConfig);

  React.useEffect(
    () => {
      setConfig(baseConfig);
    },
    [baseConfig],
  );

  React.useEffect(
    () => {
      if (!isOpen) {
        return;
      }

      const controller = new AbortController();
      if (!mcpDisabled) {
        void fetchRuntimePrivacyConfig(controller.signal).then((runtimeConfig) => {
          if (runtimeConfig && !controller.signal.aborted) {
            setConfig((prev) => mergePrivacyConfig(prev, runtimeConfig));
          }
        });
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      };

      window.addEventListener("keydown", handleKeyDown, { capture: true });
      return () => {
        controller.abort();
        window.removeEventListener("keydown", handleKeyDown, { capture: true });
      };
    },
    [
      isOpen,
      mcpDisabled,
      onClose,
    ],
  );

  if (!isOpen) {
    return null;
  }

  const hasOperatorDetails =
    config.responsibleName.length > 0 ||
    config.responsibleAddress.length > 0 ||
    config.contactEmail.length > 0;

  const modalContent = (
    <div
      {...other}
      data-component="PrivacyDialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-card">
        <div className="modal-header">
          <h2 id="privacy-dialog-title" className="modal-title">{t("dialog.privacy.title")}</h2>
          <button
            type="button"
            className="close-btn"
            aria-label={t("common.closeDialog")}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <section className="privacy-section">
            <h3 className="section-title">{t("dialog.privacy.operatorSection")}</h3>
            {hasOperatorDetails ? (
              <div className="operator-card">
                {config.responsibleName && <div><strong>{config.responsibleName}</strong></div>}
                {config.responsibleAddress && <div>{config.responsibleAddress}</div>}
                {config.contactEmail && (
                  <div>
                    {t("dialog.privacy.emailLabel")}{" "}
                    <a href={`mailto:${config.contactEmail}`}>
                      {config.contactEmail}
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <p className="privacy-text">
                {t("dialog.privacy.noOperatorBody")}
              </p>
            )}
          </section>

          <section className="privacy-section">
            <h3 className="section-title">{t("dialog.privacy.processingSection")}</h3>
            <ul className="privacy-list">
              <li>
                <strong>{t("dialog.privacy.localTitle")}</strong>{" "}
                {t("dialog.privacy.localBodyBeforeCode")}{" "}
                <code>localStorage</code>{" "}
                {t("dialog.privacy.localBodyAfterCode")}
              </li>
              <li>
                <strong>{t("dialog.privacy.cookiesTitle")}</strong>{" "}
                {t("dialog.privacy.cookiesBody")}
              </li>
              {!mcpDisabled && (
                <li>
                  <strong>{t("dialog.privacy.remoteMcpTitle")}</strong>{" "}
                  {t("dialog.privacy.remoteMcpBody")}
                </li>
              )}
              {!collabDisabled && (
                <li data-testid="privacy-webrtc-section">
                  <strong>{t("dialog.privacy.webrtcCollabTitle")}</strong>{" "}
                  {t("dialog.privacy.webrtcCollabBody")}
                </li>
              )}
              <li>
                <strong>{t("dialog.privacy.hostingTitle")}</strong>{" "}
                {config.hostingLocation || t(mcpDisabled || isStaticCustomOnly ? "dialog.privacy.hostingStaticDefault" : "dialog.privacy.hostingDefault")}
              </li>
            </ul>
          </section>

          <section className="privacy-section">
            <h3 className="section-title">{t("dialog.privacy.rightsSection")}</h3>
            <p className="privacy-text">
              {t("dialog.privacy.rightsBody")}
            </p>
          </section>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onClose}
            autoFocus={true}
          >
            {t("common.close")}
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
    maxWidth: "36rem",
    maxHeight: "85vh",
    backgroundColor: "var(--color-bg-surface)",
    border: "1px solid var(--color-border-strong)",
    borderRadius: "0.5rem",
    boxShadow: "0 1.25rem 3rem rgba(0, 0, 0, 0.6)",
    color: "var(--color-text-primary)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",

    "& > .modal-header": {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0.9rem 1.25rem",
      borderBottom: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-bg-elevated)",

      "& > .modal-title": {
        margin: 0,
        fontSize: "1rem",
        fontWeight: 600,
        color: "var(--color-text-primary)",
      },

      "& > .close-btn": {
        background: "transparent",
        border: "none",
        color: "var(--color-text-secondary)",
        fontSize: "1rem",
        cursor: "pointer",
        padding: "0.2rem 0.45rem",
        borderRadius: "0.25rem",

        "&:hover": {
          color: "var(--color-text-primary)",
          backgroundColor: "var(--color-bg-surface)",
        },
      },
    },

    "& > .modal-body": {
      padding: "1.15rem 1.25rem",
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      gap: "1rem",

      "& > .privacy-section": {
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",

        "& > .section-title": {
          margin: 0,
          fontSize: "0.82rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--color-accent-primary)",
          borderBottom: "1px solid var(--color-border-subtle)",
          paddingBottom: "0.3rem",
        },

        "& > .operator-card": {
          display: "flex",
          flexDirection: "column",
          gap: "0.2rem",
          padding: "0.65rem 0.85rem",
          borderRadius: "0.35rem",
          backgroundColor: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border-subtle)",
          fontSize: "0.85rem",
          lineHeight: 1.5,
          color: "var(--color-text-primary)",

          "& a": {
            color: "var(--color-accent-primary)",
            textDecoration: "underline",

            "&:hover": {
              color: "var(--color-accent-primary-hover)",
            },
          },
        },

        "& > .privacy-list": {
          margin: 0,
          paddingLeft: "1.2rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.45rem",
          fontSize: "0.84rem",
          lineHeight: 1.5,
          color: "var(--color-text-secondary)",

          "& strong": {
            color: "var(--color-text-primary)",
          },

          "& code": {
            fontFamily: "var(--font-family-mono)",
            fontSize: "0.78rem",
            backgroundColor: "var(--color-bg-elevated)",
            padding: "0.05rem 0.3rem",
            borderRadius: "0.2rem",
            color: "var(--color-text-primary)",
          },
        },

        "& > .privacy-text": {
          margin: 0,
          fontSize: "0.84rem",
          lineHeight: 1.55,
          color: "var(--color-text-secondary)",

          "& code": {
            fontFamily: "var(--font-family-mono)",
            fontSize: "0.78rem",
            backgroundColor: "var(--color-bg-elevated)",
            padding: "0.05rem 0.3rem",
            borderRadius: "0.2rem",
            color: "var(--color-text-primary)",
          },
        },
      },
    },

    "& > .modal-footer": {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      padding: "0.85rem 1.25rem",
      borderTop: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-bg-elevated)",

      "& > .btn": {
        padding: "0.45rem 1rem",
        borderRadius: "0.3rem",
        fontSize: "0.85rem",
        fontWeight: 600,
        cursor: "pointer",
        border: "1px solid transparent",

        "&.btn-primary": {
          backgroundColor: "var(--color-accent-primary)",
          color: "var(--color-text-on-accent)",

          "&:hover": {
            backgroundColor: "var(--color-accent-primary-hover)",
          },
        },
      },
    },
  },
});

export default PrivacyDialog;
