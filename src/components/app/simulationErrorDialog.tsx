import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CanvasContext from "../../contexts/canvasContext";
import CircuitContext from "../../contexts/circuitContext";
import SimulationContext from "../../contexts/simulationContext";

import { navigateToSimulationErrorLocation } from "../../utils/simulationNavigation";

type SimulationErrorDialogProps = React.ComponentPropsWithoutRef<"div">;

// Fehlerdialog bei Schaltungs- und Simulationsfehlern (inkl. Sprung zum auslösenden Bauteil)
const SimulationErrorDialog = styled(({ ...other }: SimulationErrorDialogProps) => {
  const { t } = useTranslation();
  const simulationContext = React.useContext(SimulationContext);
  const circuitContext = React.useContext(CircuitContext);
  const canvasContext = React.useContext(CanvasContext);

  const error = simulationContext?.simulationError ?? null;
  const clearSimulationError = simulationContext?.clearSimulationError;
  const isSimulating = simulationContext?.isSimulating ?? false;
  const stopSimulation = simulationContext?.stopSimulation;

  React.useEffect(
    () => {
      if (!error) {
        return;
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          clearSimulationError?.();
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
      };
    },
    [clearSimulationError, error],
  );

  if (!error) {
    return null;
  }

  const location = error.location ?? null;
  const locationParts: string[] = [];
  if (location?.circuitName) {
    locationParts.push(location.circuitName);
  }
  if (location?.symbolName) {
    locationParts.push(location.symbolName);
  }
  if (typeof location?.x === "number" && typeof location?.y === "number") {
    locationParts.push(`(${location.x}, ${location.y})`);
  }

  const handleJumpToError = () => {
    if (!location) {
      return;
    }
    navigateToSimulationErrorLocation({
      location,
      isSimulating,
      currentCircuitId: circuitContext?.currentCircuit?.logicalCircuitId,
      stopSimulation,
      clearSimulationError,
      setCurrentCircuitId: circuitContext?.setCurrentCircuitId,
      selectEntities: circuitContext?.selectEntities,
      highlightAiElements: canvasContext?.highlightAiElements,
      focusGridPoint: canvasContext?.focusGridPoint,
    });
  };

  const content = (
    <div
      {...other}
      data-component="SimulationErrorDialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="simulation-error-dialog-title"
      aria-describedby="simulation-error-dialog-message"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="backdrop" onClick={() => clearSimulationError?.()} />
      <div className="dialog-card">
        <div className="dialog-header">
          <div className="title-row">
            <span className="error-icon" aria-hidden="true">
              ⚠️
            </span>
            <h2 id="simulation-error-dialog-title">{error.title}</h2>
          </div>
          <button
            type="button"
            className="close-btn"
            aria-label={t("dialog.simulationError.closeAriaLabel")}
            onClick={() => clearSimulationError?.()}
          >
            ✕
          </button>
        </div>

        <div className="dialog-body">
          <p id="simulation-error-dialog-message" className="error-message">
            {error.message}
          </p>
          {location && (
            <div className="location-info">
              <span className="location-label">{t("dialog.simulationError.affectedComponentLabel")}</span>
              <span className="location-value">
                {locationParts.length > 0 ? locationParts.join(" • ") : location.circuitId}
              </span>
            </div>
          )}
        </div>

        <div className="dialog-footer">
          {location && (
            <button
              type="button"
              className="btn-jump"
              onClick={handleJumpToError}
            >
              {t("dialog.simulationError.jumpToErrorButton")}
            </button>
          )}
          <button
            type="button"
            className="btn-close"
            onClick={() => clearSimulationError?.()}
            autoFocus={!location}
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document !== "undefined") {
    return ReactDOM.createPortal(content, document.body);
  }
  return content;
})({
  position: "fixed",
  inset: 0,
  zIndex: 1300,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",

  "& > .backdrop": {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(0, 0, 0, 0.58)",
    backdropFilter: "blur(2px)",
  },

  "& > .dialog-card": {
    position: "relative",
    width: "min(30rem, 92vw)",
    backgroundColor: "var(--color-bg-surface)",
    border: "1px solid var(--color-logic-error)",
    borderRadius: "0.5rem",
    boxShadow: "0 16px 36px rgba(0, 0, 0, 0.48)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    color: "var(--color-text-primary)",

    "& > .dialog-header": {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0.85rem 1.15rem",
      borderBottom: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-error-bg)",

      "& > .title-row": {
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",

        "& > .error-icon": {
          fontSize: "1.05rem",
          lineHeight: 1,
        },

        "& > h2": {
          margin: 0,
          fontSize: "0.95rem",
          fontWeight: 600,
          color: "var(--color-logic-error)",
        },
      },

      "& > .close-btn": {
        appearance: "none",
        background: "none",
        border: "none",
        color: "var(--color-text-secondary)",
        fontSize: "0.9rem",
        cursor: "pointer",
        padding: "0.2rem 0.35rem",
        borderRadius: "0.25rem",

        "&:hover": {
          backgroundColor: "var(--color-bg-elevated)",
          color: "var(--color-text-primary)",
        },
      },
    },

    "& > .dialog-body": {
      padding: "1rem 1.15rem",
      display: "flex",
      flexDirection: "column",
      gap: "0.75rem",

      "& > .error-message": {
        margin: 0,
        fontSize: "0.875rem",
        lineHeight: 1.5,
        color: "var(--color-text-primary)",
        wordBreak: "break-word",
      },

      "& > .location-info": {
        display: "flex",
        flexDirection: "column",
        gap: "0.2rem",
        padding: "0.55rem 0.75rem",
        borderRadius: "0.375rem",
        backgroundColor: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border-subtle)",
        fontSize: "0.8rem",

        "& > .location-label": {
          color: "var(--color-text-secondary)",
          fontSize: "0.72rem",
          textTransform: "uppercase",
          letterSpacing: "0.04rem",
        },

        "& > .location-value": {
          color: "var(--color-text-primary)",
          fontWeight: 600,
          fontFamily: "var(--font-family-mono)",
        },
      },
    },

    "& > .dialog-footer": {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: "0.5rem",
      padding: "0.75rem 1.15rem",
      borderTop: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-bg-elevated)",

      "& > button": {
        appearance: "none",
        padding: "0.45rem 0.9rem",
        borderRadius: "0.25rem",
        fontSize: "0.825rem",
        fontWeight: 600,
        cursor: "pointer",
        transition: "background-color 0.15s ease, border-color 0.15s ease",
      },

      "& > .btn-jump": {
        backgroundColor: "var(--color-accent-primary)",
        border: "1px solid var(--color-accent-primary)",
        color: "var(--color-text-on-strong)",

        "&:hover": {
          backgroundColor: "var(--color-accent-primary-hover)",
        },
      },

      "& > .btn-close": {
        backgroundColor: "transparent",
        border: "1px solid var(--color-border-strong)",
        color: "var(--color-text-secondary)",

        "&:hover": {
          backgroundColor: "var(--color-border-subtle)",
          color: "var(--color-text-primary)",
        },
      },
    },
  },
});

export default SimulationErrorDialog;
