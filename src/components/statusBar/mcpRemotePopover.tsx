import React from "react";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import type McpBridgeStatus from "../../types/mcp/mcpBridgeStatus";

import { buildRemoteChatPrompt } from "../../utils/mcpStorage";
import { validateSidecarBaseUrl } from "../../utils/sidecarStorage";
import type { SidecarVersionCheckResult } from "../../utils/sidecarVersion";

export type McpRemotePopoverProps = Omit<React.ComponentPropsWithoutRef<"div">, "children"> & {
  isOpen: boolean;
  status: McpBridgeStatus;
  sessionId: string | null;
  connectedTabCount: number;
  error: string | null;
  isSharedWorkerSupported: boolean;
  sidecarUrl?: string;
  customSidecarRequired?: boolean;
  isBlockedByCollab?: boolean;
  versionCheck?: SidecarVersionCheckResult | null;
  onOpenSettings?: () => void;
  onOpenSidecarDownload?: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onActivateThisTab: () => void;
  onClose: () => void;
};

function getRemoteStatusLabel(status: McpBridgeStatus, t: (key: string) => string): string {
  switch (status) {
    case "local-connecting":
      return t("mcpPopover.status.localConnecting");
    case "local-connected":
      return t("mcpPopover.status.localConnected");
    case "remote-off":
      return t("mcpPopover.status.remoteOff");
    case "remote-connecting":
      return t("mcpPopover.status.remoteConnecting");
    case "remote-active-self":
      return t("mcpPopover.status.remoteActiveSelf");
    case "remote-active-other":
      return t("mcpPopover.status.remoteActiveOther");
    case "remote-error":
      return t("mcpPopover.status.remoteError");
  }
}

function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  return Promise.resolve(false);
}

// Kompaktes Verbindungs-Popover für Remote MCP: Verbinden/Trennen, KI-Chat-Prompt & Sprung in die Einstellungen
const McpRemotePopover = styled(({
  isOpen,
  status,
  sessionId,
  connectedTabCount,
  error,
  isSharedWorkerSupported,
  sidecarUrl = "",
  customSidecarRequired = false,
  isBlockedByCollab = false,
  versionCheck = null,
  onOpenSettings,
  onOpenSidecarDownload,
  onConnect,
  onDisconnect,
  onActivateThisTab,
  onClose,
  ...other
}: McpRemotePopoverProps) => {
  const { t } = useTranslation();
  const [isPromptCopied, setIsPromptCopied] = React.useState(false);

  React.useEffect(
    () => {
      if (!isOpen) {
        return undefined;
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

  React.useEffect(
    () => {
      if (!isPromptCopied) {
        return undefined;
      }
      const timer = setTimeout(() => setIsPromptCopied(false), 2000);
      return () => clearTimeout(timer);
    },
    [isPromptCopied],
  );

  if (!isOpen) {
    return null;
  }

  const isConnectedOrConnecting =
    status === "remote-connecting" ||
    status === "remote-active-self" ||
    status === "remote-active-other";
  const urlValidation = validateSidecarBaseUrl(sidecarUrl);
  const missingRequiredUrl = customSidecarRequired && sidecarUrl.trim().length === 0;
  const isConnectDisabled = !urlValidation.ok || missingRequiredUrl;
  const chatPrompt = sessionId ? buildRemoteChatPrompt(sessionId) : "";
  const showVersionNotice =
    versionCheck !== null &&
    (versionCheck.relation === "server-outdated" || versionCheck.relation === "client-outdated");

  const handleCopyPrompt = () => {
    if (!chatPrompt) {
      return;
    }
    void copyToClipboard(chatPrompt).then((ok) => {
      if (ok) {
        setIsPromptCopied(true);
      }
    });
  };

  return (
    <div {...other} role="dialog" aria-label={t("mcpPopover.dialogAriaLabel")} data-component="McpRemotePopover">
      <div className="popover-header">
        <span className="popover-title">{t("mcpPopover.title")}</span>
        <button
          type="button"
          className="close-btn"
          aria-label={t("common.close")}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="status-row">
        <span className={`status-pill ${status}`}>
          {getRemoteStatusLabel(status, t)}
        </span>
        <span className="tab-info">
          {isSharedWorkerSupported
            ? t("mcpPopover.sharedWorkerTabs", { count: connectedTabCount })
            : t("mcpPopover.singleTabMode")}
        </span>
      </div>

      {isBlockedByCollab && (
        <div className="error-box" role="status" data-testid="mcp-collab-blocked-hint">
          {t("mcpPopover.blockedByCollabNotice")}
        </div>
      )}

      {error && !isBlockedByCollab && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      {!urlValidation.ok && urlValidation.error && (
        <div className="error-box" role="alert" data-testid="mcp-sidecar-url-error">
          {urlValidation.error}
        </div>
      )}

      {missingRequiredUrl && (
        <div className="field-hint" data-testid="mcp-sidecar-required-hint">
          {t("mcpPopover.sidecarUrlRequiredHint")}
        </div>
      )}

      {status === "remote-active-other" && (
        <button
          type="button"
          className="claim-tab-btn"
          disabled={isBlockedByCollab}
          onClick={onActivateThisTab}
        >
          {t("mcpPopover.claimTabButton")}
        </button>
      )}

      {sessionId && (
        <div className="prompt-section">
          <div className="section-label">{t("mcpPopover.chatPromptLabel")}</div>
          <code className="prompt-preview" data-testid="mcp-chat-prompt">
            {chatPrompt}
          </code>
          <button
            type="button"
            className="copy-btn"
            onClick={handleCopyPrompt}
          >
            {isPromptCopied ? t("mcpPopover.chatPromptCopied") : t("mcpPopover.copyChatPrompt")}
          </button>
        </div>
      )}

      {showVersionNotice && versionCheck && (
        <div className="version-banner" role="status" data-testid="mcp-version-banner">
          <span>
            {versionCheck.relation === "server-outdated"
              ? t("mcpPopover.versionOutdatedNotice", {
                serverVersion: versionCheck.serverVersion ?? "?",
                clientVersion: versionCheck.clientVersion,
              })
              : t("mcpPopover.versionClientOutdatedNotice", {
                serverVersion: versionCheck.serverVersion ?? "?",
                clientVersion: versionCheck.clientVersion,
              })}
          </span>
          {onOpenSidecarDownload && (
            <button
              type="button"
              className="secondary-btn"
              data-testid="mcp-version-download-btn"
              onClick={onOpenSidecarDownload}
            >
              {t("mcpPopover.versionDownloadButton")}
            </button>
          )}
        </div>
      )}

      <div className="action-row">
        {!isConnectedOrConnecting ? (
          <button
            type="button"
            className="primary-btn"
            disabled={isConnectDisabled || isBlockedByCollab}
            onClick={onConnect}
          >
            {t("mcpPopover.connectButton")}
          </button>
        ) : (
          <button
            type="button"
            className="danger-btn"
            onClick={onDisconnect}
          >
            {t("mcpPopover.disconnectButton")}
          </button>
        )}

        {onOpenSettings && (
          <button
            type="button"
            className="secondary-btn"
            data-testid="mcp-open-settings-btn"
            onClick={onOpenSettings}
          >
            {t("mcpPopover.openSettingsButton")}
          </button>
        )}
      </div>

      <p className="privacy-note">
        {t("mcpPopover.privacyNote")}
      </p>
    </div>
  );
})({
  position: "absolute",
  bottom: "calc(100% + 0.5rem)",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 100,
  width: "22rem",
  maxWidth: "calc(100vw - 2rem)",
  padding: "0.85rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.65rem",
  backgroundColor: "var(--color-bg-surface)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.5rem",
  boxShadow: "0 0.75rem 2rem hsla(220, 40%, 4%, 0.6)",
  color: "var(--color-text-primary)",
  fontSize: "0.8rem",
  textAlign: "left",
  userSelect: "text",

  "& > .popover-header": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",

    "& > .popover-title": {
      fontWeight: 600,
      fontSize: "0.9rem",
    },

    "& > .close-btn": {
      width: "1.5rem",
      height: "1.5rem",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
      border: "1px solid var(--color-border-subtle)",
      borderRadius: "0.25rem",
      color: "var(--color-text-secondary)",
      cursor: "pointer",
      fontSize: "1rem",
      lineHeight: 1,

      "&:hover": {
        backgroundColor: "var(--color-bg-elevated)",
        color: "var(--color-text-primary)",
      },
    },
  },

  "& > .status-row": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",

    "& > .status-pill": {
      padding: "0.15rem 0.5rem",
      borderRadius: "0.25rem",
      fontFamily: "var(--font-family-mono)",
      fontSize: "0.72rem",
      backgroundColor: "var(--color-bg-elevated)",
      border: "1px solid var(--color-border-subtle)",
      color: "var(--color-text-secondary)",

      "&.remote-active-self": {
        borderColor: "var(--color-status-running)",
        color: "var(--color-status-running)",
      },

      "&.remote-active-other": {
        borderColor: "var(--color-wire-selected)",
        color: "var(--color-wire-selected)",
      },

      "&.remote-error": {
        borderColor: "var(--color-status-stopped)",
        color: "var(--color-status-stopped)",
      },
    },

    "& > .tab-info": {
      fontSize: "0.72rem",
      color: "var(--color-text-muted)",
    },
  },

  "& > .error-box": {
    padding: "0.45rem 0.6rem",
    borderRadius: "0.25rem",
    border: "1px solid var(--color-status-stopped)",
    backgroundColor: "var(--color-error-bg)",
    color: "var(--color-text-primary)",
    fontSize: "0.75rem",
  },

  "& > .field-hint": {
    fontSize: "0.72rem",
    lineHeight: 1.35,
    color: "var(--color-text-muted)",
  },

  "& > .version-banner": {
    padding: "0.45rem 0.6rem",
    borderRadius: "0.25rem",
    border: "1px solid var(--color-warning-border)",
    backgroundColor: "var(--color-warning-bg)",
    color: "var(--color-text-primary)",
    fontSize: "0.74rem",
    lineHeight: 1.35,
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
    alignItems: "flex-start",
  },

  "& > .claim-tab-btn": {
    padding: "0.45rem 0.7rem",
    borderRadius: "0.3rem",
    border: "1px solid var(--color-wire-selected)",
    backgroundColor: "var(--color-warning-bg)",
    color: "var(--color-wire-selected)",
    fontWeight: 600,
    fontSize: "0.78rem",
    cursor: "pointer",

    "&:hover": {
      backgroundColor: "var(--color-warning-bg-strong)",
    },
  },

  "& > .prompt-section": {
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",

    "& > .section-label": {
      fontSize: "0.74rem",
      color: "var(--color-text-secondary)",
    },

    "& > .prompt-preview": {
      padding: "0.45rem 0.55rem",
      borderRadius: "0.25rem",
      border: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-bg-base)",
      fontFamily: "var(--font-family-mono)",
      fontSize: "0.72rem",
      wordBreak: "break-word",
    },

    "& > .copy-btn": {
      alignSelf: "flex-start",
      padding: "0.3rem 0.6rem",
      borderRadius: "0.25rem",
      border: "1px solid var(--color-accent-primary)",
      backgroundColor: "var(--color-accent-primary-bg)",
      color: "var(--color-text-primary)",
      fontSize: "0.74rem",
      cursor: "pointer",
    },
  },

  "& > .action-row": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",

    "& > .primary-btn": {
      padding: "0.4rem 0.8rem",
      borderRadius: "0.25rem",
      border: "1px solid var(--color-accent-primary)",
      backgroundColor: "var(--color-accent-primary)",
      color: "var(--color-bg-base)",
      fontWeight: 600,
      fontSize: "0.78rem",
      cursor: "pointer",

      "&:hover:not(:disabled)": {
        backgroundColor: "var(--color-accent-primary-hover)",
      },

      "&:disabled": {
        opacity: 0.45,
        cursor: "not-allowed",
      },
    },

    "& > .danger-btn": {
      padding: "0.4rem 0.8rem",
      borderRadius: "0.25rem",
      border: "1px solid var(--color-status-stopped)",
      backgroundColor: "var(--color-error-bg)",
      color: "var(--color-text-primary)",
      fontWeight: 600,
      fontSize: "0.78rem",
      cursor: "pointer",
    },
  },

  "& .secondary-btn": {
    padding: "0.35rem 0.6rem",
    borderRadius: "0.25rem",
    border: "1px solid var(--color-border-subtle)",
    backgroundColor: "var(--color-bg-elevated)",
    color: "var(--color-text-secondary)",
    fontSize: "0.74rem",
    cursor: "pointer",

    "&:hover": {
      color: "var(--color-text-primary)",
      borderColor: "var(--color-border-strong)",
    },
  },

  "& > .privacy-note": {
    margin: 0,
    fontSize: "0.7rem",
    lineHeight: 1.35,
    color: "var(--color-text-muted)",
  },
});

export default McpRemotePopover;
