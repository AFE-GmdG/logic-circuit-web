import React from "react";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CanvasContext from "../../contexts/canvasContext";
import CircuitContext from "../../contexts/circuitContext";
import CollabContext from "../../contexts/collabContext";
import SimulationContext from "../../contexts/simulationContext";

import type FrameRateLimit from "../../types/simulation/frameRateLimit";

import { navigateToSimulationErrorLocation } from "../../utils/simulationNavigation";
import {
  CLOCK_FREQUENCY_STEPS,
  formatClockFrequency,
  formatStepCount,
} from "../../utils/simulationSpeed";

type TelemetryFooterProps = React.ComponentPropsWithoutRef<"div"> & {
  actualFrequency: number;
  frameRateLimit: FrameRateLimit;
  totalSteps?: number;
  isRunning: boolean;
  isPaused: boolean;
  isOscillating: boolean;
  onFrameRateLimitChange?: (limit: FrameRateLimit) => void;
};

const TelemetryFooter = styled(({
  actualFrequency,
  frameRateLimit,
  totalSteps = 0,
  isRunning,
  isPaused,
  isOscillating,
  onFrameRateLimitChange,
  ...other
}: TelemetryFooterProps) => {
  const { t, i18n } = useTranslation();
  const simulationContext = React.useContext(SimulationContext);
  const circuitContext = React.useContext(CircuitContext);
  const collabContext = React.useContext(CollabContext);
  const canvasContext = React.useContext(CanvasContext);
  const oscillationLocation = simulationContext?.oscillationLocation ?? null;
  const isSnapshotSim = Boolean(
    collabContext?.isInSession &&
    (simulationContext?.isCollabSnapshotSimulation || collabContext.modelSyncState?.isLocalSimulationBuffered),
  );
  const pendingSimDeltaCount = collabContext?.modelSyncState?.pendingSimulationDeltaCount ?? 0;
  const requiresSimResync = Boolean(
    collabContext?.modelSyncState?.requiresResyncAfterSimulation ||
    collabContext?.modelSyncState?.hasPendingProjectSwitchDuringSim,
  );
  const activeLocale = i18n.resolvedLanguage ?? i18n.language ?? "en";

  const applyFrequencyLimit = onFrameRateLimitChange ?? simulationContext?.setFrameRateLimit;

  const handleFrequencyChange = React.useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!applyFrequencyLimit) {
        return;
      }
      const value = e.target.value;
      if (value === "max") {
        applyFrequencyLimit("max");
        return;
      }
      const parsed = Number(value);
      if ((CLOCK_FREQUENCY_STEPS as readonly number[]).includes(parsed)) {
        applyFrequencyLimit(parsed as (typeof CLOCK_FREQUENCY_STEPS)[number]);
      }
    },
    [applyFrequencyLimit],
  );

  let statusText = t("runningTree.telemetry.statusStopped");
  let statusClass = "stopped";

  if (isRunning) {
    statusText = t("runningTree.telemetry.statusRunning");
    statusClass = "running";
  } else if (isPaused) {
    statusText = t("runningTree.telemetry.statusPaused");
    statusClass = "paused";
  }

  return (
    <div {...other} data-component="TelemetryFooter">
      <div className="telemetry-header">
        <span className="telemetry-title">{t("runningTree.telemetry.header")}</span>
      </div>

      <div className="telemetry-content">
        <div className="telemetry-row">
          <span className="telemetry-label">{t("runningTree.telemetry.actualFrequencyLabel")}</span>
          <span
            className="telemetry-value frequency"
            data-testid="actual-frequency"
            title={`${formatStepCount(Math.round(actualFrequency), activeLocale)} Hz`}
          >
            {formatClockFrequency(actualFrequency, activeLocale)}
          </span>
        </div>

        <div className="telemetry-row">
          <label className="telemetry-label" htmlFor="telemetry-frequency-select">
            {t("runningTree.telemetry.targetFrequencyLabel")}
          </label>
          <select
            id="telemetry-frequency-select"
            className="frequency-select"
            data-testid="telemetry-frequency-select"
            aria-label={t("runningTree.telemetry.targetFrequencyAriaLabel")}
            title={frameRateLimit === "max" ? t("dialog.options.frequencyMaximum") : undefined}
            value={String(frameRateLimit)}
            onChange={handleFrequencyChange}
          >
            {CLOCK_FREQUENCY_STEPS.map((hz) => (
              <option key={hz} value={String(hz)}>
                {t("dialog.options.frequencyValue", { hz })}
              </option>
            ))}
            <option value="max">{t("runningTree.telemetry.speedMax")}</option>
          </select>
        </div>

        <div className="telemetry-row">
          <span className="telemetry-label">{t("runningTree.telemetry.stepsLabel")}</span>
          <span className="telemetry-value steps" data-testid="simulation-total-steps">
            {formatStepCount(totalSteps, activeLocale)}
          </span>
        </div>

        <div className="telemetry-row">
          <span className="telemetry-label">{t("runningTree.telemetry.statusLabel")}</span>
          <span className="telemetry-value status-badge">
            <span className={`status-dot ${statusClass}`} />
            {statusText}
          </span>
        </div>

        {isSnapshotSim && (
          <div
            className={`snapshot-sim-notice${pendingSimDeltaCount > 0 || requiresSimResync ? " has-updates" : ""}`}
            data-testid="telemetry-snapshot-sim-notice"
          >
            <span>{t("runningTree.telemetry.snapshotModeBadge")}</span>
            {(requiresSimResync || pendingSimDeltaCount > 0) && (
              <span className="snapshot-sim-pending">
                {requiresSimResync
                  ? t("runningTree.telemetry.snapshotResyncPending")
                  : t("runningTree.telemetry.snapshotPendingUpdates", { count: pendingSimDeltaCount })}
              </span>
            )}
          </div>
        )}

        {isOscillating && (
          <div className="oscillating-warning" role="alert">
            <span>{t("runningTree.telemetry.oscillationWarning")}</span>
            {oscillationLocation && (
              <button
                type="button"
                className="jump-to-error-btn"
                onClick={() => {
                  navigateToSimulationErrorLocation({
                    location: oscillationLocation,
                    isSimulating: simulationContext?.isSimulating ?? false,
                    currentCircuitId: circuitContext?.currentCircuit?.logicalCircuitId,
                    stopSimulation: simulationContext?.stopSimulation,
                    clearSimulationError: simulationContext?.clearSimulationError,
                    setCurrentCircuitId: circuitContext?.setCurrentCircuitId,
                    selectEntities: circuitContext?.selectEntities,
                    highlightAiElements: canvasContext?.highlightAiElements,
                    focusGridPoint: canvasContext?.focusGridPoint,
                  });
                }}
              >
                {t("runningTree.telemetry.jumpToErrorButton")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
})({
  display: "flex",
  flexDirection: "column",
  padding: "0.75rem 1rem",
  borderTop: "1px solid var(--color-border-subtle)",
  backgroundColor: "var(--color-bg-surface)",
  gap: "0.5rem",

  "& > .telemetry-header": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",

    "& > .telemetry-title": {
      fontSize: "0.75rem",
      fontWeight: 600,
      color: "var(--color-text-secondary)",
      textTransform: "uppercase",
      letterSpacing: "0.05rem",
    },
  },

  "& > .telemetry-content": {
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",

    "& > .telemetry-row": {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      fontSize: "0.8rem",

      "& > .telemetry-label": {
        color: "var(--color-text-secondary)",
      },

      "& > .frequency-select": {
        backgroundColor: "var(--color-bg-base)",
        border: "1px solid var(--color-border-subtle)",
        color: "var(--color-text-primary)",
        borderRadius: "0.25rem",
        padding: "0.12rem 0.38rem",
        fontSize: "0.75rem",
        fontFamily: "var(--font-family-mono)",
        fontWeight: 600,
        outline: "none",
        cursor: "pointer",
        transition: "border-color 0.15s ease",

        "&:hover": {
          borderColor: "var(--color-border-strong)",
        },

        "&:focus": {
          borderColor: "var(--color-accent-primary)",
        },
      },

      "& > .telemetry-value": {
        fontFamily: "var(--font-family-mono)",
        fontVariantNumeric: "tabular-nums",
        fontWeight: 600,
        color: "var(--color-text-primary)",

        "&.frequency": {
          color: "var(--color-logic-high)",
        },

        "&.status-badge": {
          display: "flex",
          alignItems: "center",
          gap: "0.35rem",
          fontFamily: "var(--font-family-base)",
          fontWeight: 500,

          "& > .status-dot": {
            width: "0.5rem",
            height: "0.5rem",
            borderRadius: "50%",

            "&.running": {
              backgroundColor: "var(--color-status-running)",
              boxShadow: "0 0 4px var(--color-status-running)",
            },

            "&.paused": {
              backgroundColor: "var(--color-wire-selected)",
            },

            "&.stopped": {
              backgroundColor: "var(--color-status-stopped)",
            },
          },
        },
      },
    },

    "& > .snapshot-sim-notice": {
      display: "flex",
      flexDirection: "column",
      gap: "0.18rem",
      marginTop: "0.2rem",
      padding: "0.35rem 0.5rem",
      borderRadius: "0.25rem",
      backgroundColor: "var(--color-bg-elevated)",
      border: "1px solid var(--color-border-subtle)",
      color: "var(--color-text-secondary)",
      fontSize: "0.73rem",
      lineHeight: 1.35,

      "&.has-updates": {
        backgroundColor: "var(--color-warning-bg)",
        borderColor: "var(--color-warning-border)",
        color: "var(--color-text-primary)",
      },

      "& > .snapshot-sim-pending": {
        fontWeight: 600,
        color: "var(--color-warning)",
      },
    },

    "& > .oscillating-warning": {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "0.35rem",
      marginTop: "0.2rem",
      padding: "0.4rem 0.5rem",
      borderRadius: "0.25rem",
      backgroundColor: "var(--color-error-bg)",
      border: "1px solid var(--color-logic-error)",
      color: "var(--color-logic-error)",
      fontSize: "0.75rem",
      fontWeight: 600,
      textAlign: "center",

      "& > .jump-to-error-btn": {
        appearance: "none",
        padding: "0.25rem 0.55rem",
        borderRadius: "0.25rem",
        border: "1px solid var(--color-logic-error)",
        backgroundColor: "var(--color-bg-surface)",
        color: "var(--color-text-primary)",
        fontSize: "0.72rem",
        fontWeight: 600,
        cursor: "pointer",

        "&:hover": {
          backgroundColor: "var(--color-bg-elevated)",
        },
      },
    },
  },
});

export default TelemetryFooter;
