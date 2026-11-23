import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CircuitContext from "../../contexts/circuitContext";

import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import TruthState, {
  type CombinationalPurityAnalysis,
  type NonCombinationalReason,
} from "../../types/simulation/truthState";

import CircuitTestSocket, {
  DEFAULT_MAX_TRUTH_TABLE_ROWS,
  type InputPinSocket,
  type OutputPinSocket,
} from "../../simulation/truthTable/circuitTestSocket";
import ExpressionParser from "../../simulation/truthTable/expressionParser";
import { writeClipboardText } from "../../utils/clipboardUtils";

export const MAX_TRUTH_TABLE_FILTERS = 15;
const ASYNC_CHUNK_BATCH_SIZE = 256;

export type TruthStateSortDescriptor = {
  key: string;
  kind: "input" | "output";
  index: number;
  direction: 1 | -1;
};

export type TruthTableDialogProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  targetCircuit?: LogicalCircuit | null;
  onClose: () => void;
};

export function parseValidatorsHistory(validators: string | undefined): string[] {
  if (!validators) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of validators.split("\t")) {
    const trimmed = part.trim();
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
      if (result.length >= MAX_TRUTH_TABLE_FILTERS) {
        break;
      }
    }
  }
  return result;
}

export function serializeValidatorsHistory(filters: readonly string[]): string {
  return filters.join("\t");
}

export function upsertValidatorFilter(history: readonly string[], rawFilter: string): string[] {
  const trimmed = rawFilter.trim();
  if (!trimmed) {
    return [...history];
  }
  const withoutDuplicate = history.filter((item) => item !== trimmed);
  return [trimmed, ...withoutDuplicate].slice(0, MAX_TRUTH_TABLE_FILTERS);
}

export function removeValidatorFilter(history: readonly string[], target: string): string[] {
  return history.filter((item) => item !== target);
}

export function normalizePastedFilterText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function toggleTruthTableSortColumn(
  current: readonly TruthStateSortDescriptor[],
  column: { kind: "input" | "output"; index: number },
  extendWithShift: boolean,
): TruthStateSortDescriptor[] {
  const key = `${column.kind}:${column.index}`;
  if (extendWithShift) {
    const existingIndex = current.findIndex((item) => item.key === key);
    if (existingIndex === -1) {
      return [
        ...current,
        {
          key,
          kind: column.kind,
          index: column.index,
          direction: 1,
        },
      ];
    }
    const existing = current[existingIndex]!;
    if (existing.direction === 1) {
      return current.map((item, idx) =>
        idx === existingIndex ? { ...item, direction: -1 } : item,
      );
    }
    return current.filter((_, idx) => idx !== existingIndex);
  }

  const existing = current.find((item) => item.key === key);
  if (!existing) {
    return [
      {
        key,
        kind: column.kind,
        index: column.index,
        direction: 1,
      },
    ];
  }
  if (existing.direction === 1) {
    return [
      {
        key,
        kind: column.kind,
        index: column.index,
        direction: -1,
      },
    ];
  }
  return [];
}

function readSortFieldValue(row: TruthState, descriptor: TruthStateSortDescriptor): number {
  if (descriptor.kind === "input") {
    return (row.input[descriptor.index] ?? 0) | 0;
  }
  if (row.output === null) {
    return 0;
  }
  return (row.output[descriptor.index] ?? 0) | 0;
}

export function sortTruthTableRows(
  rows: readonly TruthState[],
  sortList: readonly TruthStateSortDescriptor[],
): TruthState[] {
  if (sortList.length === 0) {
    return [...rows];
  }

  const copy = [...rows];
  copy.sort((a, b) => {
    for (const descriptor of sortList) {
      const valA = readSortFieldValue(a, descriptor);
      const valB = readSortFieldValue(b, descriptor);
      if (valA !== valB) {
        return (valA < valB ? -1 : 1) * descriptor.direction;
      }
    }
    return 0;
  });
  return copy;
}

export function formatTruthTableTsv(
  inputs: readonly InputPinSocket[],
  outputs: readonly OutputPinSocket[],
  rows: readonly TruthState[],
): string {
  const header = [...inputs.map((i) => i.pin.name), ...outputs.map((o) => o.pin.name)].join("\t");
  const lines = rows.map((row) =>
    [
      ...inputs.map((_, idx) => row.formatInput(idx)),
      ...outputs.map((_, idx) => row.formatOutput(idx)),
    ].join("\t"),
  );
  return [header, ...lines].join("\n");
}

function getReasonKindLabelKey(kind: NonCombinationalReason["kind"]): string {
  switch (kind) {
    case "feedbackLoop":
      return "dialog.truthTable.reasonKinds.feedbackLoop";
    case "ram":
      return "dialog.truthTable.reasonKinds.ram";
    case "clock":
      return "dialog.truthTable.reasonKinds.clock";
    case "sensor":
      return "dialog.truthTable.reasonKinds.sensor";
    case "button":
      return "dialog.truthTable.reasonKinds.button";
    case "graphicsArray":
      return "dialog.truthTable.reasonKinds.graphicsArray";
  }
}

type AppliedFilterState = {
  text: string;
  predicate: ((state: TruthState) => boolean) | null;
  version: number;
};

type SocketSetupState = {
  socket: CircuitTestSocket | null;
  purityAnalysis: CombinationalPurityAnalysis | null;
  isLargeTable: boolean;
  initialRows: TruthState[];
  initialTruncated: boolean;
  oscillation: boolean;
  compileError: string | null;
};

// Modaler Wahrheitstabellen-Dialog (DialogTruthTable) inkl. Filter-Parser, Historie, Sortierung & Nicht-Kombinatorik-Hinweis
const TruthTableDialog = styled(({
  isOpen,
  targetCircuit,
  onClose,
  ...other
}: TruthTableDialogProps) => {
  const { t } = useTranslation();
  const circuitContext = React.useContext(CircuitContext);

  const resolvedCircuit = targetCircuit ?? circuitContext?.currentCircuit ?? null;
  const resolvedCircuitId = resolvedCircuit?.logicalCircuitId ?? null;

  const latestProjectRef = React.useRef(circuitContext?.project);
  latestProjectRef.current = circuitContext?.project;
  const latestCircuitRef = React.useRef(resolvedCircuit);
  latestCircuitRef.current = resolvedCircuit;

  const [filterText, setFilterText] = React.useState("");
  const [invertFilter, setInvertFilter] = React.useState(true);
  const [oldFilters, setOldFilters] = React.useState<string[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = React.useState(false);
  const [sortColumns, setSortColumns] = React.useState<TruthStateSortDescriptor[]>([]);
  const [appliedFilter, setAppliedFilter] = React.useState<AppliedFilterState>({
    text: "",
    predicate: null,
    version: 0,
  });
  const [filterError, setFilterError] = React.useState<string | null>(null);

  const [asyncRows, setAsyncRows] = React.useState<TruthState[]>([]);
  const [asyncTruncated, setAsyncTruncated] = React.useState(false);
  const [asyncOscillation, setAsyncOscillation] = React.useState(false);
  const [showProgress, setShowProgress] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [copyStatus, setCopyStatus] = React.useState<"idle" | "copied" | "error">("idle");

  const abortRef = React.useRef(false);
  const activeRunIdRef = React.useRef(0);
  const copyTimerRef = React.useRef<number | null>(null);
  const historyContainerRef = React.useRef<HTMLDivElement | null>(null);

  const setup = React.useMemo<SocketSetupState | null>(
    () => {
      const circuitSnapshot = latestCircuitRef.current;
      if (!isOpen || !circuitSnapshot) {
        return null;
      }

      try {
        const socket = new CircuitTestSocket(circuitSnapshot, latestProjectRef.current);
        const purityAnalysis = socket.analyzeCombinationalPurity();
        const isLargeTable = socket.totalCombinations > BigInt(DEFAULT_MAX_TRUTH_TABLE_ROWS);
        if (isLargeTable) {
          return {
            socket,
            purityAnalysis,
            isLargeTable: true,
            initialRows: [],
            initialTruncated: false,
            oscillation: false,
            compileError: null,
          };
        }

        const built = socket.buildTruthTable({ maxCount: DEFAULT_MAX_TRUTH_TABLE_ROWS });
        return {
          socket,
          purityAnalysis,
          isLargeTable: false,
          initialRows: built.rows ?? [],
          initialTruncated: built.truncated,
          oscillation: built.oscillation,
          compileError: null,
        };
      } catch (error) {
        return {
          socket: null,
          purityAnalysis: null,
          isLargeTable: false,
          initialRows: [],
          initialTruncated: false,
          oscillation: false,
          compileError: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [isOpen, resolvedCircuitId],
  );

  // Zustand beim Öffnen oder Schaltungswechsel zurücksetzen
  React.useEffect(
    () => {
      activeRunIdRef.current++;
      abortRef.current = true;

      if (!isOpen) {
        setShowProgress(false);
        setCopyStatus("idle");
        setIsHistoryOpen(false);
        return;
      }

      setFilterText("");
      setInvertFilter(true);
      setOldFilters(parseValidatorsHistory(latestCircuitRef.current?.validators));
      setIsHistoryOpen(false);
      setSortColumns([]);
      setAppliedFilter({ text: "", predicate: null, version: 0 });
      setFilterError(null);
      setAsyncRows([]);
      setAsyncTruncated(false);
      setAsyncOscillation(false);
      setShowProgress(false);
      setProgress(0);
      setCopyStatus("idle");
    },
    [isOpen, resolvedCircuitId],
  );

  // Stückweise asynchrone Berechnung großer Wahrheitstabellen (> 4096 Zeilen)
  React.useEffect(
    () => {
      if (!isOpen || !setup?.socket || !setup.isLargeTable) {
        return;
      }

      const socket = setup.socket;
      const runId = ++activeRunIdRef.current;
      abortRef.current = false;

      if (socket.inputs.length === 0 || socket.outputs.length === 0) {
        setAsyncRows([]);
        setAsyncTruncated(false);
        setAsyncOscillation(false);
        setShowProgress(false);
        setProgress(100);
        return;
      }

      setAsyncOscillation(false);
      setAsyncTruncated(false);
      setProgress(0);
      setShowProgress(true);

      for (const inputSocket of socket.inputs) {
        if (inputSocket.function) {
          socket.circuitState.markUpdated(inputSocket.function);
        }
      }

      const outputBitWidths = socket.outputs.map((o) => o.function!.parameterCount);
      const total = socket.totalCombinations;
      const collected: TruthState[] = [];
      let currentValue = 0n;
      let timerId: number | null = null;
      const include = appliedFilter.predicate;

      const processChunk = () => {
        if (activeRunIdRef.current !== runId || abortRef.current) {
          setAsyncRows([...collected]);
          setAsyncTruncated(collected.length > 0 || currentValue > 0n);
          setShowProgress(false);
          return;
        }

        let truncated = false;
        const inputCount = socket.inputs.length;
        const outputCount = socket.outputs.length;

        for (let step = 0; step < ASYNC_CHUNK_BATCH_SIZE && currentValue < total; step++) {
          if (collected.length >= DEFAULT_MAX_TRUTH_TABLE_ROWS || abortRef.current) {
            truncated = true;
            break;
          }

          let bit = 0n;
          for (let i = inputCount - 1; i >= 0; i--) {
            const inputSocket = socket.inputs[i]!;
            const bw = inputSocket.pin.bitWidth;
            const mask = bw < 32 ? (1n << BigInt(bw)) - 1n : 0xffffffffn;
            const v = Number((currentValue >> bit) & mask) | 0;
            inputSocket.function!.value = v;
            bit += BigInt(bw);
          }

          if (!socket.circuitState.evaluate(true)) {
            setAsyncOscillation(true);
            setAsyncRows([]);
            setShowProgress(false);
            return;
          }

          const row = new TruthState(inputCount, outputCount);
          for (let i = 0; i < inputCount; i++) {
            row.input[i] = socket.inputs[i]!.function!.value | 0;
          }
          for (let i = 0; i < outputCount; i++) {
            const probeFn = socket.outputs[i]!.function!;
            const bits = new Array(probeFn.parameterCount);
            for (let b = 0; b < probeFn.parameterCount; b++) {
              bits[b] = probeFn.get(b);
            }
            row.rawStates[i] = bits;
          }

          const unpacked = row.unpack(outputBitWidths);
          if (!unpacked || !include || include(row)) {
            collected.push(row);
          }

          currentValue++;
        }

        const nextPercent =
          total > 0n ? Math.min(100, Number((currentValue * 1000n) / total) / 10) : 100;
        setProgress(nextPercent);

        if (truncated || abortRef.current || currentValue >= total) {
          setAsyncRows(collected);
          setAsyncTruncated(truncated || abortRef.current);
          setProgress(100);
          setShowProgress(false);
          return;
        }

        timerId = window.setTimeout(processChunk, 0);
      };

      timerId = window.setTimeout(processChunk, 0);

      return () => {
        abortRef.current = true;
        if (timerId !== null) {
          window.clearTimeout(timerId);
        }
      };
    },
    [
      appliedFilter,
      isOpen,
      setup,
    ],
  );

  // Escape bricht zuerst laufende Berechnung ab bzw. schließt ansonsten das Dropdown/Dialogfenster
  React.useEffect(
    () => {
      if (!isOpen) {
        return;
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (showProgress) {
            abortRef.current = true;
            setShowProgress(false);
          } else if (isHistoryOpen) {
            setIsHistoryOpen(false);
          } else {
            onClose();
          }
        }
      };

      window.addEventListener("keydown", handleKeyDown, { capture: true });
      return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
    },
    [
      isHistoryOpen,
      isOpen,
      onClose,
      showProgress,
    ],
  );

  // Schließt die Filter-Historienliste bei Klick außerhalb
  React.useEffect(
    () => {
      if (!isHistoryOpen) {
        return;
      }
      const handlePointerDown = (event: MouseEvent) => {
        if (
          historyContainerRef.current &&
          event.target instanceof Node &&
          !historyContainerRef.current.contains(event.target)
        ) {
          setIsHistoryOpen(false);
        }
      };
      window.addEventListener("mousedown", handlePointerDown);
      return () => window.removeEventListener("mousedown", handlePointerDown);
    },
    [isHistoryOpen],
  );

  React.useEffect(
    () => {
      return () => {
        if (copyTimerRef.current !== null) {
          window.clearTimeout(copyTimerRef.current);
          copyTimerRef.current = null;
        }
      };
    },
    [],
  );

  const persistValidators = React.useCallback(
    (filters: readonly string[]) => {
      if (!resolvedCircuitId) {
        return;
      }
      const serialized = serializeValidatorsHistory(filters);
      const currentSerialized = latestCircuitRef.current?.validators ?? "";
      if (serialized !== currentSerialized) {
        circuitContext?.updateCircuitProperties(resolvedCircuitId, {
          validators: serialized,
        });
      }
    },
    [circuitContext, resolvedCircuitId],
  );

  if (!isOpen || !resolvedCircuit || !setup) {
    return null;
  }

  const inputs = setup.socket?.inputs ?? [];
  const outputs = setup.socket?.outputs ?? [];
  const hasActivePins = inputs.length > 0 && outputs.length > 0;
  const totalCombinationsLabel = setup.socket ? setup.socket.totalCombinations.toString() : "0";
  const isTruncated = setup.isLargeTable ? asyncTruncated : setup.initialTruncated;
  const hasOscillation = setup.isLargeTable ? asyncOscillation : setup.oscillation;

  const filteredBaseRows = setup.isLargeTable
    ? asyncRows
    : setup.initialRows.filter((row) => {
      if (!appliedFilter.predicate) {
        return true;
      }
      return row.output === null || appliedFilter.predicate(row);
    });

  const displayedRows = sortTruthTableRows(filteredBaseRows, sortColumns);

  const applyFilterExpression = (rawInput: string, nextInvert: boolean) => {
    const trimmed = rawInput.trim();
    const nextHistory = upsertValidatorFilter(oldFilters, trimmed);
    if (trimmed.length > 0) {
      setOldFilters(nextHistory);
      setFilterText(trimmed);
      persistValidators(nextHistory);
    }
    setIsHistoryOpen(false);

    if (trimmed.length === 0) {
      setFilterError(null);
      setAppliedFilter((prev) => ({
        text: "",
        predicate: null,
        version: prev.version + 1,
      }));
      return;
    }

    if (!setup.socket) {
      return;
    }

    const parser = new ExpressionParser(setup.socket);
    const predicate = parser.parsePredicate(trimmed, nextInvert);
    if (parser.errorCount > 0 || !predicate) {
      setFilterError(parser.errorText);
      return;
    }

    setFilterError(null);
    setAppliedFilter((prev) => ({
      text: trimmed,
      predicate,
      version: prev.version + 1,
    }));
  };

  const handleDeleteHistoryItem = (entry: string) => {
    const nextHistory = removeValidatorFilter(oldFilters, entry);
    setOldFilters(nextHistory);
    persistValidators(nextHistory);
    if (filterText === entry) {
      setFilterText("");
    }
  };

  const handleColumnSort = (
    kind: "input" | "output",
    index: number,
    event: React.MouseEvent,
  ) => {
    setSortColumns((prev) => toggleTruthTableSortColumn(prev, { kind, index }, event.shiftKey));
  };

  const handleCopyTable = async () => {
    const tsv = formatTruthTableTsv(inputs, outputs, displayedRows);
    const success = await writeClipboardText(tsv);

    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }

    setCopyStatus(success ? "copied" : "error");
    copyTimerRef.current = window.setTimeout(
      () => {
        setCopyStatus("idle");
        copyTimerRef.current = null;
      },
      2500,
    );
  };

  const renderSortIndicator = (kind: "input" | "output", index: number) => {
    const key = `${kind}:${index}`;
    const pos = sortColumns.findIndex((item) => item.key === key);
    if (pos === -1) {
      return null;
    }
    const desc = sortColumns[pos]!;
    return (
      <span className="sort-indicator">
        {desc.direction === 1 ? "▲" : "▼"}
        {sortColumns.length > 1 ? <span className="sort-order">{pos + 1}</span> : null}
      </span>
    );
  };

  const modalContent = (
    <div
      {...other}
      data-component="TruthTableDialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="truth-table-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !showProgress) {
          onClose();
        }
      }}
    >
      <div className="modal-card">
        <div className="modal-header">
          <h2 id="truth-table-dialog-title" className="modal-title">
            {t("dialog.truthTable.title", { name: resolvedCircuit.name })}
          </h2>
          <button
            type="button"
            className="close-btn"
            disabled={showProgress}
            aria-label={t("common.closeDialog")}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          {setup.purityAnalysis && !setup.purityAnalysis.isPurelyCombinational && (
            <div
              className="non-combinational-banner"
              data-testid="non-combinational-warning"
              role="status"
            >
              <strong className="warning-title">
                {t("dialog.truthTable.nonCombinationalTitle")}
              </strong>
              <p className="warning-body">
                {t("dialog.truthTable.nonCombinationalBody")}
              </p>
              <div className="warning-reasons">
                {setup.purityAnalysis.reasons.map((reason, idx) => (
                  <span key={`${reason.kind}-${idx}`} className="reason-pill">
                    {t(getReasonKindLabelKey(reason.kind))}: {reason.reportName}
                  </span>
                ))}
              </div>
            </div>
          )}

          {setup.compileError !== null ? (
            <div className="error-banner" role="alert">
              <strong className="error-title">{t("dialog.truthTable.compileErrorTitle")}</strong>
              <span className="error-details">{setup.compileError}</span>
            </div>
          ) : (
            <>
              <form
                className="filter-toolbar"
                onSubmit={(e) => {
                  e.preventDefault();
                  applyFilterExpression(filterText, invertFilter);
                }}
              >
                <label className="filter-label" htmlFor="truth-table-filter-input">
                  {t("dialog.truthTable.filterLabel")}
                </label>

                <div className="filter-combobox" ref={historyContainerRef}>
                  <input
                    id="truth-table-filter-input"
                    type="text"
                    className="filter-input"
                    disabled={showProgress}
                    value={filterText}
                    placeholder={t("dialog.truthTable.filterPlaceholder")}
                    onChange={(e) => setFilterText(e.target.value)}
                    onPaste={(e) => {
                      const pasted = e.clipboardData?.getData("text");
                      if (pasted !== undefined) {
                        const normalized = normalizePastedFilterText(pasted);
                        if (normalized !== pasted) {
                          e.preventDefault();
                          const target = e.currentTarget;
                          const start = target.selectionStart ?? filterText.length;
                          const end = target.selectionEnd ?? filterText.length;
                          setFilterText(
                            `${filterText.slice(0, start)}${normalized}${filterText.slice(end)}`,
                          );
                        }
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="history-toggle-btn"
                    disabled={showProgress}
                    aria-label={t("dialog.truthTable.historyToggleAriaLabel")}
                    aria-expanded={isHistoryOpen}
                    onClick={() => setIsHistoryOpen((prev) => !prev)}
                  >
                    ▾
                  </button>

                  {isHistoryOpen && (
                    <div className="history-dropdown" role="listbox">
                      {oldFilters.length === 0 ? (
                        <div className="history-empty">{t("dialog.truthTable.emptyHistory")}</div>
                      ) : (
                        oldFilters.map((entry) => (
                          <div key={entry} className="history-row">
                            <button
                              type="button"
                              className="history-select-btn"
                              onClick={() => {
                                setFilterText(entry);
                                setIsHistoryOpen(false);
                              }}
                            >
                              {entry}
                            </button>
                            <button
                              type="button"
                              className="history-remove-btn"
                              aria-label={t("dialog.truthTable.removeFilterAriaLabel", {
                                filter: entry,
                              })}
                              onClick={() => handleDeleteHistoryItem(entry)}
                            >
                              −
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <label className="invert-checkbox-label">
                  <input
                    type="checkbox"
                    disabled={showProgress}
                    checked={invertFilter}
                    onChange={(e) => setInvertFilter(e.target.checked)}
                  />
                  <span>{t("dialog.truthTable.invertFilter")}</span>
                </label>

                <button type="submit" className="btn btn-primary" disabled={showProgress}>
                  {t("dialog.truthTable.applyFilter")}
                </button>
              </form>

              {filterError !== null && (
                <div className="error-banner" role="alert">
                  <span className="error-details">{filterError}</span>
                </div>
              )}

              {hasOscillation && (
                <div className="error-banner" role="alert">
                  <span className="error-details">
                    {t("dialog.truthTable.oscillationError")}
                  </span>
                </div>
              )}

              <div className="table-region">
                {!hasActivePins ? (
                  <div className="empty-table-state">{t("dialog.truthTable.noActivePins")}</div>
                ) : displayedRows.length === 0 && !showProgress && !hasOscillation ? (
                  <div className="empty-table-state">{t("dialog.truthTable.noMatchingRows")}</div>
                ) : (
                  <div className="table-scroll">
                    <table className="truth-table">
                      <thead>
                        <tr>
                          {inputs.map((inputSocket, index) => (
                            <th
                              key={`in-${inputSocket.pin.pinId}-${index}`}
                              scope="col"
                              className="input-col"
                            >
                              <button
                                type="button"
                                className="column-sort-btn"
                                title={`${t("dialog.truthTable.inputPinTooltip", {
                                  bitText: t("common.bitCount", { count: inputSocket.pin.bitWidth }),
                                })} — ${t("dialog.truthTable.sortHint")}`}
                                onClick={(e) => handleColumnSort("input", index, e)}
                              >
                                <span className="pin-name">{inputSocket.pin.name}</span>
                                {renderSortIndicator("input", index)}
                              </button>
                            </th>
                          ))}
                          {outputs.map((outputSocket, index) => (
                            <th
                              key={`out-${outputSocket.pin.pinId}-${index}`}
                              scope="col"
                              className="output-col"
                            >
                              <button
                                type="button"
                                className="column-sort-btn"
                                title={`${t("dialog.truthTable.outputPinTooltip", {
                                  bitText: t("common.bitCount", {
                                    count: outputSocket.pin.bitWidth,
                                  }),
                                })} — ${t("dialog.truthTable.sortHint")}`}
                                onClick={(e) => handleColumnSort("output", index, e)}
                              >
                                <span className="pin-name">{outputSocket.pin.name}</span>
                                {renderSortIndicator("output", index)}
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {displayedRows.map((row, rowIndex) => (
                          <tr key={`row-${rowIndex}`}>
                            {inputs.map((_, colIdx) => (
                              <td key={`in-cell-${rowIndex}-${colIdx}`} className="input-cell">
                                {row.formatInput(colIdx)}
                              </td>
                            ))}
                            {outputs.map((_, colIdx) => (
                              <td
                                key={`out-cell-${rowIndex}-${colIdx}`}
                                className={
                                  row.output === null ? "output-cell is-tristate" : "output-cell"
                                }
                              >
                                {row.formatOutput(colIdx)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {showProgress && (
                  <div className="progress-overlay" role="status">
                    <div className="progress-card">
                      <span className="progress-label">
                        {t("dialog.truthTable.calculatingProgress", {
                          percent: progress.toFixed(0),
                        })}
                      </span>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          abortRef.current = true;
                          setShowProgress(false);
                        }}
                      >
                        {t("dialog.truthTable.stopCalculation")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <div className="footer-stats">
            <span className="stat-item">
              {t("dialog.truthTable.totalRowsLabel", { count: totalCombinationsLabel })}
            </span>
            <span className="stat-item">
              {t("dialog.truthTable.displayedRowsLabel", { count: displayedRows.length })}
            </span>
            {isTruncated && (
              <span className="truncated-warning">
                {t("dialog.truthTable.truncatedWarning", { max: DEFAULT_MAX_TRUTH_TABLE_ROWS })}
              </span>
            )}
            {copyStatus === "error" && (
              <span className="copy-error-text">{t("dialog.truthTable.copyFailed")}</span>
            )}
          </div>

          <div className="footer-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={showProgress || displayedRows.length === 0}
              onClick={() => {
                void handleCopyTable();
              }}
            >
              {copyStatus === "copied"
                ? t("dialog.truthTable.copiedTable")
                : t("dialog.truthTable.copyTable")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={showProgress}
              onClick={onClose}
            >
              {t("common.close")}
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
  inset: 0,
  zIndex: 1100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "rgba(0, 0, 0, 0.65)",
  padding: "1rem",

  "& > .modal-card": {
    width: "100%",
    maxWidth: "54rem",
    maxHeight: "88vh",
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

        "&:hover:not(:disabled)": {
          color: "var(--color-text-primary)",
          backgroundColor: "var(--color-bg-surface)",
        },

        "&:disabled": {
          opacity: 0.4,
          cursor: "not-allowed",
        },
      },
    },

    "& > .modal-body": {
      padding: "1rem 1.15rem",
      display: "flex",
      flexDirection: "column",
      gap: "0.75rem",
      flex: 1,
      minHeight: 0,
      overflow: "hidden",

      "& > .non-combinational-banner": {
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",
        padding: "0.65rem 0.85rem",
        borderRadius: "0.35rem",
        border: "1px solid var(--color-info-border)",
        backgroundColor: "var(--color-info-bg)",
        color: "var(--color-text-primary)",
        fontSize: "0.8rem",

        "& > .warning-title": {
          fontWeight: 600,
          color: "var(--color-text-primary)",
        },

        "& > .warning-body": {
          margin: 0,
          lineHeight: 1.4,
          color: "var(--color-text-secondary)",
        },

        "& > .warning-reasons": {
          display: "flex",
          flexWrap: "wrap",
          gap: "0.35rem",

          "& > .reason-pill": {
            padding: "0.15rem 0.45rem",
            borderRadius: "0.25rem",
            border: "1px solid var(--color-border-strong)",
            backgroundColor: "var(--color-bg-elevated)",
            fontSize: "0.74rem",
            fontFamily: "var(--font-family-mono)",
          },
        },
      },

      "& > .error-banner": {
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
        padding: "0.65rem 0.85rem",
        borderRadius: "0.35rem",
        border: "1px solid var(--color-error-border)",
        backgroundColor: "var(--color-error-bg)",
        color: "var(--color-error-text)",
        fontSize: "0.82rem",

        "& > .error-title": {
          fontWeight: 600,
        },

        "& > .error-details": {
          color: "var(--color-error-text-soft)",
          whiteSpace: "pre-wrap",
          fontFamily: "var(--font-family-mono)",
          fontSize: "0.78rem",
        },
      },

      "& > .filter-toolbar": {
        display: "flex",
        alignItems: "center",
        gap: "0.55rem",
        flexWrap: "wrap",

        "& > .filter-label": {
          fontSize: "0.82rem",
          fontWeight: 600,
          color: "var(--color-text-secondary)",
        },

        "& > .filter-combobox": {
          position: "relative",
          flex: 1,
          minWidth: "14rem",
          display: "flex",

          "& > .filter-input": {
            flex: 1,
            minWidth: 0,
            padding: "0.4rem 0.6rem",
            backgroundColor: "var(--color-bg-base)",
            color: "var(--color-text-primary)",
            border: "1px solid var(--color-border-strong)",
            borderRight: "none",
            borderRadius: "0.3rem 0 0 0.3rem",
            fontSize: "0.83rem",
            fontFamily: "var(--font-family-mono)",

            "&:focus": {
              outline: "none",
              borderColor: "var(--color-accent-primary)",
            },
          },

          "& > .history-toggle-btn": {
            padding: "0 0.55rem",
            backgroundColor: "var(--color-bg-elevated)",
            color: "var(--color-text-secondary)",
            border: "1px solid var(--color-border-strong)",
            borderRadius: "0 0.3rem 0.3rem 0",
            cursor: "pointer",
            fontSize: "0.82rem",

            "&:hover:not(:disabled)": {
              backgroundColor: "var(--color-bg-base)",
              color: "var(--color-text-primary)",
            },
          },

          "& > .history-dropdown": {
            position: "absolute",
            top: "calc(100% + 0.25rem)",
            left: 0,
            right: 0,
            zIndex: 20,
            maxHeight: "14rem",
            overflowY: "auto",
            backgroundColor: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border-strong)",
            borderRadius: "0.35rem",
            boxShadow: "0 0.6rem 1.5rem rgba(0, 0, 0, 0.45)",
            padding: "0.25rem",

            "& > .history-empty": {
              padding: "0.5rem 0.65rem",
              fontSize: "0.78rem",
              color: "var(--color-text-muted)",
            },

            "& > .history-row": {
              display: "flex",
              alignItems: "center",
              gap: "0.25rem",

              "& > .history-select-btn": {
                flex: 1,
                textAlign: "left",
                background: "transparent",
                border: "none",
                borderRadius: "0.25rem",
                padding: "0.35rem 0.5rem",
                color: "var(--color-text-primary)",
                fontFamily: "var(--font-family-mono)",
                fontSize: "0.78rem",
                cursor: "pointer",
                wordBreak: "break-word",

                "&:hover": {
                  backgroundColor: "var(--color-accent-primary-bg)",
                },
              },

              "& > .history-remove-btn": {
                flexShrink: 0,
                background: "transparent",
                border: "1px solid transparent",
                borderRadius: "0.25rem",
                color: "var(--color-text-muted)",
                padding: "0.2rem 0.45rem",
                cursor: "pointer",
                fontWeight: 700,

                "&:hover": {
                  color: "var(--color-error-text-soft)",
                  borderColor: "var(--color-error-border)",
                  backgroundColor: "var(--color-error-bg)",
                },
              },
            },
          },
        },

        "& > .invert-checkbox-label": {
          display: "inline-flex",
          alignItems: "center",
          gap: "0.35rem",
          fontSize: "0.8rem",
          color: "var(--color-text-primary)",
          cursor: "pointer",
          userSelect: "none",
        },
      },

      "& > .table-region": {
        position: "relative",
        flex: 1,
        minHeight: "12rem",
        display: "flex",
        flexDirection: "column",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "0.35rem",
        backgroundColor: "var(--color-bg-base)",
        overflow: "hidden",

        "& > .empty-table-state": {
          padding: "1.5rem",
          textAlign: "center",
          color: "var(--color-text-secondary)",
          fontSize: "0.85rem",
        },

        "& > .table-scroll": {
          flex: 1,
          overflow: "auto",

          "& > .truth-table": {
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.83rem",

            "& th, & td": {
              padding: "0.35rem 0.65rem",
              borderBottom: "1px solid var(--color-border-subtle)",
              borderRight: "1px solid var(--color-border-subtle)",
              whiteSpace: "nowrap",
            },

            "& th": {
              position: "sticky",
              top: 0,
              zIndex: 1,
              backgroundColor: "var(--color-bg-elevated)",
              padding: 0,

              "&.output-col": {
                borderLeft: "2px solid var(--color-border-strong)",
              },

              "& > .column-sort-btn": {
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: "0.35rem",
                padding: "0.45rem 0.65rem",
                background: "transparent",
                border: "none",
                color: "var(--color-text-primary)",
                fontFamily: "inherit",
                fontSize: "0.8rem",
                fontWeight: 600,
                cursor: "pointer",

                "&:hover": {
                  backgroundColor: "var(--color-accent-primary-bg)",
                },

                "& > .sort-indicator": {
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.15rem",
                  fontSize: "0.7rem",
                  color: "var(--color-accent-primary)",

                  "& > .sort-order": {
                    fontSize: "0.65rem",
                  },
                },
              },
            },

            "& td": {
              textAlign: "right",
              fontFamily: "var(--font-family-mono)",
              fontVariantNumeric: "tabular-nums",

              "&.output-cell": {
                borderLeft: "2px solid var(--color-border-strong)",
                fontWeight: 600,

                "&.is-tristate": {
                  color: "var(--color-text-muted)",
                },
              },
            },

            "& tbody tr:hover": {
              backgroundColor: "var(--color-bg-surface)",
            },
          },
        },

        "& > .progress-overlay": {
          position: "absolute",
          inset: 0,
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(11, 17, 26, 0.78)",

          "& > .progress-card": {
            width: "18rem",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.65rem",
            padding: "1rem",
            borderRadius: "0.4rem",
            border: "1px solid var(--color-border-strong)",
            backgroundColor: "var(--color-bg-surface)",

            "& > .progress-label": {
              fontSize: "0.82rem",
              color: "var(--color-text-primary)",
            },

            "& > .progress-track": {
              width: "100%",
              height: "0.6rem",
              borderRadius: "0.3rem",
              backgroundColor: "var(--color-bg-base)",
              border: "1px solid var(--color-border-subtle)",
              overflow: "hidden",

              "& > .progress-fill": {
                height: "100%",
                backgroundColor: "var(--color-accent-primary)",
                transition: "width 0.08s linear",
              },
            },
          },
        },
      },
    },

    "& > .modal-footer": {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "0.75rem",
      flexWrap: "wrap",
      padding: "0.8rem 1.15rem",
      borderTop: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-bg-elevated)",

      "& > .footer-stats": {
        display: "flex",
        alignItems: "center",
        gap: "0.85rem",
        flexWrap: "wrap",
        fontSize: "0.78rem",
        color: "var(--color-text-secondary)",

        "& > .truncated-warning": {
          color: "var(--color-error-text-soft)",
          fontWeight: 600,
        },

        "& > .copy-error-text": {
          color: "var(--color-error-text-soft)",
        },
      },

      "& > .footer-actions": {
        display: "flex",
        alignItems: "center",
        gap: "0.6rem",
        marginLeft: "auto",
      },
    },
  },

  "& .btn": {
    padding: "0.42rem 0.85rem",
    borderRadius: "0.3rem",
    fontSize: "0.83rem",
    fontWeight: 500,
    cursor: "pointer",
    border: "1px solid transparent",
    transition: "all 0.12s ease",

    "&:disabled": {
      opacity: 0.45,
      cursor: "not-allowed",
    },

    "&.btn-secondary": {
      backgroundColor: "var(--color-bg-surface)",
      color: "var(--color-text-primary)",
      borderColor: "var(--color-border-strong)",

      "&:hover:not(:disabled)": {
        backgroundColor: "var(--color-bg-base)",
      },
    },

    "&.btn-primary": {
      backgroundColor: "var(--color-accent-primary)",
      color: "var(--color-text-on-accent)",
      fontWeight: 600,

      "&:hover:not(:disabled)": {
        backgroundColor: "var(--color-accent-primary-hover)",
      },
    },
  },
});

export default TruthTableDialog;
