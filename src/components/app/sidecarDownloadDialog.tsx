import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import { getClientVersion } from "../../utils/sidecarVersion";

export const OPEN_SIDECAR_DOWNLOAD_EVENT = "logic-circuit:open-sidecar-download";

export type SidecarDownloadDialogProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  onOpenByoSidecar?: () => void;
  onClose: () => void;
};

type CopyTarget = "node" | "docker" | null;

const DOWNLOAD_ARCHIVE_PATH = "./downloads/logic-circuit-sidecar.zip";

const NODE_QUICKSTART_COMMAND = [
  "cp .env.example .env",
  "# Linux / macOS:",
  "./start.sh",
  "# Windows:",
  "start.bat",
  "# Direkt ohne Wrapper:",
  "node --experimental-strip-types server/standaloneServer.ts",
].join("\n");

const DOCKER_QUICKSTART_COMMAND = [
  "cp .env.example .env",
  "docker compose up -d",
  "# Alternativ direkt mit Dockerfile:",
  "docker build -t logiccircuit-sidecar .",
  "docker run -d --rm -p 3001:3001 --env-file .env --read-only --cap-drop=ALL logiccircuit-sidecar",
].join("\n");

function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  return Promise.resolve(false);
}

// Modaler Dialog zum Herunterladen des eigenständigen Sidecar-ZIP-Pakets inkl. Startanleitung
const SidecarDownloadDialog = styled(({
  isOpen,
  onOpenByoSidecar,
  onClose,
  ...other
}: SidecarDownloadDialogProps) => {
  const { t } = useTranslation();
  const [copiedTarget, setCopiedTarget] = React.useState<CopyTarget>(null);
  const clientVersion = getClientVersion();

  React.useEffect(
    () => {
      if (!isOpen) {
        setCopiedTarget(null);
        return;
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
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

  const handleCopyCommand = React.useCallback(
    async (target: Exclude<CopyTarget, null>, value: string) => {
      const ok = await copyTextToClipboard(value);
      if (ok) {
        setCopiedTarget(target);
      }
    },
    [],
  );

  if (!isOpen) {
    return null;
  }

  const downloadFileName = `logic-circuit-sidecar-v${clientVersion}.zip`;

  const modalContent = (
    <div
      {...other}
      data-component="SidecarDownloadDialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sidecar-download-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-card">
        <div className="modal-header">
          <h2 id="sidecar-download-dialog-title" className="modal-title">
            {t("dialog.sidecarDownload.title")}
          </h2>
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
          <p className="intro-text">{t("dialog.sidecarDownload.intro")}</p>

          <div className="meta-row">
            <span className="meta-badge" data-testid="sidecar-download-version">
              {t("dialog.sidecarDownload.expectedVersionLabel", { version: `v${clientVersion}` })}
            </span>
            <span className="meta-badge">
              {t("dialog.sidecarDownload.requirementsBadge")}
            </span>
          </div>

          <div className="download-box">
            <a
              href={DOWNLOAD_ARCHIVE_PATH}
              download={downloadFileName}
              className="download-primary-link"
              data-testid="sidecar-download-link"
            >
              {t("dialog.sidecarDownload.downloadButton", { fileName: downloadFileName })}
            </a>
            {onOpenByoSidecar && (
              <button
                type="button"
                className="byo-jump-btn"
                data-testid="sidecar-open-byo-btn"
                onClick={onOpenByoSidecar}
              >
                {t("dialog.sidecarDownload.openByoButton")}
              </button>
            )}
          </div>

          <section className="section-block">
            <div className="section-header">
              <h3 className="section-title">{t("dialog.sidecarDownload.nodeSectionTitle")}</h3>
              <button
                type="button"
                className="copy-btn"
                data-testid="sidecar-copy-node-btn"
                onClick={() => { void handleCopyCommand("node", NODE_QUICKSTART_COMMAND); }}
              >
                {copiedTarget === "node" ? t("common.copied") : t("common.copy")}
              </button>
            </div>
            <pre className="code-block" data-testid="sidecar-node-commands">{NODE_QUICKSTART_COMMAND}</pre>
          </section>

          <section className="section-block">
            <div className="section-header">
              <h3 className="section-title">{t("dialog.sidecarDownload.dockerSectionTitle")}</h3>
              <button
                type="button"
                className="copy-btn"
                data-testid="sidecar-copy-docker-btn"
                onClick={() => { void handleCopyCommand("docker", DOCKER_QUICKSTART_COMMAND); }}
              >
                {copiedTarget === "docker" ? t("common.copied") : t("common.copy")}
              </button>
            </div>
            <pre className="code-block" data-testid="sidecar-docker-commands">{DOCKER_QUICKSTART_COMMAND}</pre>
          </section>

          <section className="section-block">
            <h3 className="section-title">{t("dialog.sidecarDownload.configSectionTitle")}</h3>
            <ul className="hint-list" data-testid="sidecar-config-hints">
              <li>{t("dialog.sidecarDownload.hintKeys")}</li>
              <li>{t("dialog.sidecarDownload.hintOrigins")}</li>
              <li>{t("dialog.sidecarDownload.hintProxy")}</li>
            </ul>
          </section>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-primary"
            data-testid="sidecar-download-close-btn"
            onClick={onClose}
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
    maxWidth: "40rem",
    maxHeight: "88vh",
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
      padding: "1.1rem 1.25rem",
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      gap: "0.95rem",

      "& > .intro-text": {
        margin: 0,
        fontSize: "0.85rem",
        lineHeight: 1.5,
        color: "var(--color-text-secondary)",
      },

      "& > .meta-row": {
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",

        "& > .meta-badge": {
          padding: "0.2rem 0.55rem",
          borderRadius: "0.25rem",
          border: "1px solid var(--color-border-subtle)",
          backgroundColor: "var(--color-bg-elevated)",
          fontFamily: "var(--font-family-mono)",
          fontSize: "0.75rem",
          color: "var(--color-text-primary)",
        },
      },

      "& > .download-box": {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "0.65rem",

        "& > .download-primary-link": {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0.5rem 0.95rem",
          borderRadius: "0.3rem",
          backgroundColor: "var(--color-accent-primary)",
          color: "var(--color-text-on-accent)",
          fontSize: "0.85rem",
          fontWeight: 600,
          textDecoration: "none",
          cursor: "pointer",

          "&:hover": {
            backgroundColor: "var(--color-accent-primary-hover)",
          },
        },

        "& > .byo-jump-btn": {
          padding: "0.48rem 0.85rem",
          borderRadius: "0.3rem",
          border: "1px solid var(--color-border-strong)",
          backgroundColor: "var(--color-bg-elevated)",
          color: "var(--color-text-primary)",
          fontSize: "0.83rem",
          fontWeight: 500,
          cursor: "pointer",

          "&:hover": {
            borderColor: "var(--color-accent-primary)",
          },
        },
      },

      "& > .section-block": {
        display: "flex",
        flexDirection: "column",
        gap: "0.4rem",

        "& > .section-header": {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
        },

        "& .section-title": {
          margin: 0,
          fontSize: "0.8rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--color-accent-primary)",
        },

        "& .copy-btn": {
          padding: "0.2rem 0.55rem",
          borderRadius: "0.25rem",
          border: "1px solid var(--color-border-subtle)",
          backgroundColor: "var(--color-bg-elevated)",
          color: "var(--color-text-secondary)",
          fontSize: "0.75rem",
          cursor: "pointer",

          "&:hover": {
            color: "var(--color-text-primary)",
            borderColor: "var(--color-border-strong)",
          },
        },

        "& > .code-block": {
          margin: 0,
          padding: "0.65rem 0.8rem",
          borderRadius: "0.3rem",
          border: "1px solid var(--color-border-subtle)",
          backgroundColor: "var(--color-bg-base)",
          fontFamily: "var(--font-family-mono)",
          fontSize: "0.76rem",
          lineHeight: 1.45,
          color: "var(--color-text-primary)",
          overflowX: "auto",
          whiteSpace: "pre",
        },

        "& > .hint-list": {
          margin: 0,
          paddingLeft: "1.2rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.3rem",
          fontSize: "0.81rem",
          lineHeight: 1.45,
          color: "var(--color-text-secondary)",
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

export default SidecarDownloadDialog;
