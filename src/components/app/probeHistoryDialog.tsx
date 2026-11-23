import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import SimulationContext from "../../contexts/simulationContext";

import type CircuitProbe from "../../types/circuit/circuitProbe";
import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type ProbeFormat from "../../types/circuit/probeFormat";
import type {
  ProbeHistorySnapshot,
  ProbeHistoryValueEntry,
} from "../../types/simulation/oscilloscope";

export type FloatingDialogPosition = {
  x: number;
  y: number;
};

export type ProbeHistoryDialogProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  symbol: CircuitSymbol | null;
  probeInstanceId: string | null;
  circuitPath?: string;
  initialHistory?: ProbeHistorySnapshot | null;
  onClose: () => void;
};

const DEFAULT_FLOATING_WIDTH_PX = 416;
const DEFAULT_FLOATING_HEIGHT_PX = 360;
const FLOATING_VIEWPORT_MARGIN_PX = 8;

// Begrenzt die Position des schwebenden Werkzeugfensters auf die sichtbaren Browser-Grenzen
export function clampFloatingDialogPosition(
  pos: FloatingDialogPosition,
  dialogSize: { width: number; height: number },
  viewportSize: { width: number; height: number },
  margin = FLOATING_VIEWPORT_MARGIN_PX,
): FloatingDialogPosition {
  const safeMargin = Math.max(0, margin);
  const maxX = Math.max(safeMargin, viewportSize.width - dialogSize.width - safeMargin);
  const maxY = Math.max(safeMargin, viewportSize.height - dialogSize.height - safeMargin);
  return {
    x: Math.min(Math.max(pos.x, safeMargin), maxX),
    y: Math.min(Math.max(pos.y, safeMargin), maxY),
  };
}

function getDefaultFloatingPosition(): FloatingDialogPosition {
  if (typeof window === "undefined") {
    return { x: 48, y: 72 };
  }
  return clampFloatingDialogPosition(
    {
      x: window.innerWidth - DEFAULT_FLOATING_WIDTH_PX - 20,
      y: 72,
    },
    {
      width: DEFAULT_FLOATING_WIDTH_PX,
      height: DEFAULT_FLOATING_HEIGHT_PX,
    },
    {
      width: window.innerWidth,
      height: window.innerHeight,
    },
  );
}

// Ermittelt das initiale Anzeigeformat einer Messsonde gemäß ihren Projekteigenschaften
export function resolveInitialProbeFormat(symbol: CircuitSymbol | null): ProbeFormat {
  if (!symbol || symbol.circuit.kind !== "circuitProbe") {
    return "hex";
  }
  const probe = symbol.circuit as Partial<CircuitProbe>;
  if (probe.displayFormat === "hex" || probe.displayFormat === "dec" || probe.displayFormat === "bin") {
    return probe.displayFormat;
  }
  return probe.isHex === false ? "bin" : "hex";
}

// Formatiert einen einzelnen Wert-Eintrag im gewünschten Zahlensystem (Hex, Dezimal oder Binär)
export function formatProbeHistoryEntryValue(
  entry: ProbeHistoryValueEntry,
  format: ProbeFormat,
): string {
  if (format === "dec") {
    return entry.textDec;
  }
  if (format === "bin") {
    return entry.textBin;
  }
  return entry.textHex;
}

// Erzeugt den Zwischenablage-Text für die komplette Verlaufsliste inklusive Markierungen
export function formatProbeHistoryClipboardText(
  history: ProbeHistorySnapshot,
  format: ProbeFormat,
  markSeparator = "-------------",
): string {
  return history.entries
    .map((entry) => (
      entry.kind === "mark"
        ? markSeparator
        : formatProbeHistoryEntryValue(entry, format)
    ))
    .join("\n");
}

// Schwebender, frei verschiebbarer Messsonden-Verlaufsdialog (DialogProbeHistory) ohne Hintergrund-Abdunkelung
const ProbeHistoryDialog = styled(({
  isOpen,
  symbol,
  probeInstanceId,
  circuitPath,
  initialHistory = null,
  onClose,
  style: externalStyle,
  ...other
}: ProbeHistoryDialogProps) => {
  const { t } = useTranslation();
  const {
    isSimulating,
    snapshot,
    readProbeHistory,
    markProbeHistory,
  } = React.useContext(SimulationContext);

  const [format, setFormat] = React.useState<ProbeFormat>(() => resolveInitialProbeFormat(symbol));
  const [historyData, setHistoryData] = React.useState<ProbeHistorySnapshot | null>(initialHistory);
  const [isAvailableInSimulation, setIsAvailableInSimulation] = React.useState(true);
  const [copyStatus, setCopyStatus] = React.useState<"idle" | "copied" | "failed">("idle");
  const [position, setPosition] = React.useState<FloatingDialogPosition>(() => getDefaultFloatingPosition());
  const [isDragging, setIsDragging] = React.useState(false);

  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const dragOriginRef = React.useRef<{
    pointerX: number;
    pointerY: number;
    startX: number;
    startY: number;
  } | null>(null);

  React.useEffect(
    () => {
      if (!isOpen) {
        setIsDragging(false);
        dragOriginRef.current = null;
        return;
      }
      setFormat(resolveInitialProbeFormat(symbol));
      setCopyStatus("idle");
      setIsAvailableInSimulation(true);
      setHistoryData(initialHistory ?? null);
    },
    [
      initialHistory,
      isOpen,
      probeInstanceId,
      symbol,
    ],
  );

  // Initialisiert beim Öffnen die Standardposition rechts oben, damit das Schaltungs-Canvas sichtbar bleibt
  React.useEffect(
    () => {
      if (isOpen) {
        setPosition(getDefaultFloatingPosition());
      }
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

  // Hält das schwebende Fenster bei Größenänderungen des Browserfensters innerhalb der Sichtgrenzen
  React.useEffect(
    () => {
      if (!isOpen || typeof window === "undefined") {
        return;
      }
      const handleResize = () => {
        const rect = dialogRef.current?.getBoundingClientRect();
        const dialogSize = {
          width: rect && rect.width > 0 ? rect.width : DEFAULT_FLOATING_WIDTH_PX,
          height: rect && rect.height > 0 ? rect.height : DEFAULT_FLOATING_HEIGHT_PX,
        };
        setPosition((prev) =>
          clampFloatingDialogPosition(prev, dialogSize, {
            width: window.innerWidth,
            height: window.innerHeight,
          }),
        );
      };

      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    },
    [isOpen],
  );

  // Verarbeitet flüssiges Verschieben per Pointer-Drag auf der Titelleiste
  React.useEffect(
    () => {
      if (!isDragging || typeof window === "undefined") {
        return;
      }

      const handlePointerMove = (event: PointerEvent) => {
        const origin = dragOriginRef.current;
        if (!origin) {
          return;
        }
        const rect = dialogRef.current?.getBoundingClientRect();
        const dialogSize = {
          width: rect && rect.width > 0 ? rect.width : DEFAULT_FLOATING_WIDTH_PX,
          height: rect && rect.height > 0 ? rect.height : DEFAULT_FLOATING_HEIGHT_PX,
        };
        const nextRaw = {
          x: origin.startX + (event.clientX - origin.pointerX),
          y: origin.startY + (event.clientY - origin.pointerY),
        };
        setPosition(
          clampFloatingDialogPosition(nextRaw, dialogSize, {
            width: window.innerWidth,
            height: window.innerHeight,
          }),
        );
      };

      const stopDragging = () => {
        dragOriginRef.current = null;
        setIsDragging(false);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopDragging);
      window.addEventListener("pointercancel", stopDragging);
      return () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopDragging);
        window.removeEventListener("pointercancel", stopDragging);
      };
    },
    [isDragging],
  );

  React.useEffect(
    () => {
      if (!isOpen || !isSimulating || !probeInstanceId) {
        return undefined;
      }
      let cancelled = false;
      void readProbeHistory(probeInstanceId).then((nextHistory) => {
        if (cancelled) {
          return;
        }
        if (nextHistory) {
          setHistoryData(nextHistory);
          setIsAvailableInSimulation(true);
        } else {
          setIsAvailableInSimulation(false);
        }
      });
      return () => {
        cancelled = true;
      };
    },
    [
      isOpen,
      isSimulating,
      probeInstanceId,
      readProbeHistory,
      snapshot,
    ],
  );

  const handleHeaderPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest("button")) {
        return;
      }
      event.preventDefault();
      dragOriginRef.current = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        startX: position.x,
        startY: position.y,
      };
      setIsDragging(true);
    },
    [position.x, position.y],
  );

  const handleMark = React.useCallback(
    async () => {
      if (!probeInstanceId || !isSimulating) {
        return;
      }
      const updated = await markProbeHistory(probeInstanceId);
      if (updated) {
        setHistoryData(updated);
        setIsAvailableInSimulation(true);
      }
    },
    [
      isSimulating,
      markProbeHistory,
      probeInstanceId,
    ],
  );

  const handleCopy = React.useCallback(
    async () => {
      if (!historyData || historyData.entries.length === 0) {
        return;
      }
      const text = formatProbeHistoryClipboardText(
        historyData,
        format,
        t("dialog.probeHistory.markSeparator"),
      );
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          setCopyStatus("copied");
        } else {
          setCopyStatus("failed");
        }
      } catch {
        setCopyStatus("failed");
      }
    },
    [
      format,
      historyData,
      t,
    ],
  );

  if (!isOpen) {
    return null;
  }

  const probeName = symbol?.circuit.name?.trim() || historyData?.label || "";
  const resolvedTitle = probeName
    ? t("dialog.probeHistory.title", { name: probeName })
    : t("dialog.probeHistory.titleFallback");
  const resolvedPath = circuitPath || historyData?.path || probeName;
  const bitWidth = historyData?.bitWidth ?? 0;
  const entries = historyData?.entries ?? [];
  const markAllowed = Boolean(isAvailableInSimulation && historyData?.markAllowed);
  const firstValueIndex = entries.findIndex((entry) => entry.kind === "value");

  const floatingContent = (
    <div
      {...other}
      ref={dialogRef}
      data-component="ProbeHistoryDialog"
      data-dragging={isDragging ? "true" : "false"}
      role="dialog"
      aria-modal="false"
      aria-labelledby="probe-history-dialog-title"
      style={{
        ...externalStyle,
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      <div
        className={`modal-header${isDragging ? " is-dragging" : ""}`}
        onPointerDown={handleHeaderPointerDown}
      >
        <h2 id="probe-history-dialog-title" className="modal-title">
          {resolvedTitle}
        </h2>
        <button
          type="button"
          className="close-btn"
          aria-label={t("dialog.probeHistory.closeAriaLabel")}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="modal-toolbar">
        <div className="meta-badges">
          <span className="meta-badge" data-testid="probe-history-bitwidth">
            {t("dialog.probeHistory.bitWidthLabel", { bits: bitWidth })}
          </span>
          {resolvedPath && (
            <span className="meta-badge path-badge" title={resolvedPath}>
              {t("dialog.probeHistory.instancePathLabel", { path: resolvedPath })}
            </span>
          )}
        </div>

        <div
          className="format-switcher"
          role="group"
          aria-label={t("dialog.probeHistory.formatGroupAriaLabel")}
        >
          {(["hex", "dec", "bin"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={`format-btn${format === candidate ? " active" : ""}`}
              aria-pressed={format === candidate}
              onClick={() => {
                setFormat(candidate);
                setCopyStatus("idle");
              }}
            >
              {candidate === "hex"
                ? t("dialog.probeHistory.formatHex")
                : candidate === "dec"
                  ? t("dialog.probeHistory.formatDec")
                  : t("dialog.probeHistory.formatBin")}
            </button>
          ))}
        </div>
      </div>

      <div className="modal-body">
        {!isAvailableInSimulation || (historyData && bitWidth === 0) ? (
          <div className="empty-state" data-testid="probe-history-inactive">
            {t("dialog.probeHistory.inactiveNotice")}
          </div>
        ) : entries.length === 0 ? (
          <div className="empty-state" data-testid="probe-history-empty">
            {t("dialog.probeHistory.emptyHistory")}
          </div>
        ) : (
          <div
            className="history-list"
            role="list"
            aria-label={t("dialog.probeHistory.historyListAriaLabel")}
          >
            {entries.map((entry, idx) => {
              if (entry.kind === "mark") {
                return (
                  <div
                    key={`mark-${idx}`}
                    role="listitem"
                    className="history-item is-mark"
                    data-testid="probe-history-mark"
                  >
                    <span className="mark-line">{t("dialog.probeHistory.markSeparator")}</span>
                  </div>
                );
              }
              const isLatest = idx === firstValueIndex;
              return (
                <div
                  key={`val-${idx}`}
                  role="listitem"
                  className={`history-item${isLatest ? " is-latest" : ""}`}
                  data-testid="probe-history-value"
                >
                  <span className="value-text">
                    {formatProbeHistoryEntryValue(entry, format)}
                  </span>
                  {isLatest && (
                    <span className="latest-badge">
                      {t("dialog.probeHistory.latestBadge")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="modal-footer">
        <div className="footer-left-actions">
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="probe-history-mark-btn"
            disabled={!markAllowed}
            title={
              markAllowed
                ? t("dialog.probeHistory.markButtonTooltip")
                : t("dialog.probeHistory.markDisabledTooltip")
            }
            onClick={() => {
              void handleMark();
            }}
          >
            {t("dialog.probeHistory.markButton")}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="probe-history-copy-btn"
            disabled={entries.length === 0}
            onClick={() => {
              void handleCopy();
            }}
          >
            {copyStatus === "copied"
              ? t("dialog.probeHistory.copiedButton")
              : t("dialog.probeHistory.copyButton")}
          </button>
          {copyStatus === "failed" && (
            <span className="copy-error-text" role="status">
              {t("dialog.probeHistory.copyFailed")}
            </span>
          )}
        </div>

        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
    </div>
  );

  if (typeof document !== "undefined" && document.body) {
    return ReactDOM.createPortal(floatingContent, document.body);
  }

  return floatingContent;
})({
  position: "fixed",
  zIndex: 1100,
  width: "26rem",
  maxWidth: "calc(100vw - 1rem)",
  maxHeight: "calc(100vh - 1rem)",
  backgroundColor: "var(--color-bg-surface)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.5rem",
  boxShadow: "0 0.75rem 2.25rem rgba(0, 0, 0, 0.55)",
  color: "var(--color-text-primary)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",

  "& > .modal-header": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    padding: "0.75rem 1rem",
    borderBottom: "1px solid var(--color-border-subtle)",
    backgroundColor: "var(--color-bg-elevated)",
    cursor: "grab",
    userSelect: "none",
    touchAction: "none",

    "&.is-dragging": {
      cursor: "grabbing",
    },

    "& > .modal-title": {
      margin: 0,
      fontSize: "0.92rem",
      fontWeight: 600,
      color: "var(--color-text-primary)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },

    "& > .close-btn": {
      background: "transparent",
      border: "none",
      color: "var(--color-text-secondary)",
      fontSize: "1rem",
      cursor: "pointer",
      padding: "0.2rem 0.4rem",
      borderRadius: "0.25rem",
      flexShrink: 0,

      "&:hover": {
        color: "var(--color-text-primary)",
        backgroundColor: "var(--color-bg-surface)",
      },
    },
  },

  "& > .modal-toolbar": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.6rem",
    flexWrap: "wrap",
    padding: "0.6rem 1rem",
    borderBottom: "1px solid var(--color-border-subtle)",
    backgroundColor: "var(--color-bg-base)",

    "& > .meta-badges": {
      display: "flex",
      alignItems: "center",
      gap: "0.4rem",
      flexWrap: "wrap",
      minWidth: 0,

      "& > .meta-badge": {
        padding: "0.18rem 0.5rem",
        borderRadius: "0.25rem",
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-elevated)",
        color: "var(--color-text-secondary)",
        fontSize: "0.75rem",
        fontWeight: 600,
      },

      "& > .path-badge": {
        maxWidth: "12rem",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },
    },

    "& > .format-switcher": {
      display: "inline-flex",
      borderRadius: "0.3rem",
      border: "1px solid var(--color-border-strong)",
      overflow: "hidden",

      "& > .format-btn": {
        padding: "0.24rem 0.55rem",
        border: "none",
        backgroundColor: "var(--color-bg-elevated)",
        color: "var(--color-text-secondary)",
        fontSize: "0.75rem",
        fontWeight: 600,
        cursor: "pointer",

        "&:not(:last-child)": {
          borderRight: "1px solid var(--color-border-subtle)",
        },

        "&.active": {
          backgroundColor: "var(--color-accent-primary)",
          color: "var(--color-text-on-accent)",
        },
      },
    },
  },

  "& > .modal-body": {
    padding: "0.85rem 1rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    overflowY: "auto",
    minHeight: "10rem",
    maxHeight: "22rem",

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

    "& > .history-list": {
      display: "flex",
      flexDirection: "column",
      gap: "0.3rem",

      "& > .history-item": {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.75rem",
        padding: "0.42rem 0.7rem",
        borderRadius: "0.3rem",
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-base)",
        fontFamily: "var(--font-family-mono)",
        fontSize: "0.84rem",
        color: "var(--color-text-primary)",

        "&.is-latest": {
          borderColor: "var(--color-accent-primary)",
          backgroundColor: "var(--color-accent-tint-subtle)",
          fontWeight: 700,
        },

        "&.is-mark": {
          justifyContent: "center",
          borderStyle: "dashed",
          color: "var(--color-text-muted)",
          fontWeight: 600,
          letterSpacing: "0.08rem",
        },

        "& > .value-text": {
          wordBreak: "break-all",
        },

        "& > .latest-badge": {
          flexShrink: 0,
          padding: "0.1rem 0.4rem",
          borderRadius: "0.22rem",
          backgroundColor: "var(--color-accent-primary)",
          color: "var(--color-text-on-accent)",
          fontFamily: "var(--font-family-base)",
          fontSize: "0.68rem",
          fontWeight: 600,
        },
      },
    },
  },

  "& > .modal-footer": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    padding: "0.75rem 1rem",
    borderTop: "1px solid var(--color-border-subtle)",
    backgroundColor: "var(--color-bg-elevated)",

    "& > .footer-left-actions": {
      display: "flex",
      alignItems: "center",
      gap: "0.5rem",
      flexWrap: "wrap",

      "& > .copy-error-text": {
        fontSize: "0.75rem",
        color: "var(--color-error-text)",
      },
    },

    "& .btn": {
      padding: "0.42rem 0.85rem",
      borderRadius: "0.3rem",
      fontSize: "0.84rem",
      fontWeight: 600,
      cursor: "pointer",
      border: "1px solid transparent",
      transition: "all 0.12s ease",

      "&:disabled": {
        opacity: 0.45,
        cursor: "not-allowed",
      },

      "&.btn-secondary": {
        backgroundColor: "var(--color-bg-surface)",
        borderColor: "var(--color-border-strong)",
        color: "var(--color-text-primary)",

        "&:hover:not(:disabled)": {
          backgroundColor: "var(--color-bg-base)",
        },
      },

      "&.btn-primary": {
        backgroundColor: "var(--color-accent-primary)",
        color: "var(--color-text-on-accent)",

        "&:hover:not(:disabled)": {
          backgroundColor: "var(--color-accent-primary-hover)",
        },
      },
    },
  },
});

export default ProbeHistoryDialog;
