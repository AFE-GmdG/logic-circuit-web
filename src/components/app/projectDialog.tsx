import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CircuitContext from "../../contexts/circuitContext";
import SimulationContext from "../../contexts/simulationContext";

import type FrameRateLimit from "../../types/simulation/frameRateLimit";

import { CLOCK_FREQUENCY_STEPS, resolveFrequencyFromProject } from "../../utils/simulationSpeed";

export type ProjectDialogProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  onClose: () => void;
};

// Modaler Dialog zum Bearbeiten von Projektname, Beschreibung und Ziel-Taktfrequenz (ohne Undo-Historien-Eintrag)
const ProjectDialog = styled(({
  isOpen,
  onClose,
  ...other
}: ProjectDialogProps) => {
  const { t } = useTranslation();
  const circuitContext = React.useContext(CircuitContext);
  const simulationContext = React.useContext(SimulationContext);

  const projectMeta = circuitContext?.project?.project;
  const currentCircuit = circuitContext?.currentCircuit;

  const [name, setName] = React.useState("");
  const [note, setNote] = React.useState("");
  const [frameRateLimit, setFrameRateLimit] = React.useState<FrameRateLimit>(30);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(
    () => {
      if (!isOpen || !projectMeta) {
        return;
      }

      setName(projectMeta.name ?? "");
      setNote(projectMeta.note ?? "");
      setFrameRateLimit(resolveFrequencyFromProject(projectMeta.frequency, projectMeta.isMaximumSpeed));
      setErrorMessage(null);
    },
    [isOpen, projectMeta],
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

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMessage(t("dialog.project.nameRequiredError"));
      return;
    }

    const nextIsMax = frameRateLimit === "max";
    const nextFrequency = nextIsMax ? (projectMeta?.frequency ?? 10) : frameRateLimit;

    circuitContext?.updateProjectProperties({
      name: trimmedName,
      note,
      frequency: nextFrequency,
      isMaximumSpeed: nextIsMax,
    });
    simulationContext?.setFrameRateLimit(frameRateLimit);
    onClose();
  };

  const handleSpeedSelectChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const rawValue = event.target.value;
    if (rawValue === "max") {
      setFrameRateLimit("max");
      return;
    }
    const parsed = Number(rawValue);
    if ((CLOCK_FREQUENCY_STEPS as readonly number[]).includes(parsed)) {
      setFrameRateLimit(parsed as FrameRateLimit);
    }
  };

  const modalContent = (
    <div
      {...other}
      data-component="ProjectDialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <form className="modal-card" onSubmit={handleSubmit}>
        <div className="modal-header">
          <h2 id="project-dialog-title" className="modal-title">{t("dialog.project.title")}</h2>
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
          <div className="form-group">
            <label htmlFor="project-name-input" className="field-label">{t("dialog.project.nameLabel")}</label>
            <input
              id="project-name-input"
              type="text"
              className="text-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errorMessage) {
                  setErrorMessage(null);
                }
              }}
              placeholder={t("dialog.project.namePlaceholder")}
              autoFocus={true}
            />
            {errorMessage && (
              <span className="error-text" role="alert">{errorMessage}</span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="project-note-input" className="field-label">{t("dialog.project.noteLabel")}</label>
            <textarea
              id="project-note-input"
              className="textarea-input"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("dialog.project.notePlaceholder")}
            />
          </div>

          <div className="form-group">
            <label htmlFor="project-frequency-select" className="field-label">{t("dialog.project.frequencyLabel")}</label>
            <select
              id="project-frequency-select"
              className="select-input"
              value={String(frameRateLimit)}
              onChange={handleSpeedSelectChange}
            >
              {CLOCK_FREQUENCY_STEPS.map((hz) => (
                <option key={hz} value={String(hz)}>
                  {t("dialog.options.frequencyValue", { hz })}
                </option>
              ))}
              <option value="max">{t("dialog.options.frequencyMaximum")}</option>
            </select>
            <span className="field-hint">
              {t("dialog.project.frequencyLimitHint")}
            </span>
          </div>

          <div className="form-group">
            <span className="field-label">{t("dialog.project.startupCircuitLabel")}</span>
            <div className="readonly-box" data-testid="startup-circuit-info">
              <strong className="circuit-name">
                {currentCircuit?.name ?? t("dialog.project.startupCircuitFallback")}
              </strong>
              <span className="field-hint">
                {t("dialog.project.startupCircuitHint")}
              </span>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
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
    maxWidth: "30rem",
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
      gap: "0.9rem",

      "& > .form-group": {
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",

        "& > .field-label": {
          fontSize: "0.82rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        },

        "& > .text-input, & > .textarea-input, & > .select-input": {
          width: "100%",
          boxSizing: "border-box",
          padding: "0.45rem 0.65rem",
          backgroundColor: "var(--color-bg-base)",
          color: "var(--color-text-primary)",
          border: "1px solid var(--color-border-strong)",
          borderRadius: "0.3rem",
          fontSize: "0.85rem",
          fontFamily: "inherit",

          "&:focus": {
            outline: "none",
            borderColor: "var(--color-accent-primary)",
          },
        },

        "& > .textarea-input": {
          resize: "vertical",
          minHeight: "4.25rem",
        },

        "& > .field-hint": {
          fontSize: "0.75rem",
          lineHeight: 1.4,
          color: "var(--color-text-muted)",
        },

        "& > .error-text": {
          fontSize: "0.75rem",
          color: "var(--color-status-stopped)",
        },

        "& > .readonly-box": {
          display: "flex",
          flexDirection: "column",
          gap: "0.25rem",
          padding: "0.55rem 0.7rem",
          backgroundColor: "var(--color-bg-base)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "0.3rem",

          "& > .circuit-name": {
            fontSize: "0.85rem",
            color: "var(--color-text-primary)",
          },

          "& > .field-hint": {
            fontSize: "0.75rem",
            lineHeight: 1.4,
            color: "var(--color-text-muted)",
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

export default ProjectDialog;
