import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CircuitContext from "../../contexts/circuitContext";

import type {
  HdlExportLanguage,
  HdlExportScope,
  HdlGeneratedFile,
} from "../../types/hdl/hdlExportTypes";

import { triggerBlobDownload } from "../../utils/circuitCapture";
import {
  exportTextFilesToDirectory,
  getDefaultDirectoryHandle,
  isDirectoryPickerSupported,
} from "../../utils/fileSystemStorage";
import { exportHdl } from "../../utils/hdl/exportHdl";

export type ExportHdlDialogProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  onClose: () => void;
  initialLanguage?: HdlExportLanguage;
  initialScope?: HdlExportScope;
  initialExportTests?: boolean;
};

function getFileKindBadgeKey(kind: HdlGeneratedFile["kind"]): string {
  switch (kind) {
    case "module":
      return "dialog.exportHdl.tabKindModule";
    case "testbench":
      return "dialog.exportHdl.tabKindTestbench";
    case "compare":
      return "dialog.exportHdl.tabKindCompare";
  }
}

// Modaler HDL-Export-Dialog (DialogExportHdl) mit Live-Vorschau, Diagnose-Log und Ordner-/Datei-Export
const ExportHdlDialog = styled(({
  isOpen,
  onClose,
  initialLanguage = "verilog",
  initialScope = "currentWithSubcircuits",
  initialExportTests = false,
  ...other
}: ExportHdlDialogProps) => {
  const { t } = useTranslation();
  const circuitContext = React.useContext(CircuitContext);
  const project = circuitContext?.project;
  const currentCircuit = circuitContext?.currentCircuit;

  const [language, setLanguage] = React.useState<HdlExportLanguage>(initialLanguage);
  const [scope, setScope] = React.useState<HdlExportScope>(initialScope);
  const [exportTests, setExportTests] = React.useState(initialExportTests);
  const [commentPoints, setCommentPoints] = React.useState(true);
  const [fixNames, setFixNames] = React.useState(true);
  const [selectedFileIndex, setSelectedFileIndex] = React.useState(0);
  const [copyStatus, setCopyStatus] = React.useState<"idle" | "copied" | "error">("idle");
  const [isSaving, setIsSaving] = React.useState(false);
  const [saveNotice, setSaveNotice] = React.useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  React.useEffect(
    () => {
      if (!isOpen) {
        return;
      }
      setCopyStatus("idle");
      setSaveNotice(null);
      setIsSaving(false);
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
          onClose();
        }
      };

      window.addEventListener("keydown", handleKeyDown, { capture: true });
      return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
    },
    [isOpen, onClose],
  );

  const exportResult = React.useMemo(
    () => {
      if (!isOpen || !project || !currentCircuit) {
        return {
          files: [] as HdlGeneratedFile[],
          logs: [],
          hasErrors: false,
          targetCircuits: [] as string[],
        };
      }
      return exportHdl(project, currentCircuit, {
        language,
        scope,
        exportTests,
        commentPoints,
        fixNames,
      });
    },
    [
      commentPoints,
      currentCircuit,
      exportTests,
      fixNames,
      isOpen,
      language,
      project,
      scope,
    ],
  );

  const flaggedCircuitCount = React.useMemo(
    () => (project ? project.logicalCircuits.filter((c) => c.exportToHDL).length : 0),
    [project],
  );

  React.useEffect(
    () => {
      setSelectedFileIndex(0);
      setCopyStatus("idle");
      setSaveNotice(null);
    },
    [
      commentPoints,
      currentCircuit?.logicalCircuitId,
      exportTests,
      fixNames,
      language,
      scope,
    ],
  );

  const activeFile = exportResult.files[selectedFileIndex] ?? exportResult.files[0] ?? null;

  const logSummary = React.useMemo(
    () => {
      let errors = 0;
      let warnings = 0;
      let infos = 0;
      for (const entry of exportResult.logs) {
        if (entry.level === "error") {
          errors++;
        } else if (entry.level === "warning") {
          warnings++;
        } else {
          infos++;
        }
      }
      return { errors, warnings, infos };
    },
    [exportResult.logs],
  );

  const handleCopyActiveFile = React.useCallback(
    async () => {
      if (!activeFile) {
        return;
      }
      try {
        await navigator.clipboard.writeText(activeFile.content);
        setCopyStatus("copied");
      } catch {
        setCopyStatus("error");
      }
    },
    [activeFile],
  );

  const handleDownloadSingleFile = React.useCallback(
    () => {
      if (!activeFile) {
        return;
      }
      const blob = new Blob([activeFile.content], { type: "text/plain;charset=utf-8" });
      triggerBlobDownload(blob, activeFile.fileName);
    },
    [activeFile],
  );

  const directoryPickerAvailable = isDirectoryPickerSupported();

  const handleExportAll = React.useCallback(
    async () => {
      if (isSaving || exportResult.files.length === 0) {
        return;
      }

      setSaveNotice(null);
      setIsSaving(true);

      try {
        if (directoryPickerAvailable) {
          const defaultDir = await getDefaultDirectoryHandle();
          const result = await exportTextFilesToDirectory(
            exportResult.files,
            defaultDir?.handle ?? null,
          );
          if (result.kind === "saved") {
            setSaveNotice({
              kind: "success",
              text: t("dialog.exportHdl.savedToFolder", {
                count: result.fileCount,
                folder: result.directoryName,
              }),
            });
            return;
          }
          if (result.kind === "cancelled") {
            return;
          }
          if (result.kind === "denied") {
            setSaveNotice({
              kind: "error",
              text: t("dialog.exportHdl.permissionDenied"),
            });
            return;
          }
        }

        for (const file of exportResult.files) {
          const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
          triggerBlobDownload(blob, file.fileName);
        }
        setSaveNotice({
          kind: "success",
          text: t("dialog.exportHdl.downloadedAll", { count: exportResult.files.length }),
        });
      } catch (err) {
        setSaveNotice({
          kind: "error",
          text: t("dialog.exportHdl.saveFailed", {
            message: err instanceof Error ? err.message : String(err),
          }),
        });
      } finally {
        setIsSaving(false);
      }
    },
    [
      directoryPickerAvailable,
      exportResult.files,
      isSaving,
      t,
    ],
  );

  if (!isOpen) {
    return null;
  }

  const formatOptions: {
    id: HdlExportLanguage;
    title: string;
    desc: string;
  }[] = [
    {
      id: "verilog",
      title: t("dialog.exportHdl.verilogTitle"),
      desc: t("dialog.exportHdl.verilogDesc"),
    },
    {
      id: "vhdl",
      title: t("dialog.exportHdl.vhdlTitle"),
      desc: t("dialog.exportHdl.vhdlDesc"),
    },
    {
      id: "n2t",
      title: t("dialog.exportHdl.n2tTitle"),
      desc: t("dialog.exportHdl.n2tDesc"),
    },
  ];

  const scopeOptions: {
    id: HdlExportScope;
    title: string;
    desc: string;
  }[] = [
    {
      id: "current",
      title: t("dialog.exportHdl.scopeCurrentTitle", { name: currentCircuit?.name ?? "" }),
      desc: t("dialog.exportHdl.scopeCurrentDesc"),
    },
    {
      id: "currentWithSubcircuits",
      title: t("dialog.exportHdl.scopeCurrentWithSubsTitle"),
      desc: t("dialog.exportHdl.scopeCurrentWithSubsDesc"),
    },
    {
      id: "flaggedExportToHdl",
      title: t("dialog.exportHdl.scopeFlaggedTitle", { count: flaggedCircuitCount }),
      desc: t("dialog.exportHdl.scopeFlaggedDesc"),
    },
  ];

  const modalContent = (
    <div
      {...other}
      data-component="ExportHdlDialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-hdl-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-card">
        <div className="modal-header">
          <div className="header-text">
            <h2 id="export-hdl-dialog-title" className="modal-title">
              {t("dialog.exportHdl.title")}
            </h2>
            <p className="modal-subtitle">{t("dialog.exportHdl.subtitle")}</p>
          </div>
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
          <div className="config-column">
            <div className="option-group">
              <span className="group-label">{t("dialog.exportHdl.formatLabel")}</span>
              <div className="radio-stack">
                {formatOptions.map((opt) => (
                  <label
                    key={opt.id}
                    className={language === opt.id ? "radio-card is-selected" : "radio-card"}
                  >
                    <input
                      type="radio"
                      name="hdl-language"
                      value={opt.id}
                      checked={language === opt.id}
                      onChange={() => setLanguage(opt.id)}
                    />
                    <span className="card-title">{opt.title}</span>
                    <span className="card-desc">{opt.desc}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="option-group">
              <span className="group-label">{t("dialog.exportHdl.scopeLabel")}</span>
              <div className="radio-stack">
                {scopeOptions.map((opt) => (
                  <label
                    key={opt.id}
                    className={scope === opt.id ? "radio-card is-selected" : "radio-card"}
                  >
                    <input
                      type="radio"
                      name="hdl-scope"
                      value={opt.id}
                      checked={scope === opt.id}
                      onChange={() => setScope(opt.id)}
                    />
                    <span className="card-title">{opt.title}</span>
                    <span className="card-desc">{opt.desc}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="option-group">
              <span className="group-label">{t("dialog.exportHdl.optionsLabel")}</span>
              <div className="checkbox-stack">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={exportTests}
                    onChange={(e) => setExportTests(e.target.checked)}
                  />
                  <span>{t("dialog.exportHdl.exportTestsLabel")}</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={commentPoints}
                    onChange={(e) => setCommentPoints(e.target.checked)}
                  />
                  <span>{t("dialog.exportHdl.commentPointsLabel")}</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={fixNames}
                    onChange={(e) => setFixNames(e.target.checked)}
                  />
                  <span>{t("dialog.exportHdl.fixNamesLabel")}</span>
                </label>
              </div>
            </div>
          </div>

          <div className="preview-column">
            <div className="preview-panel">
              <div className="panel-header">
                <span className="panel-title">
                  {t("dialog.exportHdl.previewHeader", { count: exportResult.files.length })}
                </span>
                <div className="panel-actions">
                  <button
                    type="button"
                    className="btn-small"
                    disabled={!activeFile}
                    onClick={() => {
                      void handleCopyActiveFile();
                    }}
                  >
                    {copyStatus === "copied"
                      ? t("dialog.exportHdl.copiedButton")
                      : copyStatus === "error"
                        ? t("dialog.exportHdl.copyFailed")
                        : t("dialog.exportHdl.copyButton")}
                  </button>
                  <button
                    type="button"
                    className="btn-small"
                    disabled={!activeFile}
                    onClick={handleDownloadSingleFile}
                  >
                    {t("dialog.exportHdl.downloadFileButton")}
                  </button>
                </div>
              </div>

              {exportResult.files.length > 0 && (
                <div className="file-tabs" role="tablist" aria-label={t("dialog.exportHdl.previewHeader", { count: exportResult.files.length })}>
                  {exportResult.files.map((file, idx) => (
                    <button
                      key={file.fileName}
                      type="button"
                      role="tab"
                      aria-selected={idx === selectedFileIndex}
                      className={idx === selectedFileIndex ? "file-tab is-active" : "file-tab"}
                      onClick={() => {
                        setSelectedFileIndex(idx);
                        setCopyStatus("idle");
                      }}
                    >
                      <span className="tab-name">{file.fileName}</span>
                      <span className={`tab-badge kind-${file.kind}`}>
                        {t(getFileKindBadgeKey(file.kind))}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <div className="code-viewer">
                {activeFile ? (
                  <pre className="code-block">
                    <code>{activeFile.content}</code>
                  </pre>
                ) : (
                  <div className="empty-state">{t("dialog.exportHdl.emptyPreview")}</div>
                )}
              </div>
            </div>

            <div className="diagnostics-panel">
              <div className="panel-header">
                <span className="panel-title">{t("dialog.exportHdl.diagnosticsHeader")}</span>
                <span className="diag-summary">
                  {t("dialog.exportHdl.diagnosticsCounts", {
                    errors: logSummary.errors,
                    warnings: logSummary.warnings,
                    infos: logSummary.infos,
                  })}
                </span>
              </div>
              <ul className="log-list">
                {exportResult.logs.map((entry, idx) => (
                  <li key={`${entry.code}-${entry.circuitName}-${idx}`} className={`log-item level-${entry.level}`}>
                    <span className={`log-badge level-${entry.level}`}>
                      {entry.level.toUpperCase()}
                    </span>
                    <span className="log-circuit">[{entry.circuitName}]</span>
                    <span className="log-message">{entry.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <div className="footer-status">
            {saveNotice && (
              <span className={`save-notice kind-${saveNotice.kind}`} role="status">
                {saveNotice.text}
              </span>
            )}
          </div>
          <div className="footer-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t("common.close")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={isSaving || exportResult.files.length === 0}
              onClick={() => {
                void handleExportAll();
              }}
            >
              {isSaving
                ? t("dialog.exportHdl.saving")
                : directoryPickerAvailable
                  ? t("dialog.exportHdl.saveToFolderButton")
                  : t("dialog.exportHdl.downloadAllButton", { count: exportResult.files.length })}
            </button>
          </div>
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
    maxWidth: "68rem",
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
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: "0.75rem",
      padding: "0.85rem 1.15rem",
      borderBottom: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-bg-elevated)",

      "& > .header-text": {
        display: "flex",
        flexDirection: "column",
        gap: "0.2rem",

        "& > .modal-title": {
          margin: 0,
          fontSize: "0.98rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        },

        "& > .modal-subtitle": {
          margin: 0,
          fontSize: "0.76rem",
          color: "var(--color-text-muted)",
        },
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
      flex: 1,
      minHeight: 0,
      padding: "1rem 1.15rem",
      display: "grid",
      gridTemplateColumns: "21rem minmax(0, 1fr)",
      gap: "1rem",
      overflow: "hidden",

      "@media (max-width: 860px)": {
        gridTemplateColumns: "1fr",
        overflowY: "auto",
      },

      "& > .config-column": {
        display: "flex",
        flexDirection: "column",
        gap: "0.85rem",
        overflowY: "auto",
        paddingRight: "0.2rem",

        "& > .option-group": {
          display: "flex",
          flexDirection: "column",
          gap: "0.4rem",

          "& > .group-label": {
            fontSize: "0.78rem",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          },

          "& > .radio-stack": {
            display: "flex",
            flexDirection: "column",
            gap: "0.4rem",

            "& > .radio-card": {
              position: "relative",
              display: "flex",
              flexDirection: "column",
              gap: "0.15rem",
              padding: "0.5rem 0.65rem",
              borderRadius: "0.35rem",
              border: "1px solid var(--color-border-strong)",
              backgroundColor: "var(--color-bg-base)",
              cursor: "pointer",

              "& > input[type=\"radio\"]": {
                position: "absolute",
                opacity: 0,
                pointerEvents: "none",
              },

              "& > .card-title": {
                fontSize: "0.8rem",
                fontWeight: 600,
                color: "var(--color-text-primary)",
              },

              "& > .card-desc": {
                fontSize: "0.71rem",
                lineHeight: 1.35,
                color: "var(--color-text-muted)",
              },

              "&:hover": {
                borderColor: "var(--color-text-secondary)",
              },

              "&.is-selected": {
                borderColor: "var(--color-accent-primary)",
                backgroundColor: "var(--color-accent-tint-subtle)",
              },
            },
          },

          "& > .checkbox-stack": {
            display: "flex",
            flexDirection: "column",
            gap: "0.4rem",
            padding: "0.55rem 0.65rem",
            borderRadius: "0.35rem",
            border: "1px solid var(--color-border-strong)",
            backgroundColor: "var(--color-bg-base)",

            "& > .checkbox-row": {
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              fontSize: "0.78rem",
              color: "var(--color-text-primary)",
              cursor: "pointer",
            },
          },
        },
      },

      "& > .preview-column": {
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        minWidth: 0,
        minHeight: 0,

        "& > .preview-panel": {
          flex: 1,
          minHeight: "14rem",
          display: "flex",
          flexDirection: "column",
          borderRadius: "0.4rem",
          border: "1px solid var(--color-border-strong)",
          backgroundColor: "var(--color-bg-base)",
          overflow: "hidden",

          "& > .panel-header": {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.5rem",
            padding: "0.5rem 0.75rem",
            backgroundColor: "var(--color-bg-elevated)",
            borderBottom: "1px solid var(--color-border-subtle)",

            "& > .panel-title": {
              fontSize: "0.78rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            },

            "& > .panel-actions": {
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",

              "& > .btn-small": {
                padding: "0.25rem 0.55rem",
                borderRadius: "0.25rem",
                border: "1px solid var(--color-border-strong)",
                backgroundColor: "var(--color-bg-surface)",
                color: "var(--color-text-primary)",
                fontSize: "0.72rem",
                cursor: "pointer",

                "&:hover:not(:disabled)": {
                  borderColor: "var(--color-accent-primary)",
                },

                "&:disabled": {
                  opacity: 0.5,
                  cursor: "not-allowed",
                },
              },
            },
          },

          "& > .file-tabs": {
            display: "flex",
            alignItems: "center",
            gap: "0.25rem",
            padding: "0.35rem 0.6rem",
            borderBottom: "1px solid var(--color-border-subtle)",
            backgroundColor: "var(--color-bg-surface)",
            overflowX: "auto",

            "& > .file-tab": {
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              padding: "0.28rem 0.55rem",
              borderRadius: "0.25rem",
              border: "1px solid transparent",
              backgroundColor: "transparent",
              color: "var(--color-text-secondary)",
              fontSize: "0.74rem",
              cursor: "pointer",
              whiteSpace: "nowrap",

              "&.is-active": {
                borderColor: "var(--color-accent-primary)",
                backgroundColor: "var(--color-accent-tint-subtle)",
                color: "var(--color-text-primary)",
                fontWeight: 600,
              },

              "& > .tab-badge": {
                fontSize: "0.62rem",
                padding: "0.05rem 0.3rem",
                borderRadius: "0.2rem",
                backgroundColor: "var(--color-bg-elevated)",
                color: "var(--color-text-muted)",
              },
            },
          },

          "& > .code-viewer": {
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "0.65rem 0.75rem",

            "& > .code-block": {
              margin: 0,
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "0.75rem",
              lineHeight: 1.45,
              color: "var(--color-text-primary)",
              whiteSpace: "pre",
            },

            "& > .empty-state": {
              padding: "1.5rem 0.5rem",
              textAlign: "center",
              fontSize: "0.78rem",
              color: "var(--color-text-muted)",
            },
          },
        },

        "& > .diagnostics-panel": {
          height: "9.5rem",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          borderRadius: "0.4rem",
          border: "1px solid var(--color-border-strong)",
          backgroundColor: "var(--color-bg-base)",
          overflow: "hidden",

          "& > .panel-header": {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.4rem 0.75rem",
            backgroundColor: "var(--color-bg-elevated)",
            borderBottom: "1px solid var(--color-border-subtle)",

            "& > .panel-title": {
              fontSize: "0.76rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            },

            "& > .diag-summary": {
              fontSize: "0.7rem",
              color: "var(--color-text-muted)",
            },
          },

          "& > .log-list": {
            flex: 1,
            margin: 0,
            padding: "0.45rem 0.75rem",
            listStyle: "none",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "0.3rem",

            "& > .log-item": {
              display: "flex",
              alignItems: "baseline",
              gap: "0.4rem",
              fontSize: "0.73rem",
              lineHeight: 1.35,

              "& > .log-badge": {
                flexShrink: 0,
                fontSize: "0.62rem",
                fontWeight: 700,
                padding: "0.05rem 0.3rem",
                borderRadius: "0.2rem",

                "&.level-error": {
                  backgroundColor: "var(--color-error-bg)",
                  color: "var(--color-status-stopped)",
                },
                "&.level-warning": {
                  backgroundColor: "rgba(234, 179, 8, 0.16)",
                  color: "#eab308",
                },
                "&.level-info": {
                  backgroundColor: "var(--color-info-bg)",
                  color: "var(--color-accent-primary)",
                },
              },

              "& > .log-circuit": {
                flexShrink: 0,
                fontWeight: 600,
                color: "var(--color-text-secondary)",
              },

              "& > .log-message": {
                color: "var(--color-text-primary)",
              },
            },
          },
        },
      },
    },

    "& > .modal-footer": {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "0.75rem",
      padding: "0.75rem 1.15rem",
      borderTop: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-bg-elevated)",

      "& > .footer-status": {
        flex: 1,
        fontSize: "0.76rem",

        "& > .save-notice.kind-success": {
          color: "var(--color-accent-primary)",
        },

        "& > .save-notice.kind-error": {
          color: "var(--color-status-stopped)",
        },
      },

      "& > .footer-actions": {
        display: "flex",
        alignItems: "center",
        gap: "0.6rem",

        "& > .btn": {
          padding: "0.45rem 0.9rem",
          borderRadius: "0.3rem",
          fontSize: "0.83rem",
          fontWeight: 500,
          cursor: "pointer",
          border: "1px solid transparent",

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

            "&:hover:not(:disabled)": {
              backgroundColor: "var(--color-accent-primary-hover)",
            },

            "&:disabled": {
              opacity: 0.55,
              cursor: "not-allowed",
            },
          },
        },
      },
    },
  },
});

export default ExportHdlDialog;
