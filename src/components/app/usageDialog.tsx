import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CanvasContext from "../../contexts/canvasContext";
import CircuitContext from "../../contexts/circuitContext";
import SimulationContext from "../../contexts/simulationContext";

import type LogicalCircuit from "../../types/circuit/logicalCircuit";

import {
  type CircuitUsageEntry,
  findCircuitUsages,
  navigateToCircuitUsage,
} from "../../utils/circuitReportBuilder";

export type UsageDialogProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  targetCircuit?: LogicalCircuit | null;
  onClose: () => void;
};

// Modaler Verwendungsnachweis (DialogUsage): listet übergeordnete Schaltungen auf und springt per Klick zu ihren Instanzen
const UsageDialog = styled(({
  isOpen,
  targetCircuit,
  onClose,
  ...other
}: UsageDialogProps) => {
  const { t } = useTranslation();
  const canvasContext = React.useContext(CanvasContext);
  const circuitContext = React.useContext(CircuitContext);
  const simulationContext = React.useContext(SimulationContext);

  const resolvedCircuit = targetCircuit ?? circuitContext?.currentCircuit ?? null;

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

  const usages = React.useMemo(
    () => {
      if (!isOpen || !circuitContext?.project || !resolvedCircuit) {
        return [];
      }
      return findCircuitUsages(circuitContext.project, resolvedCircuit.logicalCircuitId);
    },
    [
      circuitContext?.project,
      isOpen,
      resolvedCircuit,
    ],
  );

  if (!isOpen) {
    return null;
  }

  const handleSelectUsage = (entry: CircuitUsageEntry) => {
    navigateToCircuitUsage({
      entry,
      isSimulating: Boolean(simulationContext?.isSimulating),
      currentCircuitId: circuitContext?.currentCircuitId,
      stopSimulation: simulationContext?.stopSimulation,
      setCurrentCircuitId: circuitContext?.setCurrentCircuitId,
      selectEntities: circuitContext?.selectEntities,
      highlightAiElements: canvasContext?.highlightAiElements,
      focusGridPoint: canvasContext?.focusGridPoint,
    });

    onClose();
  };

  const circuitName = resolvedCircuit?.name ?? "";

  const modalContent = (
    <div
      {...other}
      data-component="UsageDialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="usage-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-card">
        <div className="modal-header">
          <h2 id="usage-dialog-title" className="modal-title">
            {t("dialog.usage.title", { name: circuitName })}
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
          {usages.length === 0 ? (
            <div className="empty-state">
              {t("dialog.usage.empty", { name: circuitName })}
            </div>
          ) : (
            <>
              <p className="usage-description">
                {t("dialog.usage.description", { name: circuitName })}
              </p>
              <div className="usage-list" role="list">
                {usages.map((entry) => (
                  <button
                    key={entry.parentCircuit.logicalCircuitId}
                    type="button"
                    role="listitem"
                    className="usage-item"
                    title={t("dialog.usage.navigateHint")}
                    onClick={() => handleSelectUsage(entry)}
                    onDoubleClick={() => handleSelectUsage(entry)}
                  >
                    <div className="usage-item-main">
                      <span className="usage-circuit-name">{entry.parentCircuit.name}</span>
                      {entry.parentCircuit.category.trim().length > 0 && (
                        <span className="usage-category-badge">{entry.parentCircuit.category}</span>
                      )}
                    </div>
                    <span className="usage-count-badge">
                      {t("dialog.usage.instanceCount", { count: entry.count })}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
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
    maxWidth: "32rem",
    maxHeight: "82vh",
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
      gap: "0.75rem",
      overflowY: "auto",

      "& > .usage-description": {
        margin: 0,
        fontSize: "0.82rem",
        lineHeight: 1.45,
        color: "var(--color-text-secondary)",
      },

      "& > .empty-state": {
        padding: "1rem",
        borderRadius: "0.35rem",
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-base)",
        color: "var(--color-text-secondary)",
        fontSize: "0.85rem",
        lineHeight: 1.45,
        textAlign: "center",
      },

      "& > .usage-list": {
        display: "flex",
        flexDirection: "column",
        gap: "0.45rem",

        "& > .usage-item": {
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          padding: "0.65rem 0.85rem",
          borderRadius: "0.35rem",
          border: "1px solid var(--color-border-subtle)",
          backgroundColor: "var(--color-bg-base)",
          color: "var(--color-text-primary)",
          fontFamily: "inherit",
          textAlign: "left",
          cursor: "pointer",
          transition: "background-color 0.12s ease, border-color 0.12s ease",

          "&:hover": {
            backgroundColor: "var(--color-accent-primary-bg)",
            borderColor: "var(--color-accent-primary)",
          },

          "& > .usage-item-main": {
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            minWidth: 0,
            flexWrap: "wrap",

            "& > .usage-circuit-name": {
              fontSize: "0.88rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            },

            "& > .usage-category-badge": {
              padding: "0.12rem 0.45rem",
              borderRadius: "0.25rem",
              border: "1px solid var(--color-border-subtle)",
              backgroundColor: "var(--color-bg-elevated)",
              color: "var(--color-text-muted)",
              fontSize: "0.72rem",
            },
          },

          "& > .usage-count-badge": {
            flexShrink: 0,
            padding: "0.15rem 0.5rem",
            borderRadius: "0.25rem",
            backgroundColor: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border-strong)",
            color: "var(--color-text-secondary)",
            fontSize: "0.75rem",
            fontWeight: 600,
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
        fontWeight: 600,
        cursor: "pointer",
        border: "1px solid transparent",
        transition: "all 0.12s ease",

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

export default UsageDialog;
