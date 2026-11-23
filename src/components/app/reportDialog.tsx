import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CircuitContext from "../../contexts/circuitContext";

import type LogicalCircuit from "../../types/circuit/logicalCircuit";

import { buildCircuitReport, formatCircuitReportMarkdown } from "../../utils/circuitReportBuilder";
import { writeClipboardText } from "../../utils/clipboardUtils";

export type ReportDialogProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  targetCircuit?: LogicalCircuit | null;
  onClose: () => void;
};

// Modaler Schaltungsbericht (DialogReport): Projektstatistik, kompilierte Funktionsliste und Markdown-Export
const ReportDialog = styled(({
  isOpen,
  targetCircuit,
  onClose,
  ...other
}: ReportDialogProps) => {
  const { t } = useTranslation();
  const circuitContext = React.useContext(CircuitContext);

  const [copyStatus, setCopyStatus] = React.useState<"idle" | "copied" | "error">("idle");
  const copyTimerRef = React.useRef<number | null>(null);

  const resolvedCircuit = targetCircuit ?? circuitContext?.currentCircuit ?? null;

  React.useEffect(
    () => {
      if (!isOpen) {
        setCopyStatus("idle");
      }
      return () => {
        if (copyTimerRef.current !== null) {
          window.clearTimeout(copyTimerRef.current);
          copyTimerRef.current = null;
        }
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
          onClose();
        }
      };

      window.addEventListener("keydown", handleKeyDown, { capture: true });
      return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
    },
    [isOpen, onClose],
  );

  const report = React.useMemo(
    () => {
      if (!isOpen || !circuitContext?.project) {
        return null;
      }
      return buildCircuitReport(circuitContext.project, resolvedCircuit);
    },
    [
      circuitContext?.project,
      isOpen,
      resolvedCircuit,
    ],
  );

  if (!isOpen || !report) {
    return null;
  }

  const handleCopyMarkdown = async () => {
    const markdown = formatCircuitReportMarkdown(report);
    const success = await writeClipboardText(markdown);

    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }

    setCopyStatus(success ? "copied" : "error");
    copyTimerRef.current = window.setTimeout(
      () => {
        setCopyStatus("idle");
        copyTimerRef.current = null;
      },
      2500,
    );
  };

  const trimmedNote = report.projectNote.trim();

  const modalContent = (
    <div
      {...other}
      data-component="ReportDialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-card">
        <div className="modal-header">
          <h2 id="report-dialog-title" className="modal-title">
            {t("dialog.report.title")}
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
          <section className="report-overview">
            <h3 className="project-name">
              {report.projectName.trim() || t("dialog.report.untitledProject")}
            </h3>
            <p className={trimmedNote.length > 0 ? "project-note" : "project-note is-empty"}>
              {trimmedNote.length > 0 ? trimmedNote : t("dialog.report.noDescription")}
            </p>
          </section>

          <section className="report-section">
            <h4 className="section-title">{t("dialog.report.statisticsTitle")}</h4>
            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-label">{t("dialog.report.circuitsLabel")}</span>
                <span className="stat-value">{report.circuitCount}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">{t("dialog.report.categoriesLabel")}</span>
                <span className="stat-value">{report.categoryCount}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">{t("dialog.report.symbolsLabel")}</span>
                <span className="stat-value">{report.symbolCount}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">{t("dialog.report.wiresLabel")}</span>
                <span className="stat-value">{report.wireCount}</span>
              </div>
            </div>
          </section>

          <section className="report-section">
            <h4 className="section-title">
              {t("dialog.report.functionsTitle", { circuitName: report.targetCircuitName })}
            </h4>

            {report.compileError !== null ? (
              <div className="compile-error-box" role="alert">
                <strong className="compile-error-title">
                  {t("dialog.report.compileErrorTitle")}
                </strong>
                <span className="compile-error-message">{report.compileError}</span>
              </div>
            ) : report.functions.length === 0 ? (
              <div className="empty-functions-box">
                {t("dialog.report.noFunctions")}
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="functions-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("dialog.report.functionColumn")}</th>
                      <th scope="col" className="numeric-col">
                        {t("dialog.report.countColumn")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.functions.map((item) => (
                      <tr key={item.reportName}>
                        <td>{item.reportName}</td>
                        <td className="numeric-col">{item.count}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{t("dialog.report.totalRow")}</td>
                      <td className="numeric-col">{report.totalFunctions}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {copyStatus === "error" && (
            <div className="copy-error-text" role="status">
              {t("dialog.report.copyFailed")}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              void handleCopyMarkdown();
            }}
          >
            {copyStatus === "copied"
              ? t("dialog.report.copiedMarkdown")
              : t("dialog.report.copyMarkdown")}
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
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
    maxWidth: "38rem",
    maxHeight: "86vh",
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
      display: "flex",
      flexDirection: "column",
      gap: "1rem",
      overflowY: "auto",

      "& > .report-overview": {
        display: "flex",
        flexDirection: "column",
        gap: "0.3rem",
        padding: "0.75rem 0.9rem",
        borderRadius: "0.35rem",
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-base)",

        "& > .project-name": {
          margin: 0,
          fontSize: "1rem",
          fontWeight: 700,
          color: "var(--color-text-primary)",
        },

        "& > .project-note": {
          margin: 0,
          fontSize: "0.82rem",
          lineHeight: 1.45,
          color: "var(--color-text-secondary)",
          whiteSpace: "pre-wrap",

          "&.is-empty": {
            color: "var(--color-text-muted)",
            fontStyle: "italic",
          },
        },
      },

      "& > .report-section": {
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",

        "& > .section-title": {
          margin: 0,
          fontSize: "0.82rem",
          fontWeight: 600,
          color: "var(--color-text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.03rem",
        },

        "& > .stats-grid": {
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: "0.55rem",

          "& > .stat-card": {
            display: "flex",
            flexDirection: "column",
            gap: "0.2rem",
            padding: "0.55rem 0.7rem",
            borderRadius: "0.35rem",
            border: "1px solid var(--color-border-subtle)",
            backgroundColor: "var(--color-bg-base)",

            "& > .stat-label": {
              fontSize: "0.72rem",
              color: "var(--color-text-muted)",
            },

            "& > .stat-value": {
              fontSize: "1.05rem",
              fontWeight: 700,
              color: "var(--color-text-primary)",
              fontVariantNumeric: "tabular-nums",
            },
          },
        },

        "& > .compile-error-box": {
          display: "flex",
          flexDirection: "column",
          gap: "0.3rem",
          padding: "0.75rem 0.9rem",
          borderRadius: "0.35rem",
          border: "1px solid var(--color-error-border)",
          backgroundColor: "var(--color-error-bg)",
          color: "var(--color-error-text)",
          fontSize: "0.83rem",
          lineHeight: 1.45,

          "& > .compile-error-title": {
            fontWeight: 600,
          },

          "& > .compile-error-message": {
            color: "var(--color-error-text-soft)",
          },
        },

        "& > .empty-functions-box": {
          padding: "0.85rem 0.95rem",
          borderRadius: "0.35rem",
          border: "1px solid var(--color-border-subtle)",
          backgroundColor: "var(--color-bg-base)",
          color: "var(--color-text-secondary)",
          fontSize: "0.83rem",
          lineHeight: 1.45,
        },

        "& > .table-wrapper": {
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "0.35rem",
          overflow: "hidden",
          backgroundColor: "var(--color-bg-base)",

          "& > .functions-table": {
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.83rem",

            "& th, & td": {
              padding: "0.45rem 0.75rem",
              textAlign: "left",
              borderBottom: "1px solid var(--color-border-subtle)",
            },

            "& th.numeric-col, & td.numeric-col": {
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
            },

            "& > thead th": {
              backgroundColor: "var(--color-bg-elevated)",
              color: "var(--color-text-secondary)",
              fontWeight: 600,
              fontSize: "0.78rem",
            },

            "& > tbody tr:hover": {
              backgroundColor: "var(--color-bg-surface)",
            },

            "& > tfoot td": {
              backgroundColor: "var(--color-bg-elevated)",
              fontWeight: 700,
              color: "var(--color-text-primary)",
              borderBottom: "none",
            },
          },
        },
      },

      "& > .copy-error-text": {
        fontSize: "0.78rem",
        color: "var(--color-error-text-soft)",
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

export default ReportDialog;
