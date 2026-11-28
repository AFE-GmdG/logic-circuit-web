import React from "react";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import type MemoryTextFormat from "../../types/circuit/memoryTextFormat";

import {
  binDigitsFor,
  clampDataBitWidth,
  formatCellValue,
  getCellValue,
  hexDigitsFor,
  numberCellsFor,
  parseCellInput,
} from "../../utils/memoryDataUtils";

export type MemoryDataGridProps = Omit<React.ComponentPropsWithoutRef<"div">, "onChange"> & {
  addressBitWidth: number;
  dataBitWidth: number;
  totalCells?: number;
  data: Uint8Array;
  sliceStartAddress?: number;
  format: MemoryTextFormat;
  onFormatChange: (format: MemoryTextFormat) => void;
  readOnly?: boolean;
  disabled?: boolean;
  page?: number;
  onPageChange?: (page: number) => void;
  pageSize?: number;
  onCellChange?: (address: number, value: number) => void;
};

const DEFAULT_PAGE_SIZE = 256;

const MemoryDataGrid = styled(({
  addressBitWidth,
  dataBitWidth,
  totalCells: totalCellsProp,
  data,
  sliceStartAddress = 0,
  format,
  onFormatChange,
  readOnly = false,
  disabled = false,
  page,
  onPageChange,
  pageSize = DEFAULT_PAGE_SIZE,
  onCellChange,
  className,
  ...other
}: MemoryDataGridProps) => {
  const { t } = useTranslation();

  const safeAddrBits = Math.max(
    1,
    Math.min(22, Number.isFinite(addressBitWidth) ? Math.trunc(addressBitWidth) : 1),
  );
  const safeDataBits = clampDataBitWidth(dataBitWidth);
  const totalCells =
    totalCellsProp !== undefined
      ? Math.max(1, Math.trunc(totalCellsProp))
      : numberCellsFor(safeAddrBits);
  const cols = Math.min(16, totalCells);
  const safePageSize = Math.max(cols, pageSize);
  const totalPages = Math.max(1, Math.ceil(totalCells / safePageSize));

  const [internalPage, setInternalPage] = React.useState(0);
  const effectivePage = Math.max(0, Math.min(totalPages - 1, page ?? internalPage));
  const pageStart = effectivePage * safePageSize;
  const pageEnd = Math.min(totalCells, pageStart + safePageSize);
  const addrHexDigits = Math.max(1, hexDigitsFor(safeAddrBits));
  const valueCharWidth =
    format === "bin"
      ? binDigitsFor(safeDataBits)
      : format === "hex"
        ? hexDigitsFor(safeDataBits)
        : Math.max(3, String((1 << Math.min(31, safeDataBits)) - 1).length + (safeDataBits === 32 ? 1 : 0));

  const [editingCell, setEditingCell] = React.useState<{ address: number; draft: string } | null>(null);
  const [cellError, setCellError] = React.useState<string | null>(null);
  const [gotoAddressInput, setGotoAddressInput] = React.useState("");
  const [highlightedAddress, setHighlightedAddress] = React.useState<number | null>(null);

  React.useEffect(
    () => {
      setEditingCell(null);
      setCellError(null);
    },
    [
      effectivePage,
      format,
      safeAddrBits,
      safeDataBits,
    ],
  );

  React.useEffect(
    () => {
      if (internalPage >= totalPages) {
        setInternalPage(Math.max(0, totalPages - 1));
      }
    },
    [internalPage, totalPages],
  );

  const selectPage = React.useCallback(
    (nextPage: number) => {
      const clamped = Math.max(0, Math.min(totalPages - 1, nextPage));
      if (onPageChange) {
        onPageChange(clamped);
      } else {
        setInternalPage(clamped);
      }
      setEditingCell(null);
      setCellError(null);
    },
    [onPageChange, totalPages],
  );

  const handleGotoSubmit = React.useCallback(
    () => {
      const cleaned = gotoAddressInput.trim().replace(/^0x/i, "");
      if (!cleaned || !/^[0-9a-fA-F]+$/.test(cleaned)) {
        setCellError(t("dialog.property.memoryErrorInvalidNumber"));
        return;
      }
      const parsedAddr = Number.parseInt(cleaned, 16);
      if (!Number.isFinite(parsedAddr) || parsedAddr < 0 || parsedAddr >= totalCells) {
        const maxHex = (totalCells - 1).toString(16).toUpperCase().padStart(addrHexDigits, "0");
        setCellError(
          t("dialog.property.memoryErrorOutOfRange", {
            min: "0".padStart(addrHexDigits, "0"),
            max: maxHex,
          }),
        );
        return;
      }
      const targetPage = Math.floor(parsedAddr / safePageSize);
      setHighlightedAddress(parsedAddr);
      selectPage(targetPage);
    },
    [
      addrHexDigits,
      gotoAddressInput,
      safePageSize,
      selectPage,
      t,
      totalCells,
    ],
  );

  const rowCount = Math.ceil((pageEnd - pageStart) / cols);
  const fromAddrLabel = pageStart.toString(16).toUpperCase().padStart(addrHexDigits, "0");
  const toAddrLabel = Math.max(pageStart, pageEnd - 1).toString(16).toUpperCase().padStart(addrHexDigits, "0");
  const isCellLocked = readOnly || disabled;

  return (
    <div
      {...other}
      data-component="MemoryDataGrid"
      data-readonly={readOnly ? "true" : "false"}
      data-disabled={disabled ? "true" : "false"}
      className={`${className ?? ""} format-${format}${disabled ? " is-disabled" : ""}`.trim()}
    >
      <div className="grid-toolbar">
        <div
          className="format-switcher"
          role="radiogroup"
          aria-label={t("dialog.memoryGrid.formatGroupAriaLabel")}
        >
          <button
            type="button"
            className={`format-btn${format === "hex" ? " active" : ""}`}
            aria-pressed={format === "hex"}
            disabled={disabled}
            onClick={() => onFormatChange("hex")}
          >
            {t("common.numberFormats.hex")}
          </button>
          <button
            type="button"
            className={`format-btn${format === "dec" ? " active" : ""}`}
            aria-pressed={format === "dec"}
            disabled={disabled}
            onClick={() => onFormatChange("dec")}
          >
            {t("common.numberFormats.dec")}
          </button>
          <button
            type="button"
            className={`format-btn${format === "bin" ? " active" : ""}`}
            aria-pressed={format === "bin"}
            disabled={disabled}
            onClick={() => onFormatChange("bin")}
          >
            {t("common.numberFormats.bin")}
          </button>
        </div>

        <span className="capacity-badge">
          {t("dialog.memoryGrid.capacityLabel", { cells: totalCells, bits: safeDataBits })}
        </span>
      </div>

      {totalPages > 1 && (
        <div className="grid-pagination">
          <div className="page-nav">
            <button
              type="button"
              className="page-btn"
              disabled={disabled || effectivePage <= 0}
              aria-label={t("dialog.memoryGrid.prevPageAriaLabel")}
              onClick={() => selectPage(effectivePage - 1)}
            >
              ‹
            </button>
            <span className="page-indicator">
              {t("dialog.memoryGrid.pageIndicator", {
                current: effectivePage + 1,
                total: totalPages,
                from: fromAddrLabel,
                to: toAddrLabel,
              })}
            </span>
            <button
              type="button"
              className="page-btn"
              disabled={disabled || effectivePage >= totalPages - 1}
              aria-label={t("dialog.memoryGrid.nextPageAriaLabel")}
              onClick={() => selectPage(effectivePage + 1)}
            >
              ›
            </button>
          </div>

          <div className="goto-address-box">
            <input
              type="text"
              className="goto-input"
              disabled={disabled}
              value={gotoAddressInput}
              placeholder={t("dialog.memoryGrid.gotoAddressPlaceholder")}
              aria-label={t("dialog.memoryGrid.gotoAddressAriaLabel")}
              onChange={(e) => {
                setGotoAddressInput(e.target.value);
                setCellError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  handleGotoSubmit();
                }
              }}
            />
            <button
              type="button"
              className="goto-btn"
              disabled={disabled}
              onClick={handleGotoSubmit}
            >
              {t("dialog.memoryGrid.gotoAddressButton")}
            </button>
          </div>
        </div>
      )}

      <div className="memory-table-scroll">
        <table className="memory-table">
          <thead>
            <tr>
              <th scope="col" className="addr-col-header">
                {t("dialog.memoryGrid.addressHeader")}
              </th>
              {Array.from({ length: cols }, (_, colIdx) => (
                <th key={colIdx} scope="col" className="data-col-header">
                  {colIdx.toString(16).toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, rowIdx) => {
              const rowStart = pageStart + rowIdx * cols;
              const rowHex = rowStart.toString(16).toUpperCase().padStart(addrHexDigits, "0");
              return (
                <tr key={rowStart}>
                  <th scope="row" className="addr-row-header">
                    {rowHex}
                  </th>
                  {Array.from({ length: cols }, (_, colIdx) => {
                    const address = rowStart + colIdx;
                    if (address >= pageEnd) {
                      return <td key={colIdx} className="memory-cell empty-cell" />;
                    }
                    const bufferIndex = address - sliceStartAddress;
                    const storedValue = bufferIndex >= 0
                      ? getCellValue(data, safeDataBits, bufferIndex)
                      : 0;
                    const isEditing = editingCell?.address === address;
                    const displayValue = isEditing
                      ? editingCell.draft
                      : formatCellValue(storedValue, safeDataBits, format);
                    const addrLabel = address.toString(16).toUpperCase().padStart(addrHexDigits, "0");
                    const isHighlighted = highlightedAddress === address;

                    return (
                      <td
                        key={colIdx}
                        className={`memory-cell${isHighlighted ? " is-highlighted" : ""}`}
                      >
                        <input
                          type="text"
                          className="cell-input"
                          style={{ width: `${Math.max(3, valueCharWidth + 1.5)}ch` }}
                          readOnly={isCellLocked}
                          disabled={disabled}
                          value={displayValue}
                          aria-label={t("dialog.memoryGrid.cellAriaLabel", { address: addrLabel })}
                          data-address={addrLabel}
                          onFocus={(e) => {
                            if (isCellLocked) {
                              return;
                            }
                            setHighlightedAddress(null);
                            setCellError(null);
                            setEditingCell({
                              address,
                              draft: formatCellValue(storedValue, safeDataBits, format),
                            });
                            e.currentTarget.select();
                          }}
                          onChange={(e) => {
                            if (isCellLocked) {
                              return;
                            }
                            const nextDraft = e.target.value;
                            setEditingCell({ address, draft: nextDraft });
                            if (!nextDraft.trim()) {
                              setCellError(null);
                              return;
                            }
                            const parsed = parseCellInput(nextDraft, safeDataBits, format);
                            if (parsed.ok) {
                              setCellError(null);
                              onCellChange?.(address, parsed.value);
                            } else {
                              setCellError(
                                parsed.errorParams
                                  ? t(parsed.errorKey, parsed.errorParams)
                                  : t(parsed.errorKey),
                              );
                            }
                          }}
                          onBlur={() => {
                            setEditingCell(null);
                            setCellError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.preventDefault();
                              e.stopPropagation();
                              setEditingCell(null);
                              setCellError(null);
                              e.currentTarget.blur();
                            } else if (e.key === "Enter") {
                              e.preventDefault();
                              e.stopPropagation();
                              const currentDraft =
                                editingCell?.address === address
                                  ? editingCell.draft
                                  : displayValue;
                              const parsed = parseCellInput(currentDraft, safeDataBits, format);
                              if (parsed.ok) {
                                onCellChange?.(address, parsed.value);
                                setEditingCell(null);
                                setCellError(null);
                                e.currentTarget.blur();
                              } else {
                                setCellError(
                                  parsed.errorParams
                                    ? t(parsed.errorKey, parsed.errorParams)
                                    : t(parsed.errorKey),
                                );
                              }
                            }
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {cellError && (
        <div className="grid-error" role="alert">
          {cellError}
        </div>
      )}
    </div>
  );
})({
  display: "flex",
  flexDirection: "column",
  gap: "0.45rem",

  "&.is-disabled": {
    opacity: 0.55,
  },

  "& > .grid-toolbar": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "0.5rem",

    "& > .format-switcher": {
      display: "inline-flex",
      gap: "0.25rem",

      "& > .format-btn": {
        padding: "0.25rem 0.55rem",
        fontSize: "0.75rem",
        fontWeight: 500,
        borderRadius: "0.25rem",
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-base)",
        color: "var(--color-text-secondary)",
        cursor: "pointer",

        "&:hover:not(:disabled)": {
          borderColor: "var(--color-border-strong)",
          color: "var(--color-text-primary)",
        },

        "&.active": {
          borderColor: "var(--color-accent-primary)",
          backgroundColor: "var(--color-accent-primary-bg)",
          color: "var(--color-text-primary)",
          fontWeight: 600,
        },

        "&:disabled": {
          cursor: "not-allowed",
        },
      },
    },

    "& > .capacity-badge": {
      fontSize: "0.75rem",
      color: "var(--color-text-secondary)",
      fontFamily: "var(--font-family-mono)",
    },
  },

  "& > .grid-pagination": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "0.5rem",
    padding: "0.35rem 0.5rem",
    backgroundColor: "var(--color-bg-base)",
    border: "1px solid var(--color-border-subtle)",
    borderRadius: "0.35rem",

    "& > .page-nav": {
      display: "inline-flex",
      alignItems: "center",
      gap: "0.4rem",

      "& > .page-btn": {
        padding: "0.15rem 0.5rem",
        borderRadius: "0.25rem",
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-surface)",
        color: "var(--color-text-primary)",
        fontSize: "0.85rem",
        fontWeight: 700,
        cursor: "pointer",

        "&:disabled": {
          opacity: 0.35,
          cursor: "not-allowed",
        },
      },

      "& > .page-indicator": {
        fontSize: "0.75rem",
        fontFamily: "var(--font-family-mono)",
        color: "var(--color-text-secondary)",
      },
    },

    "& > .goto-address-box": {
      display: "inline-flex",
      alignItems: "center",
      gap: "0.35rem",

      "& > .goto-input": {
        width: "6.5rem",
        padding: "0.2rem 0.45rem",
        borderRadius: "0.25rem",
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-surface)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-family-mono)",
        fontSize: "0.75rem",
      },

      "& > .goto-btn": {
        padding: "0.2rem 0.5rem",
        borderRadius: "0.25rem",
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-surface)",
        color: "var(--color-text-primary)",
        fontSize: "0.75rem",
        cursor: "pointer",

        "&:hover:not(:disabled)": {
          borderColor: "var(--color-accent-primary)",
        },

        "&:disabled": {
          opacity: 0.4,
          cursor: "not-allowed",
        },
      },
    },
  },

  "& > .memory-table-scroll": {
    maxHeight: "15rem",
    overflow: "auto",
    border: "1px solid var(--color-border-subtle)",
    borderRadius: "0.35rem",
    backgroundColor: "var(--color-bg-base)",

    "& > .memory-table": {
      width: "max-content",
      minWidth: "100%",
      borderCollapse: "collapse",
      fontFamily: "var(--font-family-mono)",
      fontSize: "0.75rem",

      "& th, & td": {
        border: "1px solid var(--color-border-subtle)",
        padding: "0.15rem 0.25rem",
        textAlign: "center",
      },

      "& thead th": {
        position: "sticky",
        top: 0,
        zIndex: 1,
        backgroundColor: "var(--color-bg-elevated)",
        color: "var(--color-text-secondary)",
        fontWeight: 600,
      },

      "& .addr-row-header": {
        backgroundColor: "var(--color-bg-elevated)",
        color: "var(--color-text-secondary)",
        fontWeight: 600,
        padding: "0.15rem 0.45rem",
        textAlign: "right",
      },

      "& .memory-cell.is-highlighted": {
        backgroundColor: "var(--color-accent-primary-bg)",
        outline: "1px solid var(--color-accent-primary)",
      },

      "& .cell-input": {
        border: "none",
        background: "transparent",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-family-mono)",
        fontSize: "0.75rem",
        textAlign: "center",
        padding: "0.1rem 0.15rem",
        outline: "none",
        boxSizing: "content-box",

        "&:focus:not(:read-only)": {
          backgroundColor: "var(--color-bg-surface)",
          boxShadow: "inset 0 0 0 1px var(--color-accent-primary)",
          borderRadius: "0.15rem",
        },

        "&:read-only": {
          cursor: "default",
          color: "var(--color-text-secondary)",
        },
      },
    },
  },

  "& > .grid-error": {
    fontSize: "0.75rem",
    color: "var(--color-logic-error)",
  },
});

export default MemoryDataGrid;
