import React from "react";

import styled from "@emotion/styled";

type AppHeaderProps = Omit<React.ComponentPropsWithoutRef<"header">, "children"> & {
  isRunning: boolean;
  onToggleRun: () => void;
  onStep: () => void;
  onReset: () => void;
};

const AppHeader = styled(({ isRunning, onToggleRun, onStep, onReset, ...other }: AppHeaderProps) => {
  return (
    <header {...other} data-component="AppHeader">
      <div className="title-section">
        <h1 className="app-title">Logic Circuit Web</h1>
        <span className="app-badge">Pre-Alpha</span>
      </div>

      <div className="controls-section">
        <button
          type="button"
          className={`control-button ${isRunning ? "running" : "stopped"}`}
          onClick={onToggleRun}
        >
          {isRunning ? "Pause Simulation" : "Start Simulation"}
        </button>

        <button
          type="button"
          className="control-button secondary"
          onClick={onStep}
          disabled={isRunning}
        >
          Einzelschritt
        </button>

        <button
          type="button"
          className="control-button secondary"
          onClick={onReset}
        >
          Zurücksetzen
        </button>
      </div>

      <div className="status-section">
        <span className={`status-indicator ${isRunning ? "active" : "idle"}`} />
        <span className="status-label">{isRunning ? "Simulation aktiv" : "Angehalten"}</span>
      </div>
    </header>
  );
})({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  height: "3.5rem",
  padding: "0 1.25rem",
  backgroundColor: "var(--color-bg-surface)",
  borderBottom: "1px solid var(--color-border-subtle)",
  userSelect: "none",

  "& > .title-section": {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",

    "& > .app-title": {
      margin: 0,
      fontSize: "1.125rem",
      fontWeight: 600,
      letterSpacing: "0.02rem",
      color: "var(--color-text-primary)",
    },

    "& > .app-badge": {
      fontSize: "0.75rem",
      padding: "0.2rem 0.5rem",
      borderRadius: "0.25rem",
      backgroundColor: "var(--color-accent-primary-bg)",
      color: "var(--color-accent-primary)",
      fontWeight: 500,
    },
  },

  "& > .controls-section": {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",

    "& > .control-button": {
      padding: "0.4rem 0.85rem",
      fontSize: "0.85rem",
      fontWeight: 500,
      borderRadius: "0.375rem",
      border: "1px solid transparent",
      cursor: "pointer",
      transition: "all 0.15s ease-in-out",

      "&.stopped": {
        backgroundColor: "var(--color-accent-primary)",
        color: "#ffffff",
        "&:hover": {
          backgroundColor: "var(--color-accent-primary-hover)",
        },
      },

      "&.running": {
        backgroundColor: "var(--color-status-stopped)",
        color: "#ffffff",
      },

      "&.secondary": {
        backgroundColor: "var(--color-bg-elevated)",
        color: "var(--color-text-secondary)",
        borderColor: "var(--color-border-strong)",
        "&:hover:not(:disabled)": {
          backgroundColor: "var(--color-bg-base)",
          color: "var(--color-text-primary)",
        },
        "&:disabled": {
          opacity: 0.5,
          cursor: "not-allowed",
        },
      },
    },
  },

  "& > .status-section": {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",

    "& > .status-indicator": {
      width: "0.625rem",
      height: "0.625rem",
      borderRadius: "50%",
      backgroundColor: "var(--color-text-muted)",

      "&.active": {
        backgroundColor: "var(--color-status-running)",
        boxShadow: "0 0 8px var(--color-status-running)",
      },

      "&.idle": {
        backgroundColor: "var(--color-text-muted)",
      },
    },

    "& > .status-label": {
      fontSize: "0.85rem",
      color: "var(--color-text-secondary)",
    },
  },
});

export default AppHeader;
