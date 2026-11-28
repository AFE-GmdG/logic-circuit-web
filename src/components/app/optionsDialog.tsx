import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CircuitContext from "../../contexts/circuitContext";
import CollabContext from "../../contexts/collabContext";
import { isMcpDisabledByEnv } from "../../hooks/useMcpBridge";

import type AppLanguage from "../../types/settings/appLanguage";
import type CollabCursorIdleTimeoutSec from "../../types/settings/collabCursorIdleTimeout";
import { COLLAB_CURSOR_IDLE_TIMEOUT_OPTIONS } from "../../types/settings/collabCursorIdleTimeout";
import type CollabCursorVisibilityMode from "../../types/settings/collabCursorVisibilityMode";
import { COLLAB_CURSOR_VISIBILITY_MODES } from "../../types/settings/collabCursorVisibilityMode";
import type StartupProjectMode from "../../types/settings/startupProjectMode";
import type FrameRateLimit from "../../types/simulation/frameRateLimit";

import { MAX_COLLAB_DISPLAY_NAME_LENGTH } from "../../collab/collabAuthorization";
import { DEFAULT_COLLAB_STUN_URLS } from "../../collab/collabEvents";
import {
  applyLanguagePreference,
  AUTO_LANGUAGE,
  AVAILABLE_LANGUAGES,
  detectBrowserLanguage,
  getLocaleNativeName,
} from "../../i18n";
import {
  DEFAULT_APP_SETTINGS,
  getCursorVisibilityModeTranslationKey,
  resolveCollabCursorIdleTimeoutSec,
  resolveCollabCursorVisibilityMode,
} from "../../utils/appSettingsStorage";
import { isCollabDisabledByEnv, parseStunUrls } from "../../utils/collabIceConfig";
import {
  type CollabParticipantColorMap,
  formatStoredParticipantDisplayName,
  loadParticipantColorDictionary,
  normalizeHexColor,
  saveParticipantColorDictionary,
} from "../../utils/collabParticipantColors";
import {
  clearCollabAccessKey,
  loadCollabAccessKey,
  loadCollabDisplayName,
  saveCollabAccessKey,
  saveCollabDisplayName,
} from "../../utils/collabStorage";
import {
  type FileSystemPermissionStatus,
  type StoredDirectoryWithPermission,
  ensureDirectoryPermission,
  isFileSystemAccessSupported,
  listStoredDirectories,
  pickAndAddProjectDirectory,
  removeProjectDirectory,
  setDefaultProjectDirectory,
} from "../../utils/fileSystemStorage";
import {
  buildRemoteMcpConfigJson,
  clearMcpAccessKey,
  loadMcpAccessKey,
  saveMcpAccessKey,
} from "../../utils/mcpStorage";
import {
  clearSidecarBaseUrl,
  DEFAULT_LOCAL_SIDECAR_URL,
  isCustomSidecarRequired,
  loadSidecarBaseUrl,
  saveSidecarBaseUrl,
  validateSidecarBaseUrl,
} from "../../utils/sidecarStorage";
import {
  probeSidecarServer,
  type SidecarProbeResult,
} from "../../utils/sidecarVersion";
import { CLOCK_FREQUENCY_STEPS } from "../../utils/simulationSpeed";

export const OPEN_OPTIONS_DIALOG_EVENT = "logic-circuit:open-options-dialog";

export type OptionsDialogTab = "general" | "directories" | "collab" | "sidecar";

export type OptionsDialogProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  initialTab?: OptionsDialogTab;
  initialShowIdeConfig?: boolean;
  onOpenSidecarDownload?: () => void;
  onClose: () => void;
};

function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  return Promise.resolve(false);
}

function formatPermissionLabel(
  status: FileSystemPermissionStatus,
  t: (key: string) => string,
): string {
  if (status === "granted") {
    return t("dialog.options.permissionGranted");
  }
  if (status === "prompt") {
    return t("dialog.options.permissionPrompt");
  }
  if (status === "denied") {
    return t("dialog.options.permissionDenied");
  }
  return t("dialog.options.permissionUnavailable");
}

// Modaler Systemeinstellungen-Dialog (DialogOptions) mit Tabs für Allgemein, Verzeichnisse, Kollaboration & BYO SideCar
const OptionsDialog = styled(({
  isOpen,
  initialTab = "general",
  initialShowIdeConfig = false,
  onOpenSidecarDownload,
  onClose,
  ...other
}: OptionsDialogProps) => {
  const { t } = useTranslation();
  const circuitContext = React.useContext(CircuitContext);
  const collabContext = React.useContext(CollabContext);
  const currentSettings = circuitContext?.appSettings ?? DEFAULT_APP_SETTINGS;
  const currentSettingsRef = React.useRef(currentSettings);
  currentSettingsRef.current = currentSettings;
  const tRef = React.useRef(t);
  tRef.current = t;

  const mcpDisabled = isMcpDisabledByEnv();
  const collabDisabled = isCollabDisabledByEnv();
  const customSidecarRequired = isCustomSidecarRequired();
  const sidecarTabVisible = !mcpDisabled || !collabDisabled;

  const visibleTabs = React.useMemo<OptionsDialogTab[]>(
    () => [
      "general",
      "directories",
      ...(!collabDisabled ? ["collab" as const] : []),
      ...(sidecarTabVisible ? ["sidecar" as const] : []),
    ],
    [collabDisabled, sidecarTabVisible],
  );

  const [activeTab, setActiveTab] = React.useState<OptionsDialogTab>(
    () => (visibleTabs.includes(initialTab) ? initialTab : "general"),
  );
  const [language, setLanguage] = React.useState<AppLanguage>(currentSettings.language);
  const [startupMode, setStartupMode] = React.useState<StartupProjectMode>(currentSettings.startupProjectMode);
  const [defaultFrequency, setDefaultFrequency] = React.useState<FrameRateLimit>(currentSettings.defaultFrequency);
  const [audioVolume, setAudioVolume] = React.useState<number>(currentSettings.audioVolume);
  const [audioMuted, setAudioMuted] = React.useState<boolean>(currentSettings.audioMuted);
  const [collabStunText, setCollabStunText] = React.useState<string>(
    (currentSettings.collabStunUrls ?? []).join("\n"),
  );
  const [collabDisplayName, setCollabDisplayName] = React.useState<string>(() => loadCollabDisplayName());
  const [collabCursorIdleTimeoutSec, setCollabCursorIdleTimeoutSec] = React.useState<CollabCursorIdleTimeoutSec>(
    () => resolveCollabCursorIdleTimeoutSec(currentSettings.collabCursorIdleTimeoutSec),
  );
  const [collabCursorVisibilityMode, setCollabCursorVisibilityMode] = React.useState<CollabCursorVisibilityMode>(
    () => resolveCollabCursorVisibilityMode(currentSettings.collabCursorVisibilityMode),
  );
  const [storedParticipantColors, setStoredParticipantColors] = React.useState<CollabParticipantColorMap>(
    () => loadParticipantColorDictionary(),
  );
  const [collabAccessKey, setCollabAccessKey] = React.useState<string>(() => loadCollabAccessKey());
  const [mcpAccessKey, setMcpAccessKey] = React.useState<string>(() => loadMcpAccessKey());
  const [sidecarUrl, setSidecarUrl] = React.useState<string>(() => loadSidecarBaseUrl());
  const [isProbingSidecar, setIsProbingSidecar] = React.useState(false);
  const [probeResult, setProbeResult] = React.useState<SidecarProbeResult | null>(null);
  const [showIdeConfig, setShowIdeConfig] = React.useState(initialShowIdeConfig);
  const [copiedIdeConfig, setCopiedIdeConfig] = React.useState(false);
  const [directories, setDirectories] = React.useState<StoredDirectoryWithPermission[]>([]);
  const [isLoadingDirectories, setIsLoadingDirectories] = React.useState(false);
  const [directoryError, setDirectoryError] = React.useState<string | null>(null);
  const directoryLoadVersionRef = React.useRef(0);
  const probeAbortRef = React.useRef<AbortController | null>(null);

  const parsedStun = React.useMemo(
    () => parseStunUrls(collabStunText),
    [collabStunText],
  );
  const sidecarUrlValidation = React.useMemo(
    () => validateSidecarBaseUrl(sidecarUrl),
    [sidecarUrl],
  );
  const fsSupported = React.useMemo(
    () => isFileSystemAccessSupported(),
    [],
  );
  const detectedLanguageName = getLocaleNativeName(detectBrowserLanguage());

  const handleCancel = React.useCallback(
    () => {
      applyLanguagePreference(currentSettings.language);
      onClose();
    },
    [currentSettings.language, onClose],
  );

  React.useEffect(
    () => {
      if (!isOpen) {
        directoryLoadVersionRef.current += 1;
        setIsLoadingDirectories(false);
        probeAbortRef.current?.abort();
        probeAbortRef.current = null;
        setIsProbingSidecar(false);
        return;
      }

      const snapshot = currentSettingsRef.current;
      setActiveTab(visibleTabs.includes(initialTab) ? initialTab : "general");
      setLanguage(snapshot.language);
      setStartupMode(snapshot.startupProjectMode);
      setDefaultFrequency(snapshot.defaultFrequency);
      setAudioVolume(snapshot.audioVolume);
      setAudioMuted(snapshot.audioMuted);
      setCollabStunText((snapshot.collabStunUrls ?? []).join("\n"));
      setCollabCursorIdleTimeoutSec(resolveCollabCursorIdleTimeoutSec(snapshot.collabCursorIdleTimeoutSec));
      setCollabCursorVisibilityMode(resolveCollabCursorVisibilityMode(snapshot.collabCursorVisibilityMode));
      setStoredParticipantColors(loadParticipantColorDictionary());
      setCollabDisplayName(loadCollabDisplayName());
      setCollabAccessKey(loadCollabAccessKey());
      setMcpAccessKey(loadMcpAccessKey());
      setSidecarUrl(loadSidecarBaseUrl());
      setProbeResult(null);
      setShowIdeConfig(initialShowIdeConfig);
      setCopiedIdeConfig(false);
      setDirectoryError(null);
      setIsLoadingDirectories(true);

      let cancelled = false;
      const loadVersion = directoryLoadVersionRef.current + 1;
      directoryLoadVersionRef.current = loadVersion;
      const isCurrentLoad = () => !cancelled && directoryLoadVersionRef.current === loadVersion;

      void listStoredDirectories()
        .then((list) => {
          if (isCurrentLoad()) {
            setDirectories(list);
          }
        })
        .catch(() => {
          if (isCurrentLoad()) {
            setDirectoryError(tRef.current("dialog.options.errorLoadDirectories"));
          }
        })
        .finally(() => {
          if (isCurrentLoad()) {
            setIsLoadingDirectories(false);
          }
        });

      return () => {
        cancelled = true;
        probeAbortRef.current?.abort();
        probeAbortRef.current = null;
      };
    },
    [
      initialShowIdeConfig,
      initialTab,
      isOpen,
      visibleTabs,
    ],
  );

  React.useEffect(
    () => {
      if (!copiedIdeConfig) {
        return undefined;
      }
      const timer = setTimeout(() => setCopiedIdeConfig(false), 2000);
      return () => clearTimeout(timer);
    },
    [copiedIdeConfig],
  );

  React.useEffect(
    () => {
      if (!isOpen) {
        return;
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          handleCancel();
        }
      };

      window.addEventListener("keydown", handleKeyDown, { capture: true });
      return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
    },
    [handleCancel, isOpen],
  );

  if (!isOpen) {
    return null;
  }

  const origin = typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : "https://circuit.example.com";
  const configBaseUrl = sidecarUrlValidation.ok && sidecarUrlValidation.normalizedUrl.length > 0
    ? sidecarUrlValidation.normalizedUrl
    : customSidecarRequired
      ? DEFAULT_LOCAL_SIDECAR_URL
      : origin;
  const mcpConfigJson = buildRemoteMcpConfigJson(configBaseUrl, mcpAccessKey.trim().length > 0);

  const handleCopyIdeConfig = () => {
    void copyTextToClipboard(mcpConfigJson).then((ok) => {
      if (ok) {
        setCopiedIdeConfig(true);
      }
    });
  };

  const handleLanguageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextLanguage = event.target.value as AppLanguage;
    setLanguage(nextLanguage);
    applyLanguagePreference(nextLanguage);
  };

  const handleDefaultFrequencyChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const raw = event.target.value;
    if (raw === "max") {
      setDefaultFrequency("max");
      return;
    }
    const parsed = Number(raw);
    if ((CLOCK_FREQUENCY_STEPS as readonly number[]).includes(parsed)) {
      setDefaultFrequency(parsed as FrameRateLimit);
    }
  };

  const handleAddDirectory = async () => {
    directoryLoadVersionRef.current += 1;
    setDirectoryError(null);
    try {
      const result = await pickAndAddProjectDirectory();
      setDirectories(result.directories);
      if (result.kind === "unsupported") {
        setDirectoryError(t("dialog.options.errorFsUnsupported"));
      }
    } catch (err) {
      setDirectoryError(
        err instanceof Error ? err.message : t("dialog.options.errorAddDirectory"),
      );
    } finally {
      setIsLoadingDirectories(false);
    }
  };

  const handleGrantDirectoryPermission = async (entry: StoredDirectoryWithPermission) => {
    directoryLoadVersionRef.current += 1;
    setDirectoryError(null);
    try {
      const status = await ensureDirectoryPermission(entry, "readwrite");
      const refreshed = await listStoredDirectories();
      setDirectories(refreshed);
      if (status !== "granted") {
        setDirectoryError(t("dialog.options.errorPermissionNotGranted", { name: entry.name }));
      }
    } catch (err) {
      setDirectoryError(
        err instanceof Error ? err.message : t("dialog.options.errorLoadDirectories"),
      );
    } finally {
      setIsLoadingDirectories(false);
    }
  };

  const handleSetDefaultDirectory = async (entry: StoredDirectoryWithPermission) => {
    directoryLoadVersionRef.current += 1;
    setDirectoryError(null);
    try {
      if (entry.permission === "prompt") {
        await ensureDirectoryPermission(entry, "readwrite");
      }
      const refreshed = await setDefaultProjectDirectory(entry.id);
      setDirectories(refreshed);
    } catch (err) {
      setDirectoryError(
        err instanceof Error ? err.message : t("dialog.options.errorLoadDirectories"),
      );
    } finally {
      setIsLoadingDirectories(false);
    }
  };

  const handleRemoveDirectory = async (id: string) => {
    directoryLoadVersionRef.current += 1;
    setDirectoryError(null);
    try {
      const refreshed = await removeProjectDirectory(id);
      setDirectories(refreshed);
    } catch (err) {
      setDirectoryError(
        err instanceof Error ? err.message : t("dialog.options.errorLoadDirectories"),
      );
    } finally {
      setIsLoadingDirectories(false);
    }
  };

  const handleProbeSidecar = async () => {
    if (!sidecarUrlValidation.ok) {
      return;
    }
    probeAbortRef.current?.abort();
    const controller = new AbortController();
    probeAbortRef.current = controller;
    setIsProbingSidecar(true);
    try {
      const result = await probeSidecarServer({
        baseUrl: sidecarUrl.trim(),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setProbeResult(result);
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsProbingSidecar(false);
      }
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setActiveTab(visibleTabs[(index + 1) % visibleTabs.length]);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActiveTab(visibleTabs[(index - 1 + visibleTabs.length) % visibleTabs.length]);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!collabDisabled && parsedStun.rejectedUrls.length > 0) {
      setActiveTab("collab");
      return;
    }
    if (sidecarTabVisible && !sidecarUrlValidation.ok) {
      setActiveTab("sidecar");
      return;
    }

    if (sidecarTabVisible) {
      saveSidecarBaseUrl(sidecarUrl);
    }
    if (!mcpDisabled) {
      saveMcpAccessKey(mcpAccessKey);
    }
    if (!collabDisabled) {
      saveCollabDisplayName(collabDisplayName);
      saveCollabAccessKey(collabAccessKey);
      saveParticipantColorDictionary(storedParticipantColors);
      collabContext?.reloadParticipantColors?.();
    }

    circuitContext?.updateAppSettings({
      startupProjectMode: startupMode,
      defaultFrequency,
      language,
      audioVolume,
      audioMuted,
      ...(collabDisabled
        ? {}
        : {
          collabStunUrls: parsedStun.validUrls.length > 0 ? parsedStun.validUrls : undefined,
          collabCursorIdleTimeoutSec,
          collabCursorVisibilityMode,
        }),
    });
    onClose();
  };

  const tabLabels: Record<OptionsDialogTab, string> = {
    general: t("dialog.options.tabs.general"),
    directories: t("dialog.options.tabs.directories"),
    collab: t("dialog.options.tabs.collab"),
    sidecar: t("dialog.options.tabs.sidecar"),
  };

  const renderAuthLabel = (authRequired: boolean | null): string => {
    if (authRequired === true) {
      return t("dialog.options.sidecarProbeAuthYes");
    }
    if (authRequired === false) {
      return t("dialog.options.sidecarProbeAuthNo");
    }
    return t("dialog.options.sidecarProbeAuthUnknown");
  };

  const sortedStoredColorEntries = Object.entries(storedParticipantColors).sort(([keyA], [keyB]) =>
    formatStoredParticipantDisplayName(keyA).localeCompare(
      formatStoredParticipantDisplayName(keyB),
      undefined,
      { sensitivity: "base" },
    ),
  );

  const modalContent = (
    <div
      {...other}
      data-component="OptionsDialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="options-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleCancel();
        }
      }}
    >
      <form className="modal-card" onSubmit={handleSubmit}>
        <div className="modal-header">
          <h2 id="options-dialog-title" className="modal-title">{t("dialog.options.title")}</h2>
          <button
            type="button"
            className="close-btn"
            aria-label={t("common.closeDialog")}
            onClick={handleCancel}
          >
            ✕
          </button>
        </div>

        <div className="tab-bar" role="tablist" aria-label={t("dialog.options.tabs.tablistAriaLabel")}>
          {visibleTabs.map((tabId, index) => {
            const isSelected = activeTab === tabId;
            return (
              <button
                key={tabId}
                id={`options-tab-${tabId}`}
                data-testid={`options-tab-${tabId}`}
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-controls={`options-panel-${tabId}`}
                tabIndex={isSelected ? 0 : -1}
                className={`tab-button${isSelected ? " active" : ""}`}
                onClick={() => setActiveTab(tabId)}
                onKeyDown={(e) => handleTabKeyDown(e, index)}
              >
                {tabLabels[tabId]}
              </button>
            );
          })}
        </div>

        <div className="modal-body">
          <div
            role="tabpanel"
            id="options-panel-general"
            aria-labelledby="options-tab-general"
            className="tab-panel"
            hidden={activeTab !== "general"}
          >
            <div className="form-group">
              <label htmlFor="options-language" className="field-label">
                {t("dialog.options.languageLabel")}
              </label>
              <select
                id="options-language"
                className="select-input"
                value={language}
                onChange={handleLanguageChange}
              >
                <option value={AUTO_LANGUAGE}>
                  {t("dialog.options.languageAuto", { language: detectedLanguageName })}
                </option>
                {AVAILABLE_LANGUAGES.map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.nativeName}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                {t("dialog.options.languageHint")}
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="options-startup-mode" className="field-label">
                {t("dialog.options.startupModeLabel")}
              </label>
              <select
                id="options-startup-mode"
                className="select-input"
                value={startupMode}
                onChange={(e) => setStartupMode(e.target.value as StartupProjectMode)}
              >
                <option value="demo">{t("dialog.options.startupModeDemo")}</option>
                <option value="empty">{t("dialog.options.startupModeEmpty")}</option>
                <option value="last">{t("dialog.options.startupModeLast")}</option>
              </select>
              <span className="field-hint">
                {t("dialog.options.startupModeHint")}
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="options-default-frequency" className="field-label">
                {t("dialog.options.defaultFrequencyLabel")}
              </label>
              <select
                id="options-default-frequency"
                className="select-input"
                value={String(defaultFrequency)}
                onChange={handleDefaultFrequencyChange}
              >
                {CLOCK_FREQUENCY_STEPS.map((hz) => (
                  <option key={hz} value={String(hz)}>
                    {t("dialog.options.frequencyValue", { hz })}
                  </option>
                ))}
                <option value="max">{t("dialog.options.frequencyMaximum")}</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="options-audio-volume" className="field-label">
                {t("dialog.options.audioVolumeLabel")}
              </label>
              <div className="volume-row">
                <input
                  id="options-audio-volume"
                  data-testid="options-audio-volume"
                  className="range-input"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={audioVolume}
                  onChange={(e) => setAudioVolume(Number(e.target.value))}
                />
                <span className="volume-value">{audioVolume} %</span>
              </div>
              <label className="checkbox-row" htmlFor="options-audio-muted">
                <input
                  id="options-audio-muted"
                  data-testid="options-audio-muted"
                  type="checkbox"
                  checked={audioMuted}
                  onChange={(e) => setAudioMuted(e.target.checked)}
                />
                <span>{t("dialog.options.audioMutedLabel")}</span>
              </label>
            </div>
          </div>

          <div
            role="tabpanel"
            id="options-panel-directories"
            aria-labelledby="options-tab-directories"
            className="tab-panel"
            hidden={activeTab !== "directories"}
          >
            <div className="form-group">
              <div className="directory-header">
                <span className="field-label">{t("dialog.options.directoriesLabel")}</span>
                <button
                  type="button"
                  className="btn-inline"
                  disabled={!fsSupported}
                  onClick={() => { void handleAddDirectory(); }}
                >
                  {t("dialog.options.addDirectory")}
                </button>
              </div>

              {!fsSupported && (
                <div className="fallback-notice" data-testid="fs-unsupported-notice">
                  {t("dialog.options.fsUnsupportedNotice")}
                </div>
              )}

              {isLoadingDirectories ? (
                <div className="empty-directories">{t("dialog.options.loadingDirectories")}</div>
              ) : directories.length === 0 ? (
                <div className="empty-directories">
                  {t("dialog.options.emptyDirectories")}
                </div>
              ) : (
                <>
                  <span className="field-hint">
                    {t("dialog.options.directoriesCount", { count: directories.length })}
                  </span>
                  <ul className="directory-list">
                    {directories.map((entry) => (
                      <li key={entry.id} className="directory-item">
                        <div className="directory-meta">
                          <span className="directory-name">{entry.name}</span>
                          <div className="directory-badges">
                            {entry.isDefault && (
                              <span className="badge badge-default">{t("common.default")}</span>
                            )}
                            <span className={`badge badge-perm perm-${entry.permission}`}>
                              {formatPermissionLabel(entry.permission, t)}
                            </span>
                          </div>
                        </div>

                        <div className="directory-actions">
                          {entry.permission !== "granted" && (
                            <button
                              type="button"
                              className="btn-small"
                              onClick={() => { void handleGrantDirectoryPermission(entry); }}
                            >
                              {t("dialog.options.grantPermission")}
                            </button>
                          )}
                          {!entry.isDefault && (
                            <button
                              type="button"
                              className="btn-small"
                              onClick={() => { void handleSetDefaultDirectory(entry); }}
                            >
                              {t("dialog.options.setAsDefault")}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-small btn-small-danger"
                            onClick={() => { void handleRemoveDirectory(entry.id); }}
                          >
                            {t("common.remove")}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {directoryError && (
                <span className="error-text" role="alert">{directoryError}</span>
              )}
            </div>
          </div>

          {!collabDisabled && (
            <div
              role="tabpanel"
              id="options-panel-collab"
              aria-labelledby="options-tab-collab"
              className="tab-panel"
              hidden={activeTab !== "collab"}
            >
              <div className="form-group">
                <label htmlFor="options-collab-display-name" className="field-label">
                  {t("dialog.options.collabDisplayNameLabel")}
                </label>
                <div className="key-input-row">
                  <input
                    id="options-collab-display-name"
                    data-testid="options-collab-display-name"
                    type="text"
                    className="text-input"
                    maxLength={MAX_COLLAB_DISPLAY_NAME_LENGTH}
                    placeholder={t("dialog.options.collabDisplayNamePlaceholder")}
                    value={collabDisplayName}
                    onChange={(e) => setCollabDisplayName(e.target.value)}
                  />
                  {collabDisplayName.trim().length > 0 && (
                    <button
                      type="button"
                      className="btn-inline"
                      data-testid="options-collab-clear-display-name"
                      onClick={() => setCollabDisplayName("")}
                    >
                      {t("dialog.options.collabDisplayNameClearButton")}
                    </button>
                  )}
                </div>
                <span className="field-hint">
                  {t("dialog.options.collabDisplayNameHint")}
                </span>
              </div>

              <div className="form-group">
                <label htmlFor="options-collab-cursor-idle" className="field-label">
                  {t("dialog.options.collabCursorIdleLabel")}
                </label>
                <select
                  id="options-collab-cursor-idle"
                  data-testid="options-collab-cursor-idle"
                  className="select-input"
                  value={collabCursorIdleTimeoutSec}
                  onChange={(e) => setCollabCursorIdleTimeoutSec(resolveCollabCursorIdleTimeoutSec(Number(e.target.value)))}
                >
                  {COLLAB_CURSOR_IDLE_TIMEOUT_OPTIONS.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds === 0
                        ? t("dialog.options.collabCursorIdleNever")
                        : t("dialog.options.collabCursorIdleSeconds", { seconds })}
                    </option>
                  ))}
                </select>
                <span className="field-hint">
                  {t("dialog.options.collabCursorIdleHint")}
                </span>
              </div>

              <div className="form-group">
                <label htmlFor="options-collab-cursor-visibility" className="field-label">
                  {t("dialog.options.collabCursorVisibilityLabel")}
                </label>
                <select
                  id="options-collab-cursor-visibility"
                  data-testid="options-collab-cursor-visibility"
                  className="select-input"
                  value={collabCursorVisibilityMode}
                  onChange={(e) => setCollabCursorVisibilityMode(resolveCollabCursorVisibilityMode(e.target.value))}
                >
                  {COLLAB_CURSOR_VISIBILITY_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(getCursorVisibilityModeTranslationKey(mode))}
                    </option>
                  ))}
                </select>
                <span className="field-hint">
                  {t("dialog.options.collabCursorVisibilityHint")}
                </span>
              </div>

              <div className="form-group" data-testid="options-collab-colors-section">
                <div className="directory-header">
                  <span className="field-label">{t("dialog.options.collabColorsLabel")}</span>
                  {sortedStoredColorEntries.length > 0 && (
                    <button
                      type="button"
                      className="btn-inline"
                      data-testid="options-collab-clear-colors"
                      onClick={() => setStoredParticipantColors({})}
                    >
                      {t("dialog.options.collabColorsClearAllButton")}
                    </button>
                  )}
                </div>
                {sortedStoredColorEntries.length === 0 ? (
                  <div className="empty-directories" data-testid="options-collab-colors-empty">
                    {t("dialog.options.collabColorsEmpty")}
                  </div>
                ) : (
                  <ul className="saved-colors-list" data-testid="options-collab-colors-list">
                    {sortedStoredColorEntries.map(([nameKey, hexColor]) => {
                      const formattedName = formatStoredParticipantDisplayName(nameKey);
                      return (
                        <li
                          key={nameKey}
                          className="saved-color-row"
                          data-testid={`options-collab-color-row-${nameKey}`}
                        >
                          <div className="saved-color-identity">
                            <input
                              type="color"
                              className="saved-color-input"
                              data-testid={`options-collab-color-input-${nameKey}`}
                              aria-label={t("dialog.options.collabColorsInputAriaLabel", { name: formattedName })}
                              value={hexColor}
                              onChange={(event) => {
                                const normalized = normalizeHexColor(event.target.value);
                                if (!normalized) {
                                  return;
                                }
                                setStoredParticipantColors((prev) => ({
                                  ...prev,
                                  [nameKey]: normalized,
                                }));
                              }}
                            />
                            <span className="saved-color-name">{formattedName}</span>
                          </div>
                          <button
                            type="button"
                            className="saved-color-delete-btn"
                            data-testid={`options-collab-color-delete-${nameKey}`}
                            aria-label={t("dialog.options.collabColorsDeleteAriaLabel", { name: formattedName })}
                            onClick={() => {
                              setStoredParticipantColors((prev) => {
                                const next = { ...prev };
                                delete next[nameKey];
                                return next;
                              });
                            }}
                          >
                            ×
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <span className="field-hint">
                  {t("dialog.options.collabColorsHint")}
                </span>
              </div>

              <div className="form-group collab-section" data-testid="options-collab-section">
                <div className="directory-header">
                  <label htmlFor="options-collab-stun-urls" className="field-label">
                    {t("dialog.options.collabStunLabel")}
                  </label>
                  <button
                    type="button"
                    className="btn-inline"
                    data-testid="options-collab-reset-stun"
                    onClick={() => setCollabStunText("")}
                  >
                    {t("dialog.options.collabResetStunButton")}
                  </button>
                </div>
                <textarea
                  id="options-collab-stun-urls"
                  data-testid="options-collab-stun-urls"
                  className="text-area-input"
                  rows={2}
                  placeholder={DEFAULT_COLLAB_STUN_URLS.join("\n")}
                  value={collabStunText}
                  onChange={(e) => setCollabStunText(e.target.value)}
                />
                <span className="field-hint">
                  {t("dialog.options.collabStunHint")}
                </span>
                {parsedStun.hasTurnUrls && (
                  <span className="warning-text" role="status" data-testid="options-collab-turn-warning">
                    {t("dialog.options.collabTurnNotSupportedWarning")}
                  </span>
                )}
                {parsedStun.rejectedUrls.length > 0 && !parsedStun.hasTurnUrls && (
                  <span className="error-text" role="alert" data-testid="options-collab-stun-error">
                    {t("dialog.options.collabStunInvalidError", {
                      urls: parsedStun.rejectedUrls.join(", "),
                    })}
                  </span>
                )}
              </div>
            </div>
          )}

          {sidecarTabVisible && (
            <div
              role="tabpanel"
              id="options-panel-sidecar"
              aria-labelledby="options-tab-sidecar"
              className="tab-panel"
              hidden={activeTab !== "sidecar"}
            >
              <div className="form-group" data-testid="options-sidecar-section">
                <div className="directory-header">
                  <label htmlFor="options-sidecar-url" className="field-label">
                    {t("dialog.options.sidecarUrlLabel")}
                  </label>
                  <button
                    type="button"
                    className="btn-inline"
                    data-testid="options-sidecar-localhost-btn"
                    onClick={() => {
                      setSidecarUrl(DEFAULT_LOCAL_SIDECAR_URL);
                      setProbeResult(null);
                    }}
                  >
                    {t("dialog.options.sidecarUrlLocalhostButton")}
                  </button>
                </div>
                <div className="key-input-row">
                  <input
                    id="options-sidecar-url"
                    data-testid="options-sidecar-url"
                    type="url"
                    className="text-input"
                    placeholder={t("dialog.options.sidecarUrlPlaceholder")}
                    value={sidecarUrl}
                    onChange={(e) => {
                      setSidecarUrl(e.target.value);
                      setProbeResult(null);
                    }}
                  />
                  {sidecarUrl.trim().length > 0 && (
                    <button
                      type="button"
                      className="btn-inline"
                      data-testid="options-sidecar-clear-url"
                      onClick={() => {
                        setSidecarUrl("");
                        clearSidecarBaseUrl();
                        setProbeResult(null);
                      }}
                    >
                      {t("dialog.options.sidecarUrlClearButton")}
                    </button>
                  )}
                </div>
                <span className="field-hint">
                  {customSidecarRequired
                    ? t("dialog.options.sidecarUrlRequiredHint")
                    : t("dialog.options.sidecarUrlHint")}
                </span>
                {!sidecarUrlValidation.ok && sidecarUrlValidation.error && (
                  <span className="error-text" role="alert" data-testid="options-sidecar-url-error">
                    {sidecarUrlValidation.error}
                  </span>
                )}
                {sidecarUrlValidation.ok && sidecarUrlValidation.status === "valid-localhost" && (
                  <span className="field-hint" data-testid="options-sidecar-localhost-hint">
                    {t("dialog.options.sidecarUrlLocalhostHint")}
                  </span>
                )}
              </div>

              {!mcpDisabled && (
                <div className="form-group">
                  <label htmlFor="options-mcp-access-key" className="field-label">
                    {t("dialog.options.mcpAccessKeyLabel")}
                  </label>
                  <div className="key-input-row">
                    <input
                      id="options-mcp-access-key"
                      data-testid="options-mcp-access-key"
                      type="password"
                      className="text-input"
                      placeholder={t("dialog.options.mcpAccessKeyPlaceholder")}
                      value={mcpAccessKey}
                      onChange={(e) => setMcpAccessKey(e.target.value)}
                    />
                    {mcpAccessKey.trim().length > 0 && (
                      <button
                        type="button"
                        className="btn-inline"
                        data-testid="options-mcp-clear-key"
                        onClick={() => {
                          setMcpAccessKey("");
                          clearMcpAccessKey();
                        }}
                      >
                        {t("dialog.options.collabClearAccessKeyButton")}
                      </button>
                    )}
                  </div>
                  <span className="field-hint">
                    {t("dialog.options.mcpAccessKeyHint")}
                  </span>
                </div>
              )}

              {!collabDisabled && (
                <div className="form-group">
                  <label htmlFor="options-collab-access-key" className="field-label">
                    {t("dialog.options.collabAccessKeyLabel")}
                  </label>
                  <div className="key-input-row">
                    <input
                      id="options-collab-access-key"
                      data-testid="options-collab-access-key"
                      type="password"
                      className="text-input"
                      placeholder={t("dialog.options.collabAccessKeyPlaceholder")}
                      value={collabAccessKey}
                      onChange={(e) => setCollabAccessKey(e.target.value)}
                    />
                    {collabAccessKey.trim().length > 0 && (
                      <button
                        type="button"
                        className="btn-inline"
                        data-testid="options-collab-clear-key"
                        onClick={() => {
                          setCollabAccessKey("");
                          clearCollabAccessKey();
                        }}
                      >
                        {t("dialog.options.collabClearAccessKeyButton")}
                      </button>
                    )}
                  </div>
                  <span className="field-hint">
                    {t("dialog.options.collabAccessKeyHint")}
                  </span>
                </div>
              )}

              <div className="form-group">
                <div className="sidecar-actions-row">
                  <button
                    type="button"
                    className="btn-inline"
                    data-testid="options-sidecar-test-btn"
                    disabled={isProbingSidecar || !sidecarUrlValidation.ok}
                    onClick={() => { void handleProbeSidecar(); }}
                  >
                    {isProbingSidecar ? t("dialog.options.sidecarTestingButton") : t("dialog.options.sidecarTestButton")}
                  </button>
                  {!mcpDisabled && (
                    <button
                      type="button"
                      className="btn-inline"
                      data-testid="options-ide-config-toggle-btn"
                      aria-expanded={showIdeConfig}
                      onClick={() => setShowIdeConfig((prev) => !prev)}
                    >
                      {showIdeConfig ? t("dialog.options.hideIdeConfigButton") : t("dialog.options.showIdeConfigButton")}
                    </button>
                  )}
                  {onOpenSidecarDownload && (
                    <button
                      type="button"
                      className="btn-inline btn-inline-end"
                      data-testid="options-sidecar-download-btn"
                      onClick={onOpenSidecarDownload}
                    >
                      {t("dialog.options.sidecarDownloadButton")}
                    </button>
                  )}
                </div>

                {!mcpDisabled && showIdeConfig && (
                  <div className="ide-config-card" data-testid="options-ide-config-section">
                    <span className="field-hint">{t("dialog.options.ideConfigLabel")}</span>
                    <pre className="ide-config-preview" data-testid="options-ide-config-preview">{mcpConfigJson}</pre>
                    <button
                      type="button"
                      className="btn-inline copy-btn"
                      data-testid="options-ide-config-copy-btn"
                      onClick={handleCopyIdeConfig}
                    >
                      {copiedIdeConfig ? t("dialog.options.ideConfigCopied") : t("dialog.options.copyIdeConfigButton")}
                    </button>
                  </div>
                )}

                {probeResult && (
                  <div
                    className={`probe-card ${probeResult.reachable ? "reachable" : "unreachable"}`}
                    role="status"
                    data-testid="options-sidecar-probe-result"
                  >
                    <div className="probe-title">
                      {probeResult.reachable
                        ? t("dialog.options.sidecarProbeReachable", { url: probeResult.resolvedBaseUrl ?? "" })
                        : t("dialog.options.sidecarProbeUnreachable")}
                    </div>
                    {probeResult.reachable && (
                      <div className="probe-meta">
                        <span>
                          {t("dialog.options.sidecarProbeVersion", {
                            version: probeResult.serverVersion ?? t("dialog.options.sidecarProbeAuthUnknown"),
                          })}
                        </span>
                        <span>
                          {t("dialog.options.sidecarProbeAuthMcp", {
                            status: renderAuthLabel(probeResult.mcpAuthRequired),
                          })}
                          {" · "}
                          {t("dialog.options.sidecarProbeAuthCollab", {
                            status: renderAuthLabel(probeResult.collabAuthRequired),
                          })}
                        </span>
                        <span>
                          {probeResult.versionCheck.relation === "compatible"
                            ? t("dialog.options.sidecarVersionCompatible", {
                              clientVersion: probeResult.versionCheck.clientVersion,
                            })
                            : probeResult.versionCheck.relation === "server-outdated"
                              ? t("dialog.options.sidecarVersionOutdated", {
                                serverVersion: probeResult.versionCheck.serverVersion ?? "?",
                                clientVersion: probeResult.versionCheck.clientVersion,
                              })
                              : probeResult.versionCheck.relation === "client-outdated"
                                ? t("dialog.options.sidecarVersionClientOutdated", {
                                  serverVersion: probeResult.versionCheck.serverVersion ?? "?",
                                  clientVersion: probeResult.versionCheck.clientVersion,
                                })
                                : t("dialog.options.sidecarVersionUnknown")}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={handleCancel}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn-primary">
            {t("common.apply")}
          </button>
        </div>
      </form>
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
    maxWidth: "34rem",
    maxHeight: "90vh",
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

    "& > .tab-bar": {
      display: "flex",
      alignItems: "center",
      gap: "0.25rem",
      padding: "0 1.15rem",
      backgroundColor: "var(--color-bg-elevated)",
      borderBottom: "1px solid var(--color-border-subtle)",
      overflowX: "auto",

      "& > .tab-button": {
        padding: "0.55rem 0.75rem",
        background: "transparent",
        border: "none",
        borderBottom: "2px solid transparent",
        color: "var(--color-text-secondary)",
        fontSize: "0.8rem",
        fontWeight: 500,
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "color 0.12s ease, border-color 0.12s ease",

        "&:hover": {
          color: "var(--color-text-primary)",
        },

        "&.active": {
          color: "var(--color-accent-primary)",
          borderBottomColor: "var(--color-accent-primary)",
          fontWeight: 600,
        },
      },
    },

    "& > .modal-body": {
      padding: "1.15rem",
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      gap: "1rem",

      "& > .tab-panel": {
        display: "flex",
        flexDirection: "column",
        gap: "1rem",

        "&[hidden]": {
          display: "none",
        },

        "& > .form-group": {
          display: "flex",
          flexDirection: "column",
          gap: "0.4rem",

          "& .field-label": {
            fontSize: "0.82rem",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          },

          "& > .select-input": {
            width: "100%",
            boxSizing: "border-box",
            padding: "0.45rem 0.65rem",
            backgroundColor: "var(--color-bg-base)",
            color: "var(--color-text-primary)",
            border: "1px solid var(--color-border-strong)",
            borderRadius: "0.3rem",
            fontSize: "0.85rem",

            "&:focus": {
              outline: "none",
              borderColor: "var(--color-accent-primary)",
            },
          },

          "& > .field-hint": {
            fontSize: "0.75rem",
            lineHeight: 1.4,
            color: "var(--color-text-muted)",
          },

          "& > .volume-row": {
            display: "flex",
            alignItems: "center",
            gap: "0.65rem",

            "& > .range-input": {
              flex: 1,
              accentColor: "var(--color-accent-primary)",
              cursor: "pointer",
            },

            "& > .volume-value": {
              minWidth: "2.8rem",
              textAlign: "right",
              fontSize: "0.8rem",
              fontWeight: 600,
              color: "var(--color-text-secondary)",
            },
          },

          "& > .checkbox-row": {
            display: "flex",
            alignItems: "center",
            gap: "0.45rem",
            fontSize: "0.8rem",
            color: "var(--color-text-primary)",
            cursor: "pointer",
            marginTop: "0.15rem",
          },

          "& > .directory-header": {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.5rem",

            "& > .btn-inline": {
              padding: "0.28rem 0.6rem",
              backgroundColor: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.25rem",
              color: "var(--color-text-primary)",
              fontSize: "0.75rem",
              fontWeight: 500,
              cursor: "pointer",

              "&:hover:not(:disabled)": {
                borderColor: "var(--color-accent-primary)",
                color: "var(--color-accent-primary)",
              },

              "&:disabled": {
                opacity: 0.45,
                cursor: "not-allowed",
              },
            },
          },

          "& > .fallback-notice": {
            padding: "0.55rem 0.7rem",
            borderRadius: "0.3rem",
            backgroundColor: "var(--color-warning-bg)",
            border: "1px solid var(--color-warning-border)",
            color: "var(--color-text-secondary)",
            fontSize: "0.75rem",
            lineHeight: 1.4,
          },

          "& > .empty-directories": {
            padding: "0.65rem 0.75rem",
            backgroundColor: "var(--color-bg-base)",
            border: "1px dashed var(--color-border-subtle)",
            borderRadius: "0.3rem",
            fontSize: "0.78rem",
            color: "var(--color-text-muted)",
            lineHeight: 1.4,
          },

          "& > .directory-list": {
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0.45rem",

            "& > .directory-item": {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.6rem",
              padding: "0.5rem 0.65rem",
              backgroundColor: "var(--color-bg-base)",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: "0.3rem",

              "& > .directory-meta": {
                display: "flex",
                flexDirection: "column",
                gap: "0.2rem",
                minWidth: 0,

                "& > .directory-name": {
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                },

                "& > .directory-badges": {
                  display: "flex",
                  alignItems: "center",
                  gap: "0.35rem",

                  "& > .badge": {
                    fontSize: "0.68rem",
                    padding: "0.08rem 0.4rem",
                    borderRadius: "0.2rem",
                    border: "1px solid var(--color-border-subtle)",

                    "&.badge-default": {
                      color: "var(--color-accent-primary)",
                      borderColor: "var(--color-accent-primary)",
                    },

                    "&.badge-perm.perm-granted": {
                      color: "var(--color-status-running)",
                      borderColor: "var(--color-success-border)",
                    },

                    "&.badge-perm.perm-prompt": {
                      color: "var(--color-warning)",
                      borderColor: "var(--color-warning-border)",
                    },

                    "&.badge-perm.perm-denied": {
                      color: "var(--color-status-stopped)",
                      borderColor: "var(--color-error-border)",
                    },
                  },
                },
              },

              "& > .directory-actions": {
                display: "flex",
                alignItems: "center",
                gap: "0.35rem",
                flexShrink: 0,

                "& > .btn-small": {
                  padding: "0.22rem 0.5rem",
                  fontSize: "0.73rem",
                  backgroundColor: "var(--color-bg-surface)",
                  color: "var(--color-text-secondary)",
                  border: "1px solid var(--color-border-strong)",
                  borderRadius: "0.25rem",
                  cursor: "pointer",

                  "&:hover": {
                    color: "var(--color-text-primary)",
                    borderColor: "var(--color-text-secondary)",
                  },

                  "&.btn-small-danger:hover": {
                    color: "var(--color-status-stopped)",
                    borderColor: "var(--color-status-stopped)",
                  },
                },
              },
            },
          },

          "& > .error-text": {
            fontSize: "0.75rem",
            color: "var(--color-status-stopped)",
          },

          "& > .saved-colors-list": {
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0.35rem",
            maxHeight: "10rem",
            overflowY: "auto",

            "& > .saved-color-row": {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
              padding: "0.35rem 0.55rem",
              backgroundColor: "var(--color-bg-base)",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: "0.25rem",

              "& > .saved-color-identity": {
                display: "flex",
                alignItems: "center",
                gap: "0.55rem",
                minWidth: 0,

                "& > .saved-color-input": {
                  width: "1.85rem",
                  height: "1.3rem",
                  padding: 0,
                  border: "1px solid var(--color-border-strong)",
                  borderRadius: "0.2rem",
                  background: "transparent",
                  cursor: "pointer",
                  flexShrink: 0,
                },

                "& > .saved-color-name": {
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                },
              },

              "& > .saved-color-delete-btn": {
                flexShrink: 0,
                padding: "0.1rem 0.45rem",
                backgroundColor: "var(--color-bg-surface)",
                border: "1px solid var(--color-border-strong)",
                borderRadius: "0.25rem",
                color: "var(--color-text-secondary)",
                fontSize: "0.9rem",
                lineHeight: 1.2,
                cursor: "pointer",

                "&:hover": {
                  color: "var(--color-status-stopped)",
                  borderColor: "var(--color-status-stopped)",
                },
              },
            },
          },

          "& > .warning-text": {
            fontSize: "0.75rem",
            color: "var(--color-warning)",
          },

          "& > .text-area-input": {
            width: "100%",
            boxSizing: "border-box",
            padding: "0.45rem 0.65rem",
            backgroundColor: "var(--color-bg-base)",
            color: "var(--color-text-primary)",
            border: "1px solid var(--color-border-strong)",
            borderRadius: "0.3rem",
            fontFamily: "var(--font-family-mono)",
            fontSize: "0.78rem",
            resize: "vertical",

            "&:focus": {
              outline: "none",
              borderColor: "var(--color-accent-primary)",
            },
          },

          "& > .key-input-row": {
            display: "flex",
            alignItems: "center",
            gap: "0.45rem",

            "& > .text-input": {
              flex: 1,
              minWidth: 0,
              boxSizing: "border-box",
              padding: "0.4rem 0.6rem",
              backgroundColor: "var(--color-bg-base)",
              color: "var(--color-text-primary)",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.3rem",
              fontFamily: "var(--font-family-mono)",
              fontSize: "0.8rem",

              "&:focus": {
                outline: "none",
                borderColor: "var(--color-accent-primary)",
              },
            },

            "& > .btn-inline": {
              padding: "0.35rem 0.6rem",
              backgroundColor: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.25rem",
              color: "var(--color-text-primary)",
              fontSize: "0.75rem",
              fontWeight: 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
            },
          },

          "& > .probe-card": {
            padding: "0.6rem 0.75rem",
            borderRadius: "0.3rem",
            border: "1px solid var(--color-border-subtle)",
            backgroundColor: "var(--color-bg-base)",
            fontSize: "0.78rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.3rem",

            "&.reachable": {
              borderColor: "var(--color-success-border)",
            },

            "&.unreachable": {
              borderColor: "var(--color-error-border)",
            },

            "& > .probe-title": {
              fontWeight: 600,
              color: "var(--color-text-primary)",
            },

            "& > .probe-meta": {
              display: "flex",
              flexDirection: "column",
              gap: "0.2rem",
              color: "var(--color-text-secondary)",
              fontSize: "0.74rem",
            },
          },

          "& > .sidecar-actions-row": {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "0.5rem",

            "& > .btn-inline": {
              padding: "0.28rem 0.6rem",
              backgroundColor: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.25rem",
              color: "var(--color-text-primary)",
              fontSize: "0.75rem",
              fontWeight: 500,
              cursor: "pointer",

              "&:hover:not(:disabled)": {
                borderColor: "var(--color-accent-primary)",
                color: "var(--color-accent-primary)",
              },

              "&:disabled": {
                opacity: 0.45,
                cursor: "not-allowed",
              },

              "&.btn-inline-end": {
                marginLeft: "auto",
              },
            },
          },

          "& > .ide-config-card": {
            padding: "0.6rem 0.75rem",
            borderRadius: "0.3rem",
            border: "1px solid var(--color-border-subtle)",
            backgroundColor: "var(--color-bg-base)",
            display: "flex",
            flexDirection: "column",
            gap: "0.45rem",
            userSelect: "text",

            "& > .field-hint": {
              fontSize: "0.74rem",
              color: "var(--color-text-secondary)",
            },

            "& > .ide-config-preview": {
              margin: 0,
              padding: "0.45rem 0.55rem",
              borderRadius: "0.25rem",
              border: "1px solid var(--color-border-subtle)",
              backgroundColor: "var(--color-bg-surface)",
              fontFamily: "var(--font-family-mono)",
              fontSize: "0.72rem",
              overflowX: "auto",
            },

            "& > .copy-btn": {
              alignSelf: "flex-start",
              padding: "0.28rem 0.6rem",
              backgroundColor: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.25rem",
              color: "var(--color-text-primary)",
              fontSize: "0.75rem",
              fontWeight: 500,
              cursor: "pointer",

              "&:hover": {
                borderColor: "var(--color-accent-primary)",
                color: "var(--color-accent-primary)",
              },
            },
          },

          "&.collab-section": {
            paddingTop: 0,
          },
        },
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
      },
    },
  },
});

export default OptionsDialog;
