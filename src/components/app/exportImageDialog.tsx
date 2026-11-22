import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CircuitContext from "../../contexts/circuitContext";
import SimulationContext from "../../contexts/simulationContext";

import {
  buildExportImageFilename,
  exportCircuitAsPngBlob,
  exportCircuitAsSvgString,
  triggerBlobDownload,
} from "../../utils/circuitCapture";

export type ExportImageDialogProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  onClose: () => void;
};

type ImageFormat = "png" | "svg";
type CaptureAreaMode = "circuit" | "viewport";
type BackgroundMode = "dark" | "transparent";

// Modaler Dialog zum Exportieren der aktuellen Schaltung als PNG (1:1) oder SVG
const ExportImageDialog = styled(({
  isOpen,
  onClose,
  ...other
}: ExportImageDialogProps) => {
  const { t } = useTranslation();
  const circuitContext = React.useContext(CircuitContext);
  const simulationContext = React.useContext(SimulationContext);

  const [format, setFormat] = React.useState<ImageFormat>("png");
  const [captureMode, setCaptureMode] = React.useState<CaptureAreaMode>("circuit");
  const [backgroundMode, setBackgroundMode] = React.useState<BackgroundMode>("dark");
  const [isExporting, setIsExporting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(
    () => {
      if (!isOpen) {
        return;
      }
      setErrorMessage(null);
      setIsExporting(false);
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

  if (!isOpen) {
    return null;
  }

  const currentCircuit = circuitContext?.currentCircuit;
  const isSimulating = simulationContext?.isSimulating ?? false;
  const isTransparent = backgroundMode === "transparent";

  const handleExport = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isExporting) {
      return;
    }

    setErrorMessage(null);
    setIsExporting(true);

    try {
      const filename = buildExportImageFilename(currentCircuit?.name, format);
      const captureOptions = {
        mode: captureMode,
        transparentBackground: isTransparent,
        scale: 1,
      };

      if (format === "svg") {
        const { svgString } = exportCircuitAsSvgString(captureOptions);
        const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
        triggerBlobDownload(svgBlob, filename);
      } else {
        const { blob } = await exportCircuitAsPngBlob(captureOptions);
        triggerBlobDownload(blob, filename);
      }

      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : t("dialog.exportImage.errorFailed"),
      );
    } finally {
      setIsExporting(false);
    }
  };

  const modalContent = (
    <div
      {...other}
      data-component="ExportImageDialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-image-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <form className="modal-card" onSubmit={(e) => { void handleExport(e); }}>
        <div className="modal-header">
          <h2 id="export-image-dialog-title" className="modal-title">
            {t("dialog.exportImage.title")}
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
          {isSimulating && (
            <div className="sim-notice" data-testid="export-simulation-notice">
              {t("dialog.exportImage.simNotice")}
            </div>
          )}

          <div className="option-group">
            <span className="group-label">{t("dialog.exportImage.formatLabel")}</span>
            <div className="radio-row">
              <label className={format === "png" ? "radio-card is-selected" : "radio-card"}>
                <input
                  type="radio"
                  name="export-format"
                  value="png"
                  checked={format === "png"}
                  onChange={() => setFormat("png")}
                />
                <span className="card-title">{t("dialog.exportImage.pngTitle")}</span>
                <span className="card-desc">{t("dialog.exportImage.pngDesc")}</span>
              </label>

              <label className={format === "svg" ? "radio-card is-selected" : "radio-card"}>
                <input
                  type="radio"
                  name="export-format"
                  value="svg"
                  checked={format === "svg"}
                  onChange={() => setFormat("svg")}
                />
                <span className="card-title">{t("dialog.exportImage.svgTitle")}</span>
                <span className="card-desc">{t("dialog.exportImage.svgDesc")}</span>
              </label>
            </div>
          </div>

          <div className="option-group">
            <span className="group-label">{t("dialog.exportImage.areaLabel")}</span>
            <div className="radio-row">
              <label className={captureMode === "circuit" ? "radio-card is-selected" : "radio-card"}>
                <input
                  type="radio"
                  name="export-area"
                  value="circuit"
                  checked={captureMode === "circuit"}
                  onChange={() => setCaptureMode("circuit")}
                />
                <span className="card-title">{t("dialog.exportImage.areaCircuitTitle")}</span>
                <span className="card-desc">{t("dialog.exportImage.areaCircuitDesc")}</span>
              </label>

              <label className={captureMode === "viewport" ? "radio-card is-selected" : "radio-card"}>
                <input
                  type="radio"
                  name="export-area"
                  value="viewport"
                  checked={captureMode === "viewport"}
                  onChange={() => setCaptureMode("viewport")}
                />
                <span className="card-title">{t("dialog.exportImage.areaViewportTitle")}</span>
                <span className="card-desc">{t("dialog.exportImage.areaViewportDesc")}</span>
              </label>
            </div>
          </div>

          <div className="option-group">
            <span className="group-label">{t("dialog.exportImage.backgroundLabel")}</span>
            <div className="radio-row">
              <label className={backgroundMode === "dark" ? "radio-card is-selected" : "radio-card"}>
                <input
                  type="radio"
                  name="export-bg"
                  value="dark"
                  checked={backgroundMode === "dark"}
                  onChange={() => setBackgroundMode("dark")}
                />
                <span className="card-title">{t("dialog.exportImage.bgDarkTitle")}</span>
                <span className="card-desc">{t("dialog.exportImage.bgDarkDesc")}</span>
              </label>

              <label className={backgroundMode === "transparent" ? "radio-card is-selected" : "radio-card"}>
                <input
                  type="radio"
                  name="export-bg"
                  value="transparent"
                  checked={backgroundMode === "transparent"}
                  onChange={() => setBackgroundMode("transparent")}
                />
                <span className="card-title">{t("dialog.exportImage.bgTransparentTitle")}</span>
                <span className="card-desc">{t("dialog.exportImage.bgTransparentDesc")}</span>
              </label>
            </div>
          </div>

          {errorMessage && (
            <div className="error-banner" role="alert">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={isExporting}>
            {isExporting
              ? t("dialog.exportImage.exporting")
              : t("dialog.exportImage.exportAsFormat", { format: format.toUpperCase() })}
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
    maxWidth: "31rem",
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
      gap: "0.95rem",

      "& > .sim-notice": {
        padding: "0.55rem 0.75rem",
        borderRadius: "0.3rem",
        backgroundColor: "var(--color-info-bg)",
        border: "1px solid var(--color-info-border)",
        fontSize: "0.78rem",
        lineHeight: 1.4,
        color: "var(--color-accent-primary)",
      },

      "& > .option-group": {
        display: "flex",
        flexDirection: "column",
        gap: "0.45rem",

        "& > .group-label": {
          fontSize: "0.82rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        },

        "& > .radio-row": {
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0.55rem",

          "& > .radio-card": {
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: "0.2rem",
            padding: "0.6rem 0.75rem",
            borderRadius: "0.35rem",
            border: "1px solid var(--color-border-strong)",
            backgroundColor: "var(--color-bg-base)",
            cursor: "pointer",
            transition: "border-color 0.12s ease, background-color 0.12s ease",

            "& > input[type=\"radio\"]": {
              position: "absolute",
              opacity: 0,
              pointerEvents: "none",
            },

            "& > .card-title": {
              fontSize: "0.84rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            },

            "& > .card-desc": {
              fontSize: "0.73rem",
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
      },

      "& > .error-banner": {
        padding: "0.55rem 0.75rem",
        borderRadius: "0.3rem",
        backgroundColor: "var(--color-error-bg)",
        border: "1px solid var(--color-status-stopped)",
        color: "var(--color-status-stopped)",
        fontSize: "0.8rem",
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

          "&:disabled": {
            opacity: 0.6,
            cursor: "not-allowed",
          },
        },
      },
    },
  },
});

export default ExportImageDialog;
