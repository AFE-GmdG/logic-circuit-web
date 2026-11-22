import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CircuitContext from "../../contexts/circuitContext";

import type AppLanguage from "../../types/settings/appLanguage";
import type StartupProjectMode from "../../types/settings/startupProjectMode";
import type FrameRateLimit from "../../types/simulation/frameRateLimit";

import {
  applyLanguagePreference,
  AUTO_LANGUAGE,
  AVAILABLE_LANGUAGES,
  detectBrowserLanguage,
  getLocaleNativeName,
} from "../../i18n";
import { DEFAULT_APP_SETTINGS } from "../../utils/appSettingsStorage";
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
import { CLOCK_FREQUENCY_STEPS } from "../../utils/simulationSpeed";

export type OptionsDialogProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  onClose: () => void;
};

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

// Modaler Systemeinstellungen-Dialog (DialogOptions) für Sprache, Startverhalten, Standard-Taktfrequenz und Projektverzeichnisse
const OptionsDialog = styled(({
  isOpen,
  onClose,
  ...other
}: OptionsDialogProps) => {
  const { t } = useTranslation();
  const circuitContext = React.useContext(CircuitContext);
  const currentSettings = circuitContext?.appSettings ?? DEFAULT_APP_SETTINGS;
  const currentSettingsRef = React.useRef(currentSettings);
  currentSettingsRef.current = currentSettings;
  const tRef = React.useRef(t);
  tRef.current = t;

  const [language, setLanguage] = React.useState<AppLanguage>(currentSettings.language);
  const [startupMode, setStartupMode] = React.useState<StartupProjectMode>(currentSettings.startupProjectMode);
  const [defaultFrequency, setDefaultFrequency] = React.useState<FrameRateLimit>(currentSettings.defaultFrequency);
  const [audioVolume, setAudioVolume] = React.useState<number>(currentSettings.audioVolume);
  const [audioMuted, setAudioMuted] = React.useState<boolean>(currentSettings.audioMuted);
  const [directories, setDirectories] = React.useState<StoredDirectoryWithPermission[]>([]);
  const [isLoadingDirectories, setIsLoadingDirectories] = React.useState(false);
  const [directoryError, setDirectoryError] = React.useState<string | null>(null);

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
        return;
      }

      const snapshot = currentSettingsRef.current;
      setLanguage(snapshot.language);
      setStartupMode(snapshot.startupProjectMode);
      setDefaultFrequency(snapshot.defaultFrequency);
      setAudioVolume(snapshot.audioVolume);
      setAudioMuted(snapshot.audioMuted);
      setDirectoryError(null);
      setIsLoadingDirectories(true);

      let cancelled = false;
      void listStoredDirectories()
        .then((list) => {
          if (!cancelled) {
            setDirectories(list);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setDirectoryError(tRef.current("dialog.options.errorLoadDirectories"));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsLoadingDirectories(false);
          }
        });

      return () => {
        cancelled = true;
      };
    },
    [isOpen],
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

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    circuitContext?.updateAppSettings({
      startupProjectMode: startupMode,
      defaultFrequency,
      language,
      audioVolume,
      audioMuted,
    });
    onClose();
  };

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

        <div className="modal-body">
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

    "& > .modal-body": {
      padding: "1.15rem",
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      gap: "1rem",

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
