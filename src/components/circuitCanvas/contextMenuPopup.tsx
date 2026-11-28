import React from "react";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

export type ContextMenuItem = {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  tooltip?: string;
  danger?: boolean;
  separatorBefore?: boolean;
  onSelect?: () => void;
};

export type ContextMenuPopupProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  ariaLabel?: string;
  onClose: () => void;
};

// Wiederverwendbares Kontextmenü-Popup mit automatischer Viewport-Ausrichtung und Tastatursteuerung
const ContextMenuPopup = styled(({
  isOpen,
  x,
  y,
  items,
  ariaLabel,
  onClose,
  ...other
}: ContextMenuPopupProps) => {
  const { t } = useTranslation();
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const itemButtonRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const [measuredSize, setMeasuredSize] = React.useState<{ width: number; height: number } | null>(null);

  React.useLayoutEffect(
    () => {
      if (!isOpen || !menuRef.current) {
        setMeasuredSize((prev) => (prev === null ? prev : null));
        return;
      }
      const rect = menuRef.current.getBoundingClientRect();
      setMeasuredSize((prev) => (
        prev && prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height }
      ));
    },
    [
      isOpen,
      items,
      x,
      y,
    ],
  );

  React.useEffect(
    () => {
      if (!isOpen) {
        return;
      }

      const handlePointerDown = (event: MouseEvent) => {
        const target = event.target as Node | null;
        if (menuRef.current && target && !menuRef.current.contains(target)) {
          onClose();
        }
      };

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      };

      const handleBlur = () => onClose();

      document.addEventListener("mousedown", handlePointerDown, true);
      window.addEventListener("keydown", handleKeyDown, true);
      window.addEventListener("blur", handleBlur);
      window.addEventListener("resize", handleBlur);
      return () => {
        document.removeEventListener("mousedown", handlePointerDown, true);
        window.removeEventListener("keydown", handleKeyDown, true);
        window.removeEventListener("blur", handleBlur);
        window.removeEventListener("resize", handleBlur);
      };
    },
    [isOpen, onClose],
  );

  if (!isOpen || items.length === 0) {
    return null;
  }

  const menuWidth = measuredSize?.width ?? 230;
  const menuHeight = measuredSize?.height ?? items.length * 32 + 12;
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  const clampedLeft = Math.max(8, Math.min(x, viewportWidth - menuWidth - 8));
  const clampedTop = Math.max(8, Math.min(y, viewportHeight - menuHeight - 8));

  const enabledItems = items.filter((item) => !item.disabled);

  const handleItemKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, itemId: string) => {
    if (enabledItems.length === 0) {
      return;
    }
    const currentIndex = enabledItems.findIndex((item) => item.id === itemId);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = enabledItems[(currentIndex + 1) % enabledItems.length];
      itemButtonRefs.current[next.id]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const prev = enabledItems[(currentIndex - 1 + enabledItems.length) % enabledItems.length];
      itemButtonRefs.current[prev.id]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      {...other}
      ref={menuRef}
      data-component="ContextMenuPopup"
      role="menu"
      aria-label={ariaLabel ?? t("canvas.contextMenu.defaultAriaLabel")}
      style={{
        left: `${clampedLeft}px`,
        top: `${clampedTop}px`,
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {items.map((item) => (
        <React.Fragment key={item.id}>
          {item.separatorBefore && <div className="context-menu-separator" role="separator" />}
          <button
            ref={(el) => {
              itemButtonRefs.current[item.id] = el;
            }}
            type="button"
            role="menuitem"
            className={`context-menu-item${item.danger ? " is-danger" : ""}`}
            disabled={item.disabled}
            title={item.tooltip}
            data-testid={`context-menu-item-${item.id}`}
            onKeyDown={(event) => handleItemKeyDown(event, item.id)}
            onClick={() => {
              if (item.disabled) {
                return;
              }
              onClose();
              item.onSelect?.();
            }}
          >
            <span className="item-label">{item.label}</span>
            {item.shortcut && <span className="item-shortcut">{item.shortcut}</span>}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
})({
  position: "fixed",
  zIndex: 1400,
  minWidth: "13.5rem",
  padding: "0.35rem",
  borderRadius: "0.45rem",
  backgroundColor: "var(--color-bg-surface)",
  border: "1px solid var(--color-border-strong)",
  boxShadow: "0 10px 28px rgba(0, 0, 0, 0.45)",
  display: "flex",
  flexDirection: "column",
  gap: "0.1rem",

  "& > .context-menu-separator": {
    height: "1px",
    margin: "0.25rem 0.35rem",
    backgroundColor: "var(--color-border-subtle)",
  },

  "& > .context-menu-item": {
    appearance: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    width: "100%",
    padding: "0.4rem 0.65rem",
    borderRadius: "0.3rem",
    border: "none",
    backgroundColor: "transparent",
    color: "var(--color-text-primary)",
    fontSize: "0.825rem",
    textAlign: "left",
    cursor: "pointer",
    transition: "background-color 0.1s ease, color 0.1s ease",

    "& > .item-label": {
      whiteSpace: "nowrap",
    },

    "& > .item-shortcut": {
      fontSize: "0.72rem",
      color: "var(--color-text-secondary)",
      fontFamily: "var(--font-family-mono)",
      whiteSpace: "nowrap",
    },

    "&:hover:not(:disabled), &:focus-visible:not(:disabled)": {
      outline: "none",
      backgroundColor: "var(--color-bg-elevated)",
    },

    "&.is-danger:not(:disabled)": {
      color: "var(--color-logic-error)",

      "&:hover, &:focus-visible": {
        backgroundColor: "var(--color-error-bg)",
      },
    },

    "&:disabled": {
      opacity: 0.42,
      cursor: "not-allowed",
    },
  },
});

export default ContextMenuPopup;
