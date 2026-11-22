import React from "react";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import type AppLanguage from "../../types/settings/appLanguage";

import {
  AUTO_LANGUAGE,
  AVAILABLE_LANGUAGES,
  detectBrowserLanguage,
  getLocaleNativeName,
} from "../../i18n";

export type LanguagePopoverProps = Omit<React.ComponentPropsWithoutRef<"div">, "children"> & {
  isOpen: boolean;
  selectedLanguage: AppLanguage;
  onSelectLanguage: (language: AppLanguage) => void;
  onClose: () => void;
};

// Kompaktes Sprachauswahl-Popover direkt über dem Sprach-Button in der Statusleiste
const LanguagePopover = styled(({
  isOpen,
  selectedLanguage,
  onSelectLanguage,
  onClose,
  ...other
}: LanguagePopoverProps) => {
  const { t } = useTranslation();

  React.useEffect(
    () => {
      if (!isOpen) {
        return undefined;
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

  const detectedBrowserNativeName = getLocaleNativeName(detectBrowserLanguage());

  return (
    <div
      {...other}
      role="menu"
      aria-label={t("statusBar.language.menuAriaLabel")}
      data-component="LanguagePopover"
    >
      <div className="popover-header">{t("dialog.options.languageLabel")}</div>

      <button
        type="button"
        role="menuitemradio"
        aria-checked={selectedLanguage === AUTO_LANGUAGE}
        data-language-option={AUTO_LANGUAGE}
        className={`language-option ${selectedLanguage === AUTO_LANGUAGE ? "active" : ""}`}
        onClick={() => onSelectLanguage(AUTO_LANGUAGE)}
      >
        <span className="option-check" aria-hidden="true">
          {selectedLanguage === AUTO_LANGUAGE ? "✓" : ""}
        </span>
        <span className="option-label">
          {t("dialog.options.languageAuto", { language: detectedBrowserNativeName })}
        </span>
        <span className="option-code">{t("statusBar.language.autoShortBadge")}</span>
      </button>

      <div className="popover-divider" role="separator" />

      {AVAILABLE_LANGUAGES.map((entry) => {
        const isSelected = selectedLanguage === entry.code;
        return (
          <button
            key={entry.code}
            type="button"
            role="menuitemradio"
            aria-checked={isSelected}
            data-language-option={entry.code}
            className={`language-option ${isSelected ? "active" : ""}`}
            onClick={() => onSelectLanguage(entry.code)}
          >
            <span className="option-check" aria-hidden="true">
              {isSelected ? "✓" : ""}
            </span>
            <span className="option-label">{entry.nativeName}</span>
            <span className="option-code">{entry.code.toUpperCase()}</span>
          </button>
        );
      })}
    </div>
  );
})({
  position: "absolute",
  bottom: "calc(100% + 0.45rem)",
  right: 0,
  zIndex: 100,
  minWidth: "15rem",
  maxWidth: "calc(100vw - 2rem)",
  padding: "0.45rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.2rem",
  backgroundColor: "var(--color-bg-surface)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.45rem",
  boxShadow: "0 0.75rem 2rem hsla(220, 40%, 4%, 0.6)",
  color: "var(--color-text-primary)",
  fontSize: "0.78rem",
  textAlign: "left",

  "& > .popover-header": {
    padding: "0.2rem 0.4rem 0.3rem",
    fontSize: "0.7rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--color-text-muted)",
  },

  "& > .popover-divider": {
    height: "1px",
    margin: "0.15rem 0.25rem",
    backgroundColor: "var(--color-border-subtle)",
  },

  "& > .language-option": {
    display: "flex",
    alignItems: "center",
    gap: "0.45rem",
    width: "100%",
    padding: "0.35rem 0.45rem",
    backgroundColor: "transparent",
    border: "1px solid transparent",
    borderRadius: "0.3rem",
    color: "var(--color-text-secondary)",
    fontSize: "0.78rem",
    textAlign: "left",
    cursor: "pointer",
    transition: "background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease",

    "&:hover, &:focus-visible": {
      outline: "none",
      backgroundColor: "var(--color-bg-elevated)",
      color: "var(--color-text-primary)",
    },

    "&.active": {
      backgroundColor: "var(--color-accent-tint)",
      borderColor: "var(--color-accent-primary)",
      color: "var(--color-text-primary)",
      fontWeight: 600,
    },

    "& > .option-check": {
      width: "0.9rem",
      flexShrink: 0,
      color: "var(--color-accent-primary)",
      fontWeight: 700,
      textAlign: "center",
    },

    "& > .option-label": {
      flex: 1,
      whiteSpace: "nowrap",
    },

    "& > .option-code": {
      fontFamily: "var(--font-family-mono)",
      fontSize: "0.68rem",
      fontWeight: 600,
      padding: "0.08rem 0.35rem",
      borderRadius: "0.2rem",
      backgroundColor: "var(--color-bg-base)",
      border: "1px solid var(--color-border-subtle)",
      color: "var(--color-text-muted)",
      flexShrink: 0,
    },
  },
});

export default LanguagePopover;
