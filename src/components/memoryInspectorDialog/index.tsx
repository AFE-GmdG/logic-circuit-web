import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import SimulationContext from "../../contexts/simulationContext";

import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type GraphicsArray from "../../types/circuit/graphicsArray";
import type Memory from "../../types/circuit/memory";
import type MemoryTextFormat from "../../types/circuit/memoryTextFormat";

import { triggerBlobDownload } from "../../utils/circuitCapture";
import { getGraphicsArrayStrides } from "../../utils/graphicsArrayUtils";
import {
  decodeMemoryData,
  exportMemoryToBinary,
  exportMemoryToText,
  numberCellsFor,
  setCellValue,
} from "../../utils/memoryDataUtils";

import MemoryDataGrid from "../propertyDialog/memoryDataGrid";

export type MemoryInspectorDialogProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  symbol: CircuitSymbol | null;
  memoryInstanceId: string | null;
  circuitPath?: string;
  onClose: () => void;
};

const INSPECTOR_PAGE_SIZE = 256;

const MemoryInspectorDialog = styled(({
  isOpen,
  symbol,
  memoryInstanceId,
  circuitPath,
  onClose,
  ...other
}: MemoryInspectorDialogProps) => {
  const { t } = useTranslation();
  const {
    isSimulating,
    isPaused,
    snapshot,
    readMemorySlice,
    writeMemoryCell,
  } = React.useContext(SimulationContext);

  const memory = symbol?.circuit.kind === "memory" ? (symbol.circuit as Memory) : null;
  const graphicsArray = symbol?.circuit.kind === "graphicsArray"
    ? (symbol.circuit as GraphicsArray)
    : null;

  const targetConfig = React.useMemo(
    () => {
      if (memory) {
        return {
          kind: "memory" as const,
          addressBitWidth: memory.addressBitWidth,
          dataBitWidth: memory.dataBitWidth,
          totalCells: numberCellsFor(memory.addressBitWidth),
          writable: memory.writable,
          dualPort: memory.dualPort,
        };
      }
      if (graphicsArray) {
        const strides = getGraphicsArrayStrides(
          graphicsArray.dataBitWidth,
          graphicsArray.bitsPerPixel,
          graphicsArray.width,
          graphicsArray.height,
        );
        return {
          kind: "graphicsArray" as const,
          addressBitWidth: strides.addressBitWidth,
          dataBitWidth: graphicsArray.dataBitWidth,
          totalCells: strides.totalCells,
          writable: true,
          dualPort: false,
          width: graphicsArray.width,
          height: graphicsArray.height,
          bitsPerPixel: graphicsArray.bitsPerPixel,
        };
      }
      return null;
    },
    [graphicsArray, memory],
  );

  const [page, setPage] = React.useState(0);
  const [format, setFormat] = React.useState<MemoryTextFormat>("hex");
  const [fileFormat, setFileFormat] = React.useState<MemoryTextFormat>("hex");
  const [sliceData, setSliceData] = React.useState<{
    startAddress: number;
    bytes: Uint8Array;
  } | null>(null);
  const [isAvailableInSimulation, setIsAvailableInSimulation] = React.useState(true);
  const [exportError, setExportError] = React.useState<string | null>(null);

  React.useEffect(
    () => {
      setPage(0);
      setExportError(null);
      setIsAvailableInSimulation(true);
      setSliceData(null);
    },
    [isOpen, memoryInstanceId],
  );

  const currentRevision = memoryInstanceId
    ? (snapshot?.memoryRevisions?.[memoryInstanceId] ?? 0)
    : 0;

  // Bedarfsgesteuertes Laden der aktuell sichtbaren Speicherseite aus dem WebWorker
  React.useEffect(
    () => {
      if (!isOpen || !isSimulating || !targetConfig || !memoryInstanceId) {
        return undefined;
      }
      let cancelled = false;
      void readMemorySlice(
        memoryInstanceId,
        page * INSPECTOR_PAGE_SIZE,
        INSPECTOR_PAGE_SIZE,
      ).then((slice) => {
        if (cancelled) {
          return;
        }
        if (slice) {
          setSliceData({ startAddress: slice.startAddress, bytes: slice.bytes });
          setIsAvailableInSimulation(true);
        } else {
          setSliceData(null);
          setIsAvailableInSimulation(false);
        }
      });
      return () => {
        cancelled = true;
      };
    },
    [
      currentRevision,
      isOpen,
      isSimulating,
      memoryInstanceId,
      page,
      readMemorySlice,
      targetConfig,
    ],
  );

  const fallbackBytes = React.useMemo(
    () => {
      if (!memory) {
        return new Uint8Array(0);
      }
      return decodeMemoryData(memory.data, memory.addressBitWidth, memory.dataBitWidth);
    },
    [memory],
  );

  const loadFullMemoryBytes = React.useCallback(
    async (): Promise<Uint8Array> => {
      if (!targetConfig) {
        return new Uint8Array(0);
      }
      if (isSimulating && memoryInstanceId && isAvailableInSimulation) {
        const fullSlice = await readMemorySlice(memoryInstanceId, 0, targetConfig.totalCells);
        if (fullSlice) {
          return fullSlice.bytes;
        }
      }
      return fallbackBytes;
    },
    [
      fallbackBytes,
      isAvailableInSimulation,
      isSimulating,
      memoryInstanceId,
      readMemorySlice,
      targetConfig,
    ],
  );

  const handleSaveBinary = React.useCallback(
    async () => {
      if (!targetConfig) {
        return;
      }
      try {
        const bytes = await loadFullMemoryBytes();
        const bin = exportMemoryToBinary(
          bytes,
          targetConfig.addressBitWidth,
          targetConfig.dataBitWidth,
          targetConfig.totalCells,
        );
        const fileName = graphicsArray
          ? `graphics-array-${graphicsArray.width}x${graphicsArray.height}-${graphicsArray.bitsPerPixel}bpp.bin`
          : `${targetConfig.writable ? "ram" : "rom"}-${targetConfig.addressBitWidth}x${targetConfig.dataBitWidth}.bin`;
        triggerBlobDownload(
          new Blob([new Uint8Array(bin)], { type: "application/octet-stream" }),
          fileName,
        );
        setExportError(null);
      } catch {
        setExportError(t("dialog.memoryInspector.exportError"));
      }
    },
    [
      graphicsArray,
      loadFullMemoryBytes,
      t,
      targetConfig,
    ],
  );

  const handleSaveText = React.useCallback(
    async () => {
      if (!targetConfig) {
        return;
      }
      try {
        const bytes = await loadFullMemoryBytes();
        const text = exportMemoryToText(
          bytes,
          fileFormat,
          targetConfig.addressBitWidth,
          targetConfig.dataBitWidth,
          targetConfig.totalCells,
        );
        const fileName = graphicsArray
          ? `graphics-array-${graphicsArray.width}x${graphicsArray.height}-${graphicsArray.bitsPerPixel}bpp.${fileFormat}.txt`
          : `${targetConfig.writable ? "ram" : "rom"}-${targetConfig.addressBitWidth}x${targetConfig.dataBitWidth}.${fileFormat}.txt`;
        triggerBlobDownload(
          new Blob([text], { type: "text/plain;charset=utf-8" }),
          fileName,
        );
        setExportError(null);
      } catch {
        setExportError(t("dialog.memoryInspector.exportError"));
      }
    },
    [
      fileFormat,
      graphicsArray,
      loadFullMemoryBytes,
      t,
      targetConfig,
    ],
  );

  const handleCellChange = React.useCallback(
    (address: number, value: number) => {
      if (!targetConfig || !targetConfig.writable || !memoryInstanceId || !isSimulating || !isPaused) {
        return;
      }
      setSliceData((prev) => {
        if (!prev) {
          return prev;
        }
        const copy = new Uint8Array(prev.bytes);
        setCellValue(copy, targetConfig.dataBitWidth, address - prev.startAddress, value);
        return { startAddress: prev.startAddress, bytes: copy };
      });
      void writeMemoryCell(memoryInstanceId, address, value);
    },
    [
      isPaused,
      isSimulating,
      memoryInstanceId,
      targetConfig,
      writeMemoryCell,
    ],
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
      }
    },
    [onClose],
  );

  if (!isOpen || !symbol || !targetConfig) {
    return null;
  }

  const canEditCells = Boolean(
    targetConfig.writable && isSimulating && isPaused && isAvailableInSimulation,
  );
  const displayBytes = sliceData ? sliceData.bytes : fallbackBytes;
  const sliceStartAddress = sliceData ? sliceData.startAddress : 0;

  let statusKey = "dialog.memoryInspector.statusRomReadOnly";
  let statusKind: "rom" | "running" | "paused" | "inactive" = "rom";
  if (!isAvailableInSimulation) {
    statusKey = "dialog.memoryInspector.statusInactive";
    statusKind = "inactive";
  } else if (targetConfig.writable) {
    if (isPaused) {
      statusKey = "dialog.memoryInspector.statusRamPausedEditable";
      statusKind = "paused";
    } else {
      statusKey = "dialog.memoryInspector.statusRamRunningReadOnly";
      statusKind = "running";
    }
  }

  const titleText = graphicsArray
    ? t("dialog.memoryInspector.titleGraphicsArray")
    : (targetConfig.writable
      ? t("dialog.memoryInspector.titleRam")
      : t("dialog.memoryInspector.titleRom"));

  const modalContent = (
    <div
      {...other}
      data-component="MemoryInspectorDialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="memory-inspector-title"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="header-title-wrap">
            <h3 id="memory-inspector-title" className="modal-title">
              {titleText}
            </h3>
            {circuitPath && (
              <span className="instance-path">
                {t("dialog.memoryInspector.instancePathLabel", { path: circuitPath })}
              </span>
            )}
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label={t("dialog.memoryInspector.closeAriaLabel")}
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="inspector-meta-bar">
            <div className="meta-badges">
              {graphicsArray && (
                <span className="meta-badge">
                  {t("dialog.memoryInspector.graphicsResolutionBadge", {
                    width: graphicsArray.width,
                    height: graphicsArray.height,
                    bitsPerPixel: graphicsArray.bitsPerPixel,
                  })}
                </span>
              )}
              <span className="meta-badge">
                {t("dialog.memoryInspector.addressBitWidth", { bits: targetConfig.addressBitWidth })}
              </span>
              <span className="meta-badge">
                {t("dialog.memoryInspector.dataBitWidth", { bits: targetConfig.dataBitWidth })}
              </span>
              {targetConfig.dualPort && (
                <span className="meta-badge">{t("dialog.memoryInspector.dualPortBadge")}</span>
              )}
            </div>
            <span className={`status-badge status-${statusKind}`} data-status={statusKind}>
              {t(statusKey)}
            </span>
          </div>

          {!isAvailableInSimulation && (
            <div className="inspector-notice" role="status">
              {t("dialog.memoryInspector.inactiveNotice")}
            </div>
          )}

          <div className="memory-file-toolbar">
            <button
              type="button"
              className="memory-action-btn"
              onClick={() => {
                void handleSaveBinary();
              }}
            >
              {t("dialog.property.memorySaveBinary")}
            </button>
            <span className="toolbar-divider" />
            <select
              className="memory-format-select"
              value={fileFormat}
              aria-label={t("dialog.property.memoryTextFormatAriaLabel")}
              onChange={(e) => setFileFormat(e.target.value as MemoryTextFormat)}
            >
              <option value="hex">{t("common.numberFormats.hex")}</option>
              <option value="dec">{t("common.numberFormats.dec")}</option>
              <option value="bin">{t("common.numberFormats.bin")}</option>
            </select>
            <button
              type="button"
              className="memory-action-btn"
              onClick={() => {
                void handleSaveText();
              }}
            >
              {t("dialog.property.memorySaveText")}
            </button>
          </div>

          <MemoryDataGrid
            addressBitWidth={targetConfig.addressBitWidth}
            dataBitWidth={targetConfig.dataBitWidth}
            totalCells={targetConfig.totalCells}
            data={displayBytes}
            sliceStartAddress={sliceStartAddress}
            format={format}
            onFormatChange={setFormat}
            readOnly={!canEditCells}
            page={page}
            onPageChange={setPage}
            pageSize={INSPECTOR_PAGE_SIZE}
            onCellChange={handleCellChange}
          />

          {exportError && (
            <div className="inspector-error" role="alert">
              {exportError}
            </div>
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
    width: "54rem",
    maxWidth: "95vw",
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
      gap: "0.75rem",
      padding: "0.85rem 1.25rem",
      borderBottom: "1px solid var(--color-border-subtle)",

      "& > .header-title-wrap": {
        display: "flex",
        flexDirection: "column",
        gap: "0.15rem",

        "& > .modal-title": {
          margin: 0,
          fontSize: "1.1rem",
          fontWeight: 600,
        },

        "& > .instance-path": {
          fontSize: "0.75rem",
          fontFamily: "var(--font-family-mono)",
          color: "var(--color-text-secondary)",
        },
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
      gap: "0.75rem",

      "& > .inspector-meta-bar": {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "0.5rem",

        "& > .meta-badges": {
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.4rem",

          "& > .meta-badge": {
            padding: "0.2rem 0.5rem",
            borderRadius: "0.25rem",
            border: "1px solid var(--color-border-subtle)",
            backgroundColor: "var(--color-bg-base)",
            color: "var(--color-text-secondary)",
            fontSize: "0.75rem",
            fontFamily: "var(--font-family-mono)",
          },
        },

        "& > .status-badge": {
          padding: "0.2rem 0.6rem",
          borderRadius: "999rem",
          fontSize: "0.75rem",
          fontWeight: 600,
          border: "1px solid var(--color-border-subtle)",
          backgroundColor: "var(--color-bg-base)",
          color: "var(--color-text-secondary)",

          "&.status-paused": {
            borderColor: "var(--color-accent-primary)",
            backgroundColor: "var(--color-accent-primary-bg)",
            color: "var(--color-text-primary)",
          },
        },
      },

      "& > .inspector-notice": {
        padding: "0.5rem 0.7rem",
        borderRadius: "0.35rem",
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-base)",
        color: "var(--color-text-secondary)",
        fontSize: "0.8rem",
      },

      "& > .memory-file-toolbar": {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "0.4rem",

        "& > .memory-action-btn": {
          padding: "0.28rem 0.6rem",
          borderRadius: "0.3rem",
          border: "1px solid var(--color-border-subtle)",
          backgroundColor: "var(--color-bg-base)",
          color: "var(--color-text-primary)",
          fontSize: "0.78rem",
          cursor: "pointer",

          "&:hover": {
            borderColor: "var(--color-accent-primary)",
          },
        },

        "& > .memory-format-select": {
          padding: "0.26rem 0.45rem",
          borderRadius: "0.3rem",
          border: "1px solid var(--color-border-subtle)",
          backgroundColor: "var(--color-bg-base)",
          color: "var(--color-text-primary)",
          fontSize: "0.78rem",
        },

        "& > .toolbar-divider": {
          width: "1px",
          height: "1.25rem",
          backgroundColor: "var(--color-border-subtle)",
        },
      },

      "& > .inspector-error": {
        fontSize: "0.78rem",
        color: "var(--color-logic-error)",
      },
    },

    "& > .modal-footer": {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      padding: "0.75rem 1.25rem",
      borderTop: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-bg-base)",

      "& > .btn": {
        padding: "0.4rem 0.9rem",
        fontSize: "0.85rem",
        fontWeight: 500,
        borderRadius: "0.375rem",
        cursor: "pointer",
        border: "1px solid transparent",

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
});

export default MemoryInspectorDialog;
