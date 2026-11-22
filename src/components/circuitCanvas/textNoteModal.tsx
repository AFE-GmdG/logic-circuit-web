import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import type TextNote from "../../types/circuit/textNote";
import type TextNoteFontFamily from "../../types/circuit/textNoteFontFamily";
import type TextNoteLineHeight from "../../types/circuit/textNoteLineHeight";

export type TextNoteModalSavePayload = {
  note: string;
  fontFamily: TextNoteFontFamily;
  lineHeight: TextNoteLineHeight;
  lineHeights?: TextNoteLineHeight[];
};

export type TextNoteModalProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  textNote: TextNote | null;
  onSave: (payload: TextNoteModalSavePayload) => void;
  onClose: () => void;
};

const LINE_HEIGHT_VALUES: readonly TextNoteLineHeight[] = [9, 12, 18, 36];

function getLineHeightLabel(
  value: TextNoteLineHeight,
  t: (key: string) => string,
): string {
  switch (value) {
    case 9:
      return t("dialog.textNote.lineHeights.lh9");
    case 12:
      return t("dialog.textNote.lineHeights.lh12");
    case 18:
      return t("dialog.textNote.lineHeights.lh18");
    case 36:
      return t("dialog.textNote.lineHeights.lh36");
  }
}

const TextNoteModal = styled(({
  isOpen,
  textNote,
  onSave,
  onClose,
  ...other
}: TextNoteModalProps) => {
  const { t } = useTranslation();
  const [note, setNote] = React.useState<string>(() => textNote?.note ?? "");
  const [fontFamily, setFontFamily] = React.useState<TextNoteFontFamily>(() => textNote?.fontFamily ?? "mono");
  const [lineHeight, setLineHeight] = React.useState<TextNoteLineHeight>(() => textNote?.lineHeight ?? 18);
  const [customLinesEnabled, setCustomLinesEnabled] = React.useState<boolean>(
    () => Boolean(textNote?.lineHeights && textNote.lineHeights.length > 0),
  );
  const [customLineHeights, setCustomLineHeights] = React.useState<(TextNoteLineHeight | undefined)[]>(
    () => (textNote?.lineHeights ? [...textNote.lineHeights] : []),
  );

  // Synchronisiert die Formulardaten mit der übergebenen Text-Notiz beim Öffnen
  React.useEffect(
    () => {
      if (textNote && isOpen) {
        setNote(textNote.note);
        setFontFamily(textNote.fontFamily ?? "mono");
        const defaultLh = textNote.lineHeight ?? 18;
        setLineHeight(defaultLh);
        if (textNote.lineHeights && textNote.lineHeights.length > 0) {
          setCustomLinesEnabled(true);
          setCustomLineHeights([...textNote.lineHeights]);
        } else {
          setCustomLinesEnabled(false);
          setCustomLineHeights([]);
        }
      }
    },
    [isOpen, textNote],
  );

  const lines = React.useMemo(
    () => note.split("\n"),
    [note],
  );

  const handleSave = React.useCallback(
    () => {
      let resolvedLineHeights: TextNoteLineHeight[] | undefined = undefined;
      if (customLinesEnabled) {
        resolvedLineHeights = lines.map((_, index) => customLineHeights[index] ?? lineHeight);
      }

      onSave({
        note,
        fontFamily,
        lineHeight,
        lineHeights: resolvedLineHeights,
      });
      onClose();
    },
    [
      customLineHeights,
      customLinesEnabled,
      fontFamily,
      lineHeight,
      lines,
      note,
      onClose,
      onSave,
    ],
  );

  const handleCustomLineChange = React.useCallback(
    (index: number, val: string) => {
      setCustomLineHeights((prev) => {
        const next = [...prev];
        if (val === "default") {
          next[index] = undefined;
        } else {
          next[index] = Number(val) as TextNoteLineHeight;
        }
        return next;
      });
    },
    [],
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.nativeEvent) {
        e.nativeEvent.stopImmediatePropagation();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave, onClose],
  );

  if (!isOpen || !textNote) {
    return null;
  }

  const lineHeightOptions = LINE_HEIGHT_VALUES.map((value) => ({
    value,
    label: getLineHeightLabel(value, t),
  }));

  const modalContent = (
    <div
      {...other}
      data-component="TextNoteModal"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-dialog">
        <div className="modal-header">
          <h3 className="modal-title">{t("dialog.textNote.title")}</h3>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="note-text-input" className="form-label">
              {t("dialog.textNote.contentLabel")}
            </label>
            <textarea
              id="note-text-input"
              className="note-textarea"
              rows={5}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("dialog.textNote.contentPlaceholder")}
              autoFocus={true}
              style={{
                fontFamily: fontFamily === "sans"
                  ? "system-ui, -apple-system, sans-serif"
                  : "ui-monospace, Consolas, monospace",
              }}
            />
          </div>

          <div className="form-row">
            <div className="form-group flex-1">
              <label htmlFor="font-family-select" className="form-label">
                {t("dialog.textNote.fontFamilyLabel")}
              </label>
              <select
                id="font-family-select"
                className="form-select"
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value as TextNoteFontFamily)}
              >
                <option value="mono">{t("dialog.textNote.fontMono")}</option>
                <option value="sans">{t("dialog.textNote.fontSans")}</option>
              </select>
            </div>

            <div className="form-group flex-1">
              <label htmlFor="line-height-select" className="form-label">
                {t("dialog.textNote.defaultLineHeightLabel")}
              </label>
              <select
                id="line-height-select"
                className="form-select"
                value={lineHeight}
                onChange={(e) => setLineHeight(Number(e.target.value) as TextNoteLineHeight)}
              >
                {lineHeightOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={customLinesEnabled}
                onChange={(e) => setCustomLinesEnabled(e.target.checked)}
              />
              <span>{t("dialog.textNote.perLineCheckbox")}</span>
            </label>
          </div>

          {customLinesEnabled && (
            <div className="per-line-settings">
              <div className="per-line-header">{t("dialog.textNote.perLineHeader")}</div>
              {lines.map((lineText, index) => {
                const currentVal = customLineHeights[index];
                return (
                  <div key={index} className="per-line-row">
                    <span className="line-number">
                      {t("dialog.textNote.lineNumberPrefix", { line: index + 1 })}
                    </span>
                    <span className="line-preview">
                      {lineText.trim()
                        ? `„${lineText.slice(0, 24)}${lineText.length > 24 ? "…" : ""}“`
                        : t("dialog.textNote.emptyLine")}
                    </span>
                    <select
                      className="form-select line-select"
                      value={currentVal !== undefined ? currentVal : "default"}
                      onChange={(e) => handleCustomLineChange(index, e.target.value)}
                    >
                      <option value="default">
                        {t("dialog.textNote.defaultOption", { lineHeight })}
                      </option>
                      {lineHeightOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span className="shortcut-hint">{t("dialog.textNote.shortcutHint")}</span>
          <div className="footer-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
            >
              {t("common.save")}
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
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",

  "& > .modal-backdrop": {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    backdropFilter: "blur(2px)",
  },

  "& > .modal-dialog": {
    position: "relative",
    width: "32rem",
    maxWidth: "92vw",
    maxHeight: "88vh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: "var(--color-bg-surface)",
    border: "1px solid var(--color-border-subtle)",
    borderRadius: "0.5rem",
    boxShadow: "0 10px 25px rgba(0, 0, 0, 0.5)",
    overflow: "hidden",
    color: "var(--color-text-primary)",

    "& > .modal-header": {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0.85rem 1.25rem",
      borderBottom: "1px solid var(--color-border-subtle)",

      "& > .modal-title": {
        margin: 0,
        fontSize: "1.1rem",
        fontWeight: 600,
      },

      "& > .modal-close-btn": {
        background: "transparent",
        border: "none",
        color: "var(--color-text-secondary)",
        fontSize: "1.4rem",
        cursor: "pointer",
        lineHeight: 1,
        padding: "0 0.25rem",
        borderRadius: "0.25rem",

        "&:hover": {
          color: "var(--color-text-primary)",
          backgroundColor: "var(--color-surface-hover)",
        },
      },
    },

    "& > .modal-body": {
      padding: "1rem 1.25rem",
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      gap: "0.85rem",

      "& .form-row": {
        display: "flex",
        gap: "0.75rem",
      },

      "& .flex-1": {
        flex: 1,
      },

      "& .form-group": {
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",

        "& > .form-label": {
          fontSize: "0.825rem",
          fontWeight: 600,
          color: "var(--color-text-secondary)",
        },

        "& > .note-textarea": {
          width: "100%",
          padding: "0.5rem 0.65rem",
          backgroundColor: "var(--color-bg-base)",
          color: "var(--color-text-primary)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "0.375rem",
          fontSize: "0.95rem",
          lineHeight: 1.4,
          resize: "vertical",
          boxSizing: "border-box",

          "&:focus": {
            outline: "none",
            borderColor: "var(--color-accent-primary)",
            boxShadow: "0 0 0 2px var(--color-accent-primary-bg)",
          },
        },

        "& > .form-select": {
          padding: "0.4rem 0.5rem",
          backgroundColor: "var(--color-bg-base)",
          color: "var(--color-text-primary)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "0.375rem",
          fontSize: "0.85rem",

          "&:focus": {
            outline: "none",
            borderColor: "var(--color-accent-primary)",
          },
        },

        "& > .checkbox-label": {
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontSize: "0.85rem",
          cursor: "pointer",
          userSelect: "none",
        },
      },

      "& .per-line-settings": {
        display: "flex",
        flexDirection: "column",
        gap: "0.4rem",
        padding: "0.6rem",
        backgroundColor: "var(--color-bg-base)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "0.375rem",

        "& > .per-line-header": {
          fontSize: "0.8rem",
          fontWeight: 600,
          color: "var(--color-text-secondary)",
          marginBottom: "0.2rem",
        },

        "& .per-line-row": {
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontSize: "0.8rem",

          "& > .line-number": {
            width: "1.8rem",
            fontWeight: 600,
            color: "var(--color-text-secondary)",
          },

          "& > .line-preview": {
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "ui-monospace, monospace",
          },

          "& > .line-select": {
            width: "11rem",
            padding: "0.2rem 0.4rem",
            fontSize: "0.775rem",
            backgroundColor: "var(--color-bg-surface)",
            color: "var(--color-text-primary)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "0.25rem",
          },
        },
      },
    },

    "& > .modal-footer": {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0.75rem 1.25rem",
      borderTop: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-bg-base)",

      "& > .shortcut-hint": {
        fontSize: "0.75rem",
        color: "var(--color-text-secondary)",
      },

      "& > .footer-actions": {
        display: "flex",
        gap: "0.5rem",

        "& > .btn": {
          padding: "0.4rem 0.85rem",
          fontSize: "0.85rem",
          fontWeight: 500,
          borderRadius: "0.375rem",
          cursor: "pointer",
          border: "1px solid transparent",
          transition: "all 0.15s ease-in-out",

          "&.btn-secondary": {
            backgroundColor: "transparent",
            borderColor: "var(--color-border-subtle)",
            color: "var(--color-text-primary)",

            "&:hover": {
              backgroundColor: "var(--color-surface-hover)",
            },
          },

          "&.btn-primary": {
            backgroundColor: "var(--color-accent-primary)",
            color: "var(--color-text-on-strong)",

            "&:hover": {
              backgroundColor: "var(--color-accent-primary-hover)",
            },
          },
        },
      },
    },
  },
});

export default TextNoteModal;
