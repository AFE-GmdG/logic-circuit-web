import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

export type HelpDialogProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  onClose: () => void;
};

type ShortcutEntry = {
  keys: string;
  description: string;
};

// Modaler Hilfe- und Informationsdialog mit Tastaturkürzeln und Verweis auf die C#-Desktop-Referenz
const HelpDialog = styled(({
  isOpen,
  onClose,
  ...other
}: HelpDialogProps) => {
  const { t } = useTranslation();

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

  const editorShortcuts: ShortcutEntry[] = [
    { keys: t("dialog.help.shortcuts.editor.findKeys"), description: t("dialog.help.shortcuts.editor.findDesc") },
    { keys: t("dialog.help.shortcuts.editor.truthTableKeys"), description: t("dialog.help.shortcuts.editor.truthTableDesc") },
    { keys: t("dialog.help.shortcuts.editor.propertiesKeys"), description: t("dialog.help.shortcuts.editor.propertiesDesc") },
    { keys: t("dialog.help.shortcuts.editor.selectAllKeys"), description: t("dialog.help.shortcuts.editor.selectAllDesc") },
    { keys: t("dialog.help.shortcuts.editor.clipboardKeys"), description: t("dialog.help.shortcuts.editor.clipboardDesc") },
    { keys: t("dialog.help.shortcuts.editor.moveKeys"), description: t("dialog.help.shortcuts.editor.moveDesc") },
    { keys: t("dialog.help.shortcuts.editor.rotateKeys"), description: t("dialog.help.shortcuts.editor.rotateDesc") },
    { keys: t("dialog.help.shortcuts.editor.deleteKeys"), description: t("dialog.help.shortcuts.editor.deleteDesc") },
    { keys: t("dialog.help.shortcuts.editor.undoKeys"), description: t("dialog.help.shortcuts.editor.undoDesc") },
    { keys: t("dialog.help.shortcuts.editor.redoKeys"), description: t("dialog.help.shortcuts.editor.redoDesc") },
    { keys: t("dialog.help.shortcuts.editor.panKeys"), description: t("dialog.help.shortcuts.editor.panDesc") },
    { keys: t("dialog.help.shortcuts.editor.zoomKeys"), description: t("dialog.help.shortcuts.editor.zoomDesc") },
    { keys: t("dialog.help.shortcuts.editor.escapeKeys"), description: t("dialog.help.shortcuts.editor.escapeDesc") },
  ];

  const simulationShortcuts: ShortcutEntry[] = [
    { keys: t("dialog.help.shortcuts.simulation.toggleKeys"), description: t("dialog.help.shortcuts.simulation.toggleDesc") },
    { keys: t("dialog.help.shortcuts.simulation.stopKeys"), description: t("dialog.help.shortcuts.simulation.stopDesc") },
    { keys: t("dialog.help.shortcuts.simulation.stepKeys"), description: t("dialog.help.shortcuts.simulation.stepDesc") },
    { keys: t("dialog.help.shortcuts.simulation.oscilloscopeKeys"), description: t("dialog.help.shortcuts.simulation.oscilloscopeDesc") },
    { keys: t("dialog.help.shortcuts.simulation.probeHistoryKeys"), description: t("dialog.help.shortcuts.simulation.probeHistoryDesc") },
  ];

  const modalContent = (
    <div
      {...other}
      data-component="HelpDialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-card">
        <div className="modal-header">
          <h2 id="help-dialog-title" className="modal-title">{t("dialog.help.title")}</h2>
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
          <section className="help-section">
            <h3 className="section-title">{t("dialog.help.editorSection")}</h3>
            <div className="shortcut-list">
              {editorShortcuts.map((entry) => (
                <div key={entry.keys} className="shortcut-row">
                  <kbd className="shortcut-keys">{entry.keys}</kbd>
                  <span className="shortcut-desc">{entry.description}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="help-section">
            <h3 className="section-title">{t("dialog.help.simulationSection")}</h3>
            <div className="shortcut-list">
              {simulationShortcuts.map((entry) => (
                <div key={entry.keys} className="shortcut-row">
                  <kbd className="shortcut-keys">{entry.keys}</kbd>
                  <span className="shortcut-desc">{entry.description}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="help-section about-section">
            <h3 className="section-title">{t("dialog.help.aboutSection")}</h3>
            <p className="about-text">
              {t("dialog.help.aboutBeforeLink")}{" "}
              <a
                href="https://www.logiccircuit.org/"
                target="_blank"
                rel="noopener noreferrer"
              >
                <strong>LogicCircuit</strong>
              </a>{" "}
              {t("dialog.help.aboutBetweenLinks")}{" "}
              <a
                href="https://github.com/eugenelepekhin/LogicCircuit"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("dialog.help.aboutGitHubLink")}
              </a>
              {t("dialog.help.aboutAfterLinks")}{" "}
              <code>.CircuitProject</code>
              {t("dialog.help.aboutEnd")}
            </p>
          </section>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onClose}
            autoFocus={true}
          >
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
    maxHeight: "85vh",
    backgroundColor: "var(--color-bg-surface)",
    border: "1px solid var(--color-border-strong)",
    borderRadius: "0.5rem",
    boxShadow: "0 1.25rem 3rem rgba(0, 0, 0, 0.6)",
    color: "var(--color-text-primary)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",

    "& > .modal-header": {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0.9rem 1.25rem",
      borderBottom: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-bg-elevated)",

      "& > .modal-title": {
        margin: 0,
        fontSize: "1rem",
        fontWeight: 600,
        color: "var(--color-text-primary)",
      },

      "& > .close-btn": {
        background: "transparent",
        border: "none",
        color: "var(--color-text-secondary)",
        fontSize: "1rem",
        cursor: "pointer",
        padding: "0.2rem 0.45rem",
        borderRadius: "0.25rem",

        "&:hover": {
          color: "var(--color-text-primary)",
          backgroundColor: "var(--color-bg-surface)",
        },
      },
    },

    "& > .modal-body": {
      padding: "1.15rem 1.25rem",
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      gap: "1.15rem",

      "& > .help-section": {
        display: "flex",
        flexDirection: "column",
        gap: "0.55rem",

        "& > .section-title": {
          margin: 0,
          fontSize: "0.82rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--color-accent-primary)",
          borderBottom: "1px solid var(--color-border-subtle)",
          paddingBottom: "0.3rem",
        },

        "& > .shortcut-list": {
          display: "flex",
          flexDirection: "column",
          gap: "0.35rem",

          "& > .shortcut-row": {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            padding: "0.25rem 0.4rem",
            borderRadius: "0.25rem",
            backgroundColor: "var(--color-surface-subtle)",

            "& > .shortcut-keys": {
              fontFamily: "var(--font-family-mono)",
              fontSize: "0.78rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              backgroundColor: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.25rem",
              padding: "0.15rem 0.45rem",
              whiteSpace: "nowrap",
              flexShrink: 0,
            },

            "& > .shortcut-desc": {
              fontSize: "0.84rem",
              color: "var(--color-text-secondary)",
              textAlign: "right",
            },
          },
        },

        "& > .about-text": {
          margin: 0,
          fontSize: "0.85rem",
          lineHeight: 1.55,
          color: "var(--color-text-secondary)",

          "& a": {
            color: "var(--color-accent-primary)",
            textDecoration: "underline",

            "&:hover": {
              color: "var(--color-accent-primary-hover)",
            },
          },

          "& code": {
            fontFamily: "var(--font-family-mono)",
            fontSize: "0.8rem",
            backgroundColor: "var(--color-bg-elevated)",
            padding: "0.05rem 0.3rem",
            borderRadius: "0.2rem",
            color: "var(--color-text-primary)",
          },
        },
      },
    },

    "& > .modal-footer": {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      padding: "0.85rem 1.25rem",
      borderTop: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-bg-elevated)",

      "& > .btn": {
        padding: "0.45rem 1rem",
        borderRadius: "0.3rem",
        fontSize: "0.85rem",
        fontWeight: 600,
        cursor: "pointer",
        border: "1px solid transparent",

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

export default HelpDialog;
