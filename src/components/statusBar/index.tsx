import React from "react";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CanvasContext from "../../contexts/canvasContext";
import CircuitContext from "../../contexts/circuitContext";
import CollabContext, { type CollabContextType } from "../../contexts/collabContext";
import SimulationContext from "../../contexts/simulationContext";
import useMcpBridge, { type McpBridgeController } from "../../hooks/useMcpBridge";

import type CollabRole from "../../types/collab/collabRole";
import type McpBridgeStatus from "../../types/mcp/mcpBridgeStatus";
import type AppLanguage from "../../types/settings/appLanguage";

import {
  applyLanguagePreference,
  AUTO_LANGUAGE,
  DEFAULT_LANGUAGE,
  getLocaleNativeName,
  resolveEffectiveLanguage,
} from "../../i18n";
import { circuitContainsAudio } from "../../utils/circuitLayout";
import { isCollabDisabledByEnv } from "../../utils/collabIceConfig";
import { formatZoomPercentage } from "../../utils/coordinateSystem";
import { loadMcpAccessKey } from "../../utils/mcpStorage";
import { loadSidecarBaseUrl, SIDECAR_SETTINGS_CHANGED_EVENT } from "../../utils/sidecarStorage";
import { compareSidecarVersion, fetchMcpServerStatus, type SidecarVersionCheckResult } from "../../utils/sidecarVersion";
import { OPEN_START_COLLAB_DIALOG_EVENT } from "../collab/startCollabSessionDialog";

import LanguagePopover from "./languagePopover";
import McpRemotePopover from "./mcpRemotePopover";
import { OPEN_OPTIONS_DIALOG_EVENT } from "../app/optionsDialog";
import { OPEN_SIDECAR_DOWNLOAD_EVENT } from "../app/sidecarDownloadDialog";

type StatusBarProps = React.ComponentPropsWithoutRef<"footer"> & {
  mcpControllerOverride?: McpBridgeController;
  collabOverride?: CollabContextType;
  initialPopoverOpen?: boolean;
  initialLanguagePopoverOpen?: boolean;
  onOpenSidecarDownload?: () => void;
};

type TranslateFn = (key: string) => string;

function getMcpRemoteLabel(status: McpBridgeStatus, t: TranslateFn): string {
  switch (status) {
    case "local-connecting":
      return t("statusBar.mcp.labelLocalConnecting");
    case "local-connected":
      return t("statusBar.mcp.labelLocalConnected");
    case "remote-off":
      return t("statusBar.mcp.labelRemoteOff");
    case "remote-connecting":
      return t("statusBar.mcp.labelRemoteConnecting");
    case "remote-active-self":
      return t("statusBar.mcp.labelRemoteActiveSelf");
    case "remote-active-other":
      return t("statusBar.mcp.labelRemoteActiveOther");
    case "remote-error":
      return t("statusBar.mcp.labelRemoteError");
  }
}

function getMcpStatusTitle(status: McpBridgeStatus, t: TranslateFn): string {
  switch (status) {
    case "local-connecting":
      return t("statusBar.mcp.titleLocalConnecting");
    case "local-connected":
      return t("statusBar.mcp.titleLocalConnected");
    case "remote-off":
      return t("statusBar.mcp.titleRemoteOff");
    case "remote-connecting":
      return t("statusBar.mcp.titleRemoteConnecting");
    case "remote-active-self":
      return t("statusBar.mcp.titleRemoteActiveSelf");
    case "remote-active-other":
      return t("statusBar.mcp.titleRemoteActiveOther");
    case "remote-error":
      return t("statusBar.mcp.titleRemoteError");
  }
}

function getCollabRoleShortLabel(role: CollabRole | null, t: TranslateFn): string {
  switch (role) {
    case "host":
      return t("statusBar.collab.roleHost");
    case "collaborator":
      return t("statusBar.collab.roleCollaborator");
    case "guest":
      return t("statusBar.collab.roleGuest");
    default:
      return t("statusBar.collab.startLabel");
  }
}

const StatusBar = styled(({
  mcpControllerOverride,
  collabOverride,
  initialPopoverOpen = false,
  initialLanguagePopoverOpen = false,
  onOpenSidecarDownload,
  ...other
}: StatusBarProps) => {
  const { t, i18n } = useTranslation();
  const circuitContext = React.useContext(CircuitContext);
  const liveCollab = React.useContext(CollabContext);
  const collab = collabOverride ?? liveCollab;
  const {
    cursor,
    viewport,
    zoomIn,
    zoomOut,
    resetZoom,
    resetView,
    selectedCount,
  } = React.useContext(CanvasContext);
  const {
    isSimulating,
    isPaused,
    isRunning,
    isOscillating,
    isCollabSnapshotSimulation,
    startSimulation,
    step,
    stopSimulation,
  } = React.useContext(SimulationContext);
  const liveMcp = useMcpBridge();
  const mcp = mcpControllerOverride ?? liveMcp;
  const { status: mcpStatus, mode: mcpMode } = mcp;
  const isCollabDisabled = collab?.isDisabled ?? isCollabDisabledByEnv();
  const isMcpBlockedByCollab = Boolean(mcp.isBlockedByCollab || collab?.isMcpBlockedByCollab);
  const isSnapshotSim = Boolean(
    isSimulating &&
    collab?.isInSession &&
    (isCollabSnapshotSimulation || collab.modelSyncState?.isLocalSimulationBuffered),
  );
  const pendingSimDeltaCount = collab?.modelSyncState?.pendingSimulationDeltaCount ?? 0;
  const requiresSimResync = Boolean(
    collab?.modelSyncState?.requiresResyncAfterSimulation ||
    collab?.modelSyncState?.hasPendingProjectSwitchDuringSim,
  );
  const hasPendingSnapshotUpdate = pendingSimDeltaCount > 0 || requiresSimResync;
  const [popoverOpen, setPopoverOpen] = React.useState(initialPopoverOpen);
  const [languagePopoverOpen, setLanguagePopoverOpen] = React.useState(initialLanguagePopoverOpen);
  const [accessKey, setAccessKey] = React.useState(() => loadMcpAccessKey());
  const [sidecarUrl, setSidecarUrl] = React.useState(() => loadSidecarBaseUrl());
  const [versionCheck, setVersionCheck] = React.useState<SidecarVersionCheckResult | null>(null);
  const languageWrapperRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(
    () => {
      if (!languagePopoverOpen || typeof document === "undefined") {
        return undefined;
      }

      const handleMouseDown = (event: MouseEvent) => {
        const target = event.target as Node | null;
        if (target && languageWrapperRef.current?.contains(target)) {
          return;
        }
        setLanguagePopoverOpen(false);
      };

      document.addEventListener("mousedown", handleMouseDown);
      return () => document.removeEventListener("mousedown", handleMouseDown);
    },
    [languagePopoverOpen],
  );

  const selectedLanguagePreference: AppLanguage =
    circuitContext?.appSettings?.language ?? AUTO_LANGUAGE;
  const audioMuted = circuitContext?.appSettings?.audioMuted ?? false;
  const hasAudioComponents = React.useMemo(
    () => {
      const activeCircuit = circuitContext?.currentCircuit;
      const project = circuitContext?.project;
      if (!activeCircuit) {
        return false;
      }
      const byId = project
        ? new Map(project.logicalCircuits.map((lc) => [lc.logicalCircuitId, lc]))
        : undefined;
      return circuitContainsAudio(activeCircuit, byId);
    },
    [circuitContext?.currentCircuit, circuitContext?.project],
  );
  const activeLanguageCode =
    i18n.resolvedLanguage ??
    i18n.language ??
    resolveEffectiveLanguage(selectedLanguagePreference) ??
    DEFAULT_LANGUAGE;
  const activeShortCode = activeLanguageCode.split("-")[0].toUpperCase();
  const activeLanguageNativeName = getLocaleNativeName(activeLanguageCode);

  const handleSelectLanguage = React.useCallback(
    (language: AppLanguage) => {
      if (circuitContext?.updateAppSettings) {
        circuitContext.updateAppSettings({ language });
      } else {
        applyLanguagePreference(language);
      }
      setLanguagePopoverOpen(false);
    },
    [circuitContext],
  );

  React.useEffect(
    () => {
      if (typeof window === "undefined") {
        return undefined;
      }

      const handleSettingsChanged = () => {
        setAccessKey(loadMcpAccessKey());
        setSidecarUrl(loadSidecarBaseUrl());
      };

      window.addEventListener(SIDECAR_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
      window.addEventListener("storage", handleSettingsChanged);
      return () => {
        window.removeEventListener(SIDECAR_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
        window.removeEventListener("storage", handleSettingsChanged);
      };
    },
    [],
  );

  React.useEffect(
    () => {
      if (mcpMode !== "remote" || (mcpStatus !== "remote-active-self" && mcpStatus !== "remote-active-other")) {
        setVersionCheck(null);
        return undefined;
      }

      const controller = new AbortController();
      const effectiveUrl = (mcp.sidecarBaseUrl ?? sidecarUrl).trim();
      void fetchMcpServerStatus({
        baseUrl: effectiveUrl.length > 0 ? effectiveUrl : undefined,
        signal: controller.signal,
      }).then((statusPayload) => {
        if (!controller.signal.aborted && statusPayload) {
          setVersionCheck(compareSidecarVersion(statusPayload.serverVersion));
        }
      });

      return () => controller.abort();
    },
    [
      mcp.sidecarBaseUrl,
      mcpMode,
      mcpStatus,
      sidecarUrl,
    ],
  );

  return (
    <footer {...other} data-component="StatusBar">
      <div className="simulation-group">
        <button
          type="button"
          className={`sim-btn play-btn ${isRunning ? "active" : ""}`}
          title={t("statusBar.playTitle")}
          aria-label={t("statusBar.playAriaLabel")}
          onClick={() => {
            void startSimulation();
          }}
        >
          <svg viewBox="0 0 24 24" className="sim-icon" aria-hidden="true">
            <path d="M8 5v14l11-7z" fill="currentColor" />
          </svg>
        </button>

        <button
          type="button"
          className={`sim-btn step-btn ${isSimulating && isPaused ? "active" : ""}`}
          title={t("statusBar.stepTitle")}
          aria-label={t("statusBar.stepAriaLabel")}
          onClick={() => {
            void step();
          }}
        >
          <svg viewBox="0 0 24 24" className="sim-icon" aria-hidden="true">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor" />
          </svg>
        </button>

        <button
          type="button"
          className={`sim-btn stop-btn ${!isSimulating ? "disabled" : ""}`}
          title={t("statusBar.stopTitle")}
          aria-label={t("statusBar.stopAriaLabel")}
          onClick={() => {
            void stopSimulation();
          }}
          disabled={!isSimulating}
        >
          <svg viewBox="0 0 24 24" className="sim-icon" aria-hidden="true">
            <path d="M6 6h12v12H6z" fill="currentColor" />
          </svg>
        </button>

        {hasAudioComponents && (
          <button
            type="button"
            data-testid="status-bar-mute-btn"
            className={`sim-btn mute-btn${audioMuted ? " muted" : ""}`}
            title={audioMuted ? t("statusBar.unmuteTitle") : t("statusBar.muteTitle")}
            aria-label={audioMuted ? t("statusBar.unmuteAriaLabel") : t("statusBar.muteAriaLabel")}
            aria-pressed={audioMuted}
            onClick={() => {
              circuitContext?.updateAppSettings({ audioMuted: !audioMuted });
            }}
          >
            {audioMuted ? (
              <svg viewBox="0 0 24 24" className="sim-icon" aria-hidden="true">
                <path
                  d={
                    "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63z" +
                    "m2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12" +
                    "c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71z" +
                    "M4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25" +
                    "c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3z" +
                    "M12 4L9.91 6.09 12 8.18V4z"
                  }
                  fill="currentColor"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="sim-icon" aria-hidden="true">
                <path
                  d={
                    "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05" +
                    "c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71" +
                    "s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
                  }
                  fill="currentColor"
                />
              </svg>
            )}
          </button>
        )}

        <span className="separator">|</span>

        <div className="coordinates-group">
          <span className="coord-label">{t("statusBar.gridLabel")}</span>
          <span className="coord-value">
            {cursor ? `X: ${cursor.grid.x}, Y: ${cursor.grid.y}` : "X: --, Y: --"}
          </span>

          <span className="separator">|</span>

          <span className="coord-label">{t("statusBar.pixelLabel")}</span>
          <span className="coord-value">
            {cursor ? `${Math.round(cursor.canvas.x)} px, ${Math.round(cursor.canvas.y)} px` : "-- px, -- px"}
          </span>
        </div>
      </div>

      <div className="selection-group">
        <span className="selection-info">
          {!isSimulating
            ? selectedCount > 0
              ? t("statusBar.selectionCount", { count: selectedCount })
              : t("statusBar.ready")
            : isOscillating
              ? t("statusBar.simOscillating")
              : isPaused
                ? t("statusBar.simPaused")
                : t("statusBar.simRunning")}
        </span>
        {isSnapshotSim && (
          <span
            className={`snapshot-sim-badge${hasPendingSnapshotUpdate ? " has-updates" : ""}`}
            data-testid="status-bar-snapshot-sim-badge"
            title={
              requiresSimResync
                ? t("statusBar.simSnapshotResyncTooltip")
                : pendingSimDeltaCount > 0
                  ? t("statusBar.simSnapshotPendingTooltip", { count: pendingSimDeltaCount })
                  : t("statusBar.simSnapshotTooltip")
            }
          >
            {requiresSimResync
              ? t("statusBar.simSnapshotBadgeResync")
              : pendingSimDeltaCount > 0
                ? t("statusBar.simSnapshotBadgePending", { count: pendingSimDeltaCount })
                : t("statusBar.simSnapshotBadge")}
          </span>
        )}
        {!isCollabDisabled && (
          <button
            type="button"
            className={`collab-status-button ${collab?.isInSession ? `active ${collab.transportState}` : "idle"}`}
            data-testid="status-bar-collab-btn"
            data-collab-active={collab?.isInSession ? "true" : "false"}
            aria-expanded={collab?.isInSession ? collab.isParticipantsPanelOpen : undefined}
            title={
              collab?.isInSession
                ? t("statusBar.collab.activeTitle", {
                  role: getCollabRoleShortLabel(collab.selfRole, t),
                  count: collab.participants.length,
                })
                : t("statusBar.collab.startTitle")
            }
            onClick={() => {
              if (collab?.isInSession) {
                collab.setParticipantsPanelOpen(!collab.isParticipantsPanelOpen);
              } else if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent(OPEN_START_COLLAB_DIALOG_EVENT));
              }
            }}
          >
            <span className="collab-label">
              {collab?.isInSession
                ? t("statusBar.collab.activeLabel", {
                  role: getCollabRoleShortLabel(collab.selfRole, t),
                  count: collab.participants.length,
                })
                : t("statusBar.collab.startLabel")}
            </span>
            {collab?.isInSession && collab.raisedHandCount > 0 && (
              <span className="collab-hand-count" data-testid="status-bar-collab-hands">
                ✋ {collab.raisedHandCount}
              </span>
            )}
          </button>
        )}

        {mcpMode === "disabled" ? null : mcpMode === "local" ? (
          <span
            className={`mcp-indicator ${isMcpBlockedByCollab ? "blocked" : mcpStatus === "local-connected" ? "connected" : "connecting"}`}
            title={isMcpBlockedByCollab ? t("statusBar.mcp.titleBlockedByCollab") : getMcpStatusTitle(mcpStatus, t)}
            data-mcp-status={mcpStatus}
            data-mcp-blocked={isMcpBlockedByCollab ? "true" : undefined}
          >
            {isMcpBlockedByCollab ? t("statusBar.mcp.labelBlockedByCollab") : getMcpRemoteLabel(mcpStatus, t)}
          </span>
        ) : (
          <div className="mcp-remote-wrapper">
            <button
              type="button"
              className={`mcp-remote-button ${mcpStatus}${isMcpBlockedByCollab ? " blocked" : ""}`}
              title={isMcpBlockedByCollab ? t("statusBar.mcp.titleBlockedByCollab") : getMcpStatusTitle(mcpStatus, t)}
              data-mcp-status={mcpStatus}
              data-mcp-blocked={isMcpBlockedByCollab ? "true" : undefined}
              aria-expanded={popoverOpen}
              onClick={() => {
                setPopoverOpen((prev) => {
                  const next = !prev;
                  if (next) {
                    setLanguagePopoverOpen(false);
                  }
                  return next;
                });
              }}
            >
              {isMcpBlockedByCollab ? t("statusBar.mcp.labelBlockedByCollab") : getMcpRemoteLabel(mcpStatus, t)}
            </button>
            <McpRemotePopover
              isOpen={popoverOpen}
              status={mcpStatus}
              sessionId={mcp.sessionId}
              connectedTabCount={mcp.connectedTabCount}
              error={mcp.error}
              isSharedWorkerSupported={mcp.isSharedWorkerSupported}
              sidecarUrl={sidecarUrl}
              customSidecarRequired={mcp.customSidecarRequired}
              isBlockedByCollab={isMcpBlockedByCollab}
              versionCheck={versionCheck}
              onOpenSettings={() => {
                setPopoverOpen(false);
                if (typeof window !== "undefined") {
                  window.dispatchEvent(new CustomEvent(OPEN_OPTIONS_DIALOG_EVENT, { detail: { tab: "sidecar" } }));
                }
              }}
              onOpenSidecarDownload={() => {
                setPopoverOpen(false);
                if (onOpenSidecarDownload) {
                  onOpenSidecarDownload();
                } else if (typeof window !== "undefined") {
                  window.dispatchEvent(new CustomEvent(OPEN_SIDECAR_DOWNLOAD_EVENT));
                }
              }}
              onConnect={() => mcp.connect(accessKey, sidecarUrl)}
              onDisconnect={mcp.disconnect}
              onActivateThisTab={mcp.activateThisTab}
              onClose={() => setPopoverOpen(false)}
            />
          </div>
        )}
      </div>

      <div className="zoom-group">
        <button
          type="button"
          className="zoom-btn"
          title={t("statusBar.zoomOutTitle")}
          onClick={zoomOut}
        >
          −
        </button>

        <button
          type="button"
          className="zoom-display"
          title={t("statusBar.zoomResetTitle")}
          onClick={resetZoom}
        >
          {formatZoomPercentage(viewport.zoom)}
        </button>

        <button
          type="button"
          className="zoom-btn"
          title={t("statusBar.zoomInTitle")}
          onClick={zoomIn}
        >
          +
        </button>

        <button
          type="button"
          className="reset-view-btn"
          title={t("statusBar.originTitle")}
          onClick={resetView}
        >
          {t("statusBar.originLabel")}
        </button>

        <span className="separator">|</span>

        <div className="language-switcher-wrapper" ref={languageWrapperRef}>
          <button
            type="button"
            className={`language-btn${languagePopoverOpen ? " open" : ""}`}
            data-testid="statusbar-language-button"
            aria-haspopup="menu"
            aria-expanded={languagePopoverOpen}
            aria-label={t("statusBar.language.ariaLabel", { language: activeLanguageNativeName })}
            title={t("statusBar.language.tooltip", { language: activeLanguageNativeName })}
            onClick={() => {
              setLanguagePopoverOpen((prev) => {
                const next = !prev;
                if (next) {
                  setPopoverOpen(false);
                }
                return next;
              });
            }}
          >
            <svg viewBox="0 0 24 24" className="globe-icon" aria-hidden="true">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <ellipse cx="12" cy="12" rx="3.8" ry="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <line x1="3.4" y1="9" x2="20.6" y2="9" stroke="currentColor" strokeWidth="1.5" />
              <line x1="3.4" y1="15" x2="20.6" y2="15" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <span className="language-code">{activeShortCode}</span>
          </button>

          <LanguagePopover
            isOpen={languagePopoverOpen}
            selectedLanguage={selectedLanguagePreference}
            onSelectLanguage={handleSelectLanguage}
            onClose={() => setLanguagePopoverOpen(false)}
          />
        </div>
      </div>
    </footer>
  );
})({
  flex: "0 0 2.25rem",
  display: "grid",
  gridTemplateColumns: "1fr auto 1fr",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0 1rem",
  backgroundColor: "var(--color-bg-surface)",
  borderTop: "1px solid var(--color-border-subtle)",
  fontSize: "0.8rem",
  color: "var(--color-text-secondary)",

  "& > .simulation-group": {
    display: "flex",
    alignItems: "center",
    gap: "0.35rem",

    "& > .sim-btn": {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "1.625rem",
      height: "1.625rem",
      padding: 0,
      backgroundColor: "var(--color-bg-elevated)",
      border: "1px solid var(--color-border-subtle)",
      borderRadius: "0.25rem",
      cursor: "pointer",
      transition: "all 0.15s ease",

      "& > .sim-icon": {
        width: "1rem",
        height: "1rem",
      },

      "&.play-btn": {
        color: "var(--color-status-running)",

        "&:hover:not(:disabled)": {
          backgroundColor: "var(--color-success-bg)",
          borderColor: "var(--color-status-running)",
        },

        "&.active": {
          backgroundColor: "var(--color-success-bg-strong)",
          borderColor: "var(--color-status-running)",
          boxShadow: "0 0 6px rgba(46, 160, 67, 0.4)",
        },
      },

      "&.step-btn": {
        color: "var(--color-accent-primary)",

        "&:hover:not(:disabled)": {
          backgroundColor: "var(--color-accent-tint)",
          borderColor: "var(--color-accent-primary)",
        },

        "&.active": {
          backgroundColor: "var(--color-accent-tint-strong)",
          borderColor: "var(--color-accent-primary)",
        },
      },

      "&.stop-btn": {
        color: "var(--color-status-stopped)",

        "&:hover:not(:disabled)": {
          backgroundColor: "var(--color-error-bg)",
          borderColor: "var(--color-status-stopped)",
        },

        "&.disabled, &:disabled": {
          opacity: 0.35,
          color: "var(--color-text-muted)",
          cursor: "not-allowed",
          borderColor: "var(--color-border-subtle)",
          backgroundColor: "transparent",
        },
      },

      "&.mute-btn": {
        color: "var(--color-text-secondary)",

        "&:hover": {
          backgroundColor: "var(--color-accent-tint)",
          borderColor: "var(--color-accent-primary)",
          color: "var(--color-accent-primary)",
        },

        "&.muted": {
          color: "var(--color-status-stopped)",
          borderColor: "var(--color-status-stopped)",
          backgroundColor: "var(--color-error-bg)",
        },
      },
    },

    "& .separator": {
      color: "var(--color-border-strong)",
      margin: "0 0.25rem",
    },

    "& > .coordinates-group": {
      display: "flex",
      alignItems: "center",
      gap: "0.35rem",

      "& > .coord-label": {
        color: "var(--color-text-muted)",
        fontWeight: 500,
      },

      "& > .coord-value": {
        fontFamily: "var(--font-family-mono)",
        color: "var(--color-text-primary)",
        minWidth: "6rem",
      },
    },
  },

  "& > .selection-group": {
    display: "flex",
    alignItems: "center",
    gap: "0.35rem",

    "& > .selection-info": {
      color: "var(--color-text-muted)",
    },

    "& > .snapshot-sim-badge": {
      display: "inline-flex",
      alignItems: "center",
      padding: "0.08rem 0.4rem",
      borderRadius: "0.25rem",
      border: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-bg-elevated)",
      color: "var(--color-text-secondary)",
      fontFamily: "var(--font-family-mono)",
      fontSize: "0.68rem",
      fontWeight: 600,

      "&.has-updates": {
        borderColor: "var(--color-warning)",
        color: "var(--color-warning)",
        backgroundColor: "var(--color-warning-bg)",
      },
    },

    "& > .collab-status-button": {
      display: "inline-flex",
      alignItems: "center",
      gap: "0.3rem",
      padding: "0.1rem 0.45rem",
      backgroundColor: "var(--color-bg-elevated)",
      border: "1px solid var(--color-border-subtle)",
      borderRadius: "0.25rem",
      fontFamily: "var(--font-family-mono)",
      fontSize: "0.7rem",
      color: "var(--color-text-secondary)",
      cursor: "pointer",
      transition: "all 0.15s ease",

      "&::before": {
        content: "\"\"",
        width: "0.45rem",
        height: "0.45rem",
        borderRadius: "50%",
        backgroundColor: "var(--color-text-muted)",
      },

      "&:hover": {
        borderColor: "var(--color-border-strong)",
        color: "var(--color-text-primary)",
      },

      "&.active.connected": {
        borderColor: "var(--color-status-running)",
        color: "var(--color-text-primary)",

        "&::before": {
          backgroundColor: "var(--color-status-running)",
        },
      },

      "&.active.degraded, &.active.reconnecting, &.active.migrating-host, &.active.connecting": {
        borderColor: "var(--color-warning)",
        color: "var(--color-text-primary)",

        "&::before": {
          backgroundColor: "var(--color-warning)",
        },
      },

      "&.active.failed": {
        borderColor: "var(--color-status-stopped)",
        color: "var(--color-error-text)",

        "&::before": {
          backgroundColor: "var(--color-status-stopped)",
        },
      },

      "& > .collab-hand-count": {
        color: "var(--color-warning)",
        fontWeight: 600,
      },
    },

    "& > .mcp-indicator": {
      display: "flex",
      alignItems: "center",
      gap: "0.3rem",
      padding: "0.1rem 0.45rem",
      border: "1px solid var(--color-border-subtle)",
      borderRadius: "0.25rem",
      fontFamily: "var(--font-family-mono)",
      fontSize: "0.7rem",
      color: "var(--color-text-muted)",

      "&::before": {
        content: "\"\"",
        width: "0.45rem",
        height: "0.45rem",
        borderRadius: "50%",
        backgroundColor: "var(--color-text-muted)",
      },

      "&.connected": {
        color: "var(--color-text-secondary)",

        "&::before": {
          backgroundColor: "var(--color-status-running)",
        },
      },

      "&.blocked": {
        borderColor: "var(--color-warning-border)",
        color: "var(--color-warning)",

        "&::before": {
          backgroundColor: "var(--color-warning)",
        },
      },
    },

    "& > .mcp-remote-wrapper": {
      position: "relative",
      display: "flex",
      alignItems: "center",

      "& > .mcp-remote-button": {
        display: "flex",
        alignItems: "center",
        gap: "0.3rem",
        padding: "0.1rem 0.45rem",
        backgroundColor: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "0.25rem",
        fontFamily: "var(--font-family-mono)",
        fontSize: "0.7rem",
        color: "var(--color-text-muted)",
        cursor: "pointer",
        transition: "all 0.15s ease",

        "&::before": {
          content: "\"\"",
          width: "0.45rem",
          height: "0.45rem",
          borderRadius: "50%",
          backgroundColor: "var(--color-text-muted)",
        },

        "&:hover": {
          borderColor: "var(--color-border-strong)",
          color: "var(--color-text-primary)",
        },

        "&.remote-active-self": {
          color: "var(--color-text-secondary)",
          borderColor: "var(--color-status-running)",

          "&::before": {
            backgroundColor: "var(--color-status-running)",
          },
        },

        "&.remote-active-other": {
          color: "var(--color-wire-selected)",
          borderColor: "var(--color-wire-selected)",

          "&::before": {
            backgroundColor: "var(--color-wire-selected)",
          },
        },

        "&.remote-error": {
          color: "var(--color-status-stopped)",
          borderColor: "var(--color-status-stopped)",

          "&::before": {
            backgroundColor: "var(--color-status-stopped)",
          },
        },

        "&.blocked": {
          color: "var(--color-warning)",
          borderColor: "var(--color-warning-border)",

          "&::before": {
            backgroundColor: "var(--color-warning)",
          },
        },
      },
    },
  },

  "& > .zoom-group": {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "0.35rem",

    "& > .zoom-btn": {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "1.5rem",
      height: "1.5rem",
      backgroundColor: "var(--color-bg-elevated)",
      border: "1px solid var(--color-border-subtle)",
      borderRadius: "0.25rem",
      color: "var(--color-text-primary)",
      fontSize: "0.95rem",
      cursor: "pointer",
      transition: "all 0.15s ease",

      "&:hover": {
        backgroundColor: "var(--color-bg-base)",
        borderColor: "var(--color-accent-primary)",
      },
    },

    "& > .zoom-display": {
      padding: "0.2rem 0.5rem",
      backgroundColor: "transparent",
      border: "1px solid transparent",
      borderRadius: "0.25rem",
      fontFamily: "var(--font-family-mono)",
      color: "var(--color-text-primary)",
      fontSize: "0.8rem",
      cursor: "pointer",
      transition: "all 0.15s ease",

      "&:hover": {
        backgroundColor: "var(--color-bg-elevated)",
        borderColor: "var(--color-border-strong)",
      },
    },

    "& > .reset-view-btn": {
      padding: "0.2rem 0.6rem",
      backgroundColor: "var(--color-bg-elevated)",
      border: "1px solid var(--color-border-subtle)",
      borderRadius: "0.25rem",
      color: "var(--color-text-secondary)",
      fontSize: "0.75rem",
      cursor: "pointer",
      marginLeft: "0.25rem",
      transition: "all 0.15s ease",

      "&:hover": {
        backgroundColor: "var(--color-bg-base)",
        color: "var(--color-text-primary)",
        borderColor: "var(--color-border-strong)",
      },
    },

    "& > .separator": {
      color: "var(--color-border-strong)",
      margin: "0 0.15rem",
    },

    "& > .language-switcher-wrapper": {
      position: "relative",
      display: "flex",
      alignItems: "center",

      "& > .language-btn": {
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        padding: "0.2rem 0.5rem",
        backgroundColor: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "0.25rem",
        color: "var(--color-text-secondary)",
        fontFamily: "var(--font-family-mono)",
        fontSize: "0.75rem",
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 0.15s ease",

        "& > .globe-icon": {
          width: "0.875rem",
          height: "0.875rem",
          flexShrink: 0,
        },

        "&:hover, &:focus-visible": {
          outline: "none",
          backgroundColor: "var(--color-bg-base)",
          color: "var(--color-text-primary)",
          borderColor: "var(--color-border-strong)",
        },

        "&.open": {
          backgroundColor: "var(--color-accent-tint)",
          color: "var(--color-text-primary)",
          borderColor: "var(--color-accent-primary)",
        },
      },
    },
  },
});

export default StatusBar;
