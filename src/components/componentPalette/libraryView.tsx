import React from "react";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CircuitContext from "../../contexts/circuitContext";
import LibraryContext, { type LibraryDeleteDependent } from "../../contexts/libraryContext";
import SimulationContext from "../../contexts/simulationContext";

import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type PaletteSelection from "../../types/circuit/paletteSelection";
import type { LibraryProjectCircuitCandidate } from "../../types/storage/circuitLibrary";
import type { NativeLogicalCircuit } from "../../types/storage/nativeProjectFormat";

import type { BuiltInCircuitKey } from "../../utils/builtInLibraryCatalog";
import { createDefaultLogicalCircuit, wouldCreateCircuitCycle } from "../../utils/circuitLayout";
import { hideBrowserDragImage } from "../../utils/dragImage";
import { isFileSystemAccessSupported } from "../../utils/fileSystemStorage";
import {
  collectTransitiveNativeCircuits,
  isCircuitLibraryJson,
  isSupportedLibraryFile,
  listProjectCircuitCandidates,
  parseCircuitLibraryDocument,
} from "../../utils/libraryStorage";
import {
  type CollapsedCategoriesMap,
  loadCollapsedCategories,
  saveCollapsedCategories,
} from "../../utils/paletteStorage";
import { isSupportedProjectFile, readProjectFileText } from "../../utils/storage/projectFileUtils";
import { getHydratedNativeCircuitsMap } from "../../utils/subCircuitPreview";

import PaletteCategory from "./paletteCategory";
import SubCircuitGlyph from "./subCircuitGlyph";
import SubCircuitPreview from "./subCircuitPreview";
import ConfirmDialog from "../app/confirmDialog";
import ContextMenuPopup, { type ContextMenuItem } from "../circuitCanvas/contextMenuPopup";
import PropertyDialog from "../propertyDialog";

type LibraryViewProps = React.ComponentPropsWithoutRef<"div">;

type DisplayLibraryEntry = {
  circuit: NativeLogicalCircuit;
  isBuiltIn: boolean;
  builtInKey?: BuiltInCircuitKey;
  inputPinCount: number;
  outputPinCount: number;
  pinNamesSummary: string;
};

type CategoryGroup = {
  categoryName: string;
  collapseKey: string;
  items: DisplayLibraryEntry[];
};

type LibraryItemMenuState = {
  x: number;
  y: number;
  entry: DisplayLibraryEntry;
};

type DeletePromptState = {
  entry: DisplayLibraryEntry;
  dependents: LibraryDeleteDependent[];
};

type ImportCandidateState = {
  fileName: string;
  rawText: string;
  candidates: LibraryProjectCircuitCandidate[];
  selectedIds: string[];
};

const LIBRARY_COLLAPSE_STORAGE_KEY = "logicCircuit.library.collapsedCategories";

function getLibraryCategoryCollapseKey(scope: "user" | "builtin", categoryName: string): string {
  return `lib-${scope}:${categoryName}`;
}

function toDisplayEntry(
  circuit: NativeLogicalCircuit,
  isBuiltIn: boolean,
  builtInKey?: BuiltInCircuitKey,
): DisplayLibraryEntry {
  let inputPinCount = 0;
  let outputPinCount = 0;
  const pinNames: string[] = [];

  for (const pin of circuit.pins) {
    if (pin.pinType === "input") {
      inputPinCount += 1;
    } else {
      outputPinCount += 1;
    }
    if (pin.name.trim().length > 0) {
      pinNames.push(pin.name.trim());
    }
  }

  return {
    circuit,
    isBuiltIn,
    builtInKey,
    inputPinCount,
    outputPinCount,
    pinNamesSummary: pinNames.join(", "),
  };
}

function groupByCategory(
  entries: readonly DisplayLibraryEntry[],
  scope: "user" | "builtin",
  fallbackCategory: string,
): CategoryGroup[] {
  const byCategory = new Map<string, DisplayLibraryEntry[]>();
  for (const entry of entries) {
    const rawCat = entry.circuit.category.trim();
    const cat = rawCat.length > 0 ? rawCat : fallbackCategory;
    const list = byCategory.get(cat) ?? [];
    list.push(entry);
    byCategory.set(cat, list);
  }

  return Array.from(byCategory.entries())
    .map(([categoryName, items]) => ({
      categoryName,
      collapseKey: getLibraryCategoryCollapseKey(scope, categoryName),
      items: items.slice().sort((a, b) =>
        a.circuit.name.localeCompare(b.circuit.name, undefined, { sensitivity: "base" }),
      ),
    }))
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName, undefined, { sensitivity: "base" }));
}

function matchesLibraryFilter(entry: DisplayLibraryEntry, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) {
    return true;
  }
  const lc = entry.circuit;
  return (
    lc.name.toLowerCase().includes(normalizedQuery) ||
    lc.notation.toLowerCase().includes(normalizedQuery) ||
    lc.category.toLowerCase().includes(normalizedQuery) ||
    lc.note.toLowerCase().includes(normalizedQuery) ||
    entry.pinNamesSummary.toLowerCase().includes(normalizedQuery)
  );
}

function buildMetadataEditLogicalCircuit(lc: NativeLogicalCircuit): LogicalCircuit {
  const draft = createDefaultLogicalCircuit(lc.logicalCircuitId, lc.name, lc.category, lc.note);
  draft.notation = lc.notation;
  draft.circuitShape = lc.circuitShape;
  draft.isDisplay = lc.circuitShape === "display";
  draft.showLabelAbove = lc.showLabelAbove;
  draft.displayMargin = lc.displayMargin;
  draft.exportToHDL = lc.exportToHDL;
  return draft;
}

const LibraryView = styled(({ ...other }: LibraryViewProps) => {
  const { t } = useTranslation();
  const circuitContext = React.useContext(CircuitContext);
  const libraryContext = React.useContext(LibraryContext);
  const simulationContext = React.useContext(SimulationContext);

  const isSimulating = simulationContext?.isSimulating ?? false;

  const [searchQuery, setSearchQuery] = React.useState("");
  const [collapsedCategories, setCollapsedCategories] = React.useState<CollapsedCategoriesMap>(
    () => loadCollapsedCategories(LIBRARY_COLLAPSE_STORAGE_KEY),
  );
  const [itemMenuState, setItemMenuState] = React.useState<LibraryItemMenuState | null>(null);
  const [deletePrompt, setDeletePrompt] = React.useState<DeletePromptState | null>(null);
  const [metadataTarget, setMetadataTarget] = React.useState<LogicalCircuit | null>(null);
  const [importCandidateState, setImportCandidateState] = React.useState<ImportCandidateState | null>(null);
  const [localError, setLocalError] = React.useState<string | null>(null);

  const openLibraryFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const importFileInputRef = React.useRef<HTMLInputElement | null>(null);

  const toggleCategory = React.useCallback(
    (collapseKey: string) => {
      setCollapsedCategories((prev) => {
        const next = { ...prev, [collapseKey]: !prev[collapseKey] };
        saveCollapsedCategories(next, LIBRARY_COLLAPSE_STORAGE_KEY);
        return next;
      });
    },
    [],
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const fallbackCategory = t("library.sections.uncategorized");

  const userEntries = React.useMemo(
    () => (libraryContext?.userCircuits ?? []).map((lc) => toDisplayEntry(lc, false)),
    [libraryContext?.userCircuits],
  );

  const builtInEntries = React.useMemo(
    () => (libraryContext?.builtInItems ?? []).map((item) => toDisplayEntry(item.circuit, true, item.key)),
    [libraryContext?.builtInItems],
  );

  const hydratedUserCircuits = React.useMemo(
    () => getHydratedNativeCircuitsMap(libraryContext?.userCircuits ?? []),
    [libraryContext?.userCircuits],
  );

  const hydratedUserCircuitList = React.useMemo(
    () => Array.from(hydratedUserCircuits.values()),
    [hydratedUserCircuits],
  );

  const hydratedBuiltInCircuits = React.useMemo(
    () => getHydratedNativeCircuitsMap(libraryContext?.builtInCircuits ?? []),
    [libraryContext?.builtInCircuits],
  );

  const filteredUserGroups = React.useMemo(
    () => groupByCategory(
      userEntries.filter((entry) => matchesLibraryFilter(entry, normalizedQuery)),
      "user",
      fallbackCategory,
    ),
    [
      fallbackCategory,
      normalizedQuery,
      userEntries,
    ],
  );

  const filteredBuiltInGroups = React.useMemo(
    () => groupByCategory(
      builtInEntries.filter((entry) => matchesLibraryFilter(entry, normalizedQuery)),
      "builtin",
      fallbackCategory,
    ),
    [
      builtInEntries,
      fallbackCategory,
      normalizedQuery,
    ],
  );

  const existingCategories = React.useMemo(
    () => {
      const unique = new Set<string>();
      for (const entry of userEntries) {
        if (entry.circuit.category.trim()) {
          unique.add(entry.circuit.category.trim());
        }
      }
      return Array.from(unique).sort((a, b) => a.localeCompare(b));
    },
    [userEntries],
  );

  const handleOpenLibraryClick = React.useCallback(
    () => {
      setLocalError(null);
      if (!isFileSystemAccessSupported()) {
        openLibraryFileInputRef.current?.click();
        return;
      }
      void libraryContext?.openLibraryFile();
    },
    [libraryContext],
  );

  const handleFallbackOpenLibraryFile = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || !libraryContext) {
        return;
      }
      if (!isSupportedLibraryFile(file.name)) {
        setLocalError(t("library.errors.loadFailed"));
        return;
      }
      try {
        const rawText = await readProjectFileText(file);
        libraryContext.openLibraryFromText(rawText, file.name);
        setLocalError(null);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : t("library.errors.loadFailed"));
      }
    },
    [libraryContext, t],
  );

  const handleImportFileChange = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || !libraryContext) {
        return;
      }
      if (!isSupportedLibraryFile(file.name) && !isSupportedProjectFile(file.name)) {
        setLocalError(t("library.errors.unsupportedImportFile"));
        return;
      }

      try {
        const rawText = await readProjectFileText(file);
        let candidates: LibraryProjectCircuitCandidate[] = [];

        if (isCircuitLibraryJson(rawText)) {
          const doc = parseCircuitLibraryDocument(rawText);
          candidates = doc.logicalCircuits.map((lc) => {
            const transitive = collectTransitiveNativeCircuits(doc.logicalCircuits, [lc.logicalCircuitId]);
            return {
              logicalCircuitId: lc.logicalCircuitId,
              name: lc.name,
              category: lc.category,
              note: lc.note,
              isProjectRoot: false,
              transitiveCircuitIds: transitive.map((item) => item.logicalCircuitId),
            };
          });
        } else {
          candidates = listProjectCircuitCandidates(rawText);
        }

        if (candidates.length === 0) {
          setLocalError(t("library.errors.noCircuitsFound"));
          return;
        }

        setLocalError(null);
        setImportCandidateState({
          fileName: file.name,
          rawText,
          candidates,
          selectedIds: candidates.map((c) => c.logicalCircuitId),
        });
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : t("library.errors.loadFailed"));
      }
    },
    [libraryContext, t],
  );

  const handleInsertEntryIntoCanvas = React.useCallback(
    (entry: DisplayLibraryEntry) => {
      if (isSimulating || !circuitContext?.importLibraryCircuit || !libraryContext) {
        return;
      }

      const sourceCircuits = entry.isBuiltIn
        ? libraryContext.builtInCircuits
        : libraryContext.userCircuits;
      if (sourceCircuits.length === 0) {
        return;
      }

      if (
        libraryContext.isEditingLibrary &&
        !entry.isBuiltIn &&
        circuitContext.currentCircuitId &&
        wouldCreateCircuitCycle(
          circuitContext.currentCircuitId,
          entry.circuit.logicalCircuitId,
          circuitContext.project,
        )
      ) {
        return;
      }

      circuitContext.importLibraryCircuit(sourceCircuits, entry.circuit.logicalCircuitId, {
        gridPoint: { x: 8, y: 8 },
      });
    },
    [
      circuitContext,
      isSimulating,
      libraryContext,
    ],
  );

  const handleItemDragStart = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>, entry: DisplayLibraryEntry) => {
      if (isSimulating || !circuitContext) {
        event.preventDefault();
        return;
      }

      if (
        libraryContext?.isEditingLibrary &&
        !entry.isBuiltIn &&
        wouldCreateCircuitCycle(
          circuitContext.currentCircuitId,
          entry.circuit.logicalCircuitId,
          circuitContext.project,
        )
      ) {
        event.preventDefault();
        return;
      }

      const selection: PaletteSelection = {
        type: "subCircuit",
        subCircuitId: entry.circuit.logicalCircuitId,
        libraryCircuitId: entry.circuit.logicalCircuitId,
        isBuiltInLibrary: entry.isBuiltIn,
        name: entry.circuit.name,
        notation: entry.circuit.notation,
      };
      event.dataTransfer.setData("application/json", JSON.stringify(selection));
      event.dataTransfer.effectAllowed = "copy";
      hideBrowserDragImage(event.dataTransfer);
      circuitContext.setActivePaletteDrag(selection);
    },
    [
      circuitContext,
      isSimulating,
      libraryContext?.isEditingLibrary,
    ],
  );

  const handleRequestDeleteEntry = React.useCallback(
    (entry: DisplayLibraryEntry) => {
      if (!libraryContext) {
        return;
      }
      const dependents = libraryContext.getLibraryDeletionDependents(entry.circuit.logicalCircuitId);
      setDeletePrompt({ entry, dependents });
    },
    [libraryContext],
  );

  const persistenceState = libraryContext?.persistenceState;
  const isWritable = libraryContext?.isWritable ?? false;
  const showResyncBanner = Boolean(
    persistenceState &&
    persistenceState.isReadOnly &&
    persistenceState.status !== "uninitialized" &&
    !libraryContext?.isResyncWarningDismissed,
  );
  const displayedError = localError ?? libraryContext?.libraryError ?? null;

  const renderLibraryEntry = (entry: DisplayLibraryEntry) => {
    const isEditingThis =
      !entry.isBuiltIn &&
      libraryContext?.editingLibraryCircuitId === entry.circuit.logicalCircuitId;
    const isCycleBlocked = Boolean(
      libraryContext?.isEditingLibrary &&
      !entry.isBuiltIn &&
      circuitContext &&
      wouldCreateCircuitCycle(
        circuitContext.currentCircuitId,
        entry.circuit.logicalCircuitId,
        circuitContext.project,
      ),
    );
    const isDragBlocked = isSimulating || !circuitContext || isCycleBlocked;
    const hydratedCircuit = (entry.isBuiltIn ? hydratedBuiltInCircuits : hydratedUserCircuits).get(
      entry.circuit.logicalCircuitId,
    );

    const pinSummary = t("library.item.pinSummary", {
      inputs: entry.inputPinCount,
      outputs: entry.outputPinCount,
    });
    const baseTooltip = t("library.item.placeTooltip", { name: entry.circuit.name });
    const pinDetails = entry.pinNamesSummary ? ` [${entry.pinNamesSummary}]` : "";
    const noteDetails = entry.circuit.note ? `\n${entry.circuit.note}` : "";
    const fullTooltip = `${baseTooltip}${pinDetails}${noteDetails}`;

    return (
      <div
        key={`${entry.isBuiltIn ? "builtin" : "user"}-${entry.circuit.logicalCircuitId}`}
        className={`library-entry-card${isEditingThis ? " is-editing" : ""}${isDragBlocked ? " is-disabled" : ""}`}
        data-testid={`library-item-${entry.circuit.logicalCircuitId}`}
        draggable={!isDragBlocked}
        onDragStart={(e) => handleItemDragStart(e, entry)}
        onDragEnd={() => circuitContext?.setActivePaletteDrag(null)}
        onDoubleClick={() => handleInsertEntryIntoCanvas(entry)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setItemMenuState({ x: e.clientX, y: e.clientY, entry });
        }}
        title={fullTooltip}
      >
        <div className="entry-glyph">
          {hydratedCircuit ? (
            <SubCircuitPreview
              circuit={hydratedCircuit}
              width={48}
              height={36}
              className="preview-svg"
            />
          ) : (
            <SubCircuitGlyph name={entry.circuit.notation || entry.circuit.name} />
          )}
        </div>
        <div className="entry-meta">
          <div className="entry-title-row">
            <span className="entry-name">{entry.circuit.name}</span>
            {entry.isBuiltIn && (
              <span className="entry-badge readonly">{t("library.item.readOnlyBadge")}</span>
            )}
            {isEditingThis && (
              <span className="entry-badge editing">{t("header.libraryMode.badgeLabel")}</span>
            )}
          </div>
          <div className="entry-sub-row">
            <span className="entry-pins">{pinSummary}</span>
            {entry.pinNamesSummary && (
              <span className="entry-pin-names">{entry.pinNamesSummary}</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (!libraryContext) {
    return null;
  }

  const hasAnySearchResults = filteredUserGroups.length > 0 || filteredBuiltInGroups.length > 0;

  return (
    <div {...other} data-component="LibraryView">
      <input
        ref={openLibraryFileInputRef}
        type="file"
        accept=".lclib,.json"
        className="hidden-file-input"
        onChange={handleFallbackOpenLibraryFile}
      />
      <input
        ref={importFileInputRef}
        type="file"
        accept=".lclib,.lcweb,.CircuitProject,.xml,.json"
        className="hidden-file-input"
        onChange={handleImportFileChange}
      />

      {/* Kompakte Aktionsleiste für Verknüpfung, Import und Export */}
      <div className="library-toolbar">
        <button
          type="button"
          className="library-tool-btn"
          title={t("library.toolbar.openFileTitle")}
          onClick={handleOpenLibraryClick}
          disabled={libraryContext.isLoading}
        >
          {t("library.toolbar.openFile")}
        </button>
        <button
          type="button"
          className="library-tool-btn"
          title={t("library.toolbar.createFileTitle")}
          onClick={() => {
            setLocalError(null);
            void libraryContext.createLibraryFile();
          }}
          disabled={libraryContext.isLoading}
        >
          {t("library.toolbar.createFile")}
        </button>
        <button
          type="button"
          className="library-tool-btn"
          title={t("library.toolbar.importTitle")}
          disabled={!isWritable || libraryContext.isLoading}
          onClick={() => importFileInputRef.current?.click()}
        >
          {t("library.toolbar.import")}
        </button>
        <button
          type="button"
          className="library-tool-btn"
          title={t("library.toolbar.exportTitle")}
          disabled={!persistenceState?.document}
          onClick={() => libraryContext.exportLibraryDocument()}
        >
          {t("library.toolbar.export")}
        </button>
        {persistenceState && persistenceState.status !== "uninitialized" && (
          <button
            type="button"
            className="library-tool-btn danger"
            title={t("library.toolbar.unlinkTitle")}
            onClick={() => void libraryContext.unlinkLibrary()}
          >
            {t("library.toolbar.unlink")}
          </button>
        )}
      </div>

      {/* Status-Pille der verknüpften Datei */}
      {persistenceState && persistenceState.status !== "uninitialized" && (
        <div
          className={`library-file-status${persistenceState.isReadOnly ? " readonly" : " synced"}`}
          data-testid="library-file-status"
        >
          <span className="status-filename">
            {t("library.status.synced", { fileName: persistenceState.fileName ?? "library.lclib" })}
          </span>
          {persistenceState.isReadOnly && (
            <span className="status-pill">{t("library.status.readOnly")}</span>
          )}
        </div>
      )}

      {/* Leerzustand / Aufforderung zum Laden oder Neuanlegen einer .lclib */}
      {persistenceState?.status === "uninitialized" && (
        <div className="library-empty-card" data-testid="library-empty-state">
          <div className="empty-title">{t("library.status.uninitializedTitle")}</div>
          <p className="empty-hint">{t("library.status.uninitializedHint")}</p>
          <div className="empty-actions">
            <button
              type="button"
              className="empty-btn primary"
              onClick={handleOpenLibraryClick}
            >
              {t("library.status.loadExistingButton")}
            </button>
            <button
              type="button"
              className="empty-btn"
              onClick={() => void libraryContext.createLibraryFile()}
            >
              {t("library.status.createNewButton")}
            </button>
          </div>
        </div>
      )}

      {/* Wegklickbarer Read-Only- / Resync-Hinweis nach Reload */}
      {showResyncBanner && persistenceState && (
        <div className="library-resync-banner" role="status" data-testid="library-resync-banner">
          <div className="resync-text-col">
            {persistenceState.status === "needs-permission" && (
              <>
                <div className="resync-title">
                  {t("library.resync.needsPermissionTitle", {
                    fileName: persistenceState.fileName ?? "library.lclib",
                  })}
                </div>
                <div className="resync-message">{t("library.resync.needsPermissionMessage")}</div>
              </>
            )}
            {persistenceState.status === "handle-invalid" && (
              <div className="resync-message">
                {t("library.resync.handleInvalidMessage", {
                  fileName: persistenceState.fileName ?? "library.lclib",
                })}
              </div>
            )}
            {persistenceState.status === "unsupported" && (
              <div className="resync-message">
                {t("library.resync.unsupportedMessage", {
                  fileName: persistenceState.fileName ?? "library.lclib",
                })}
              </div>
            )}
            {(persistenceState.status === "needs-permission" || persistenceState.status === "handle-invalid") && (
              <div className="resync-actions">
                <button
                  type="button"
                  className="resync-btn"
                  data-testid="library-resync-action"
                  onClick={() => {
                    if (persistenceState.status === "needs-permission") {
                      void libraryContext.resyncLibrary();
                    } else {
                      handleOpenLibraryClick();
                    }
                  }}
                >
                  {persistenceState.status === "needs-permission"
                    ? t("library.resync.button")
                    : t("library.resync.relinkButton")}
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="resync-dismiss"
            data-testid="library-resync-dismiss"
            aria-label={t("library.resync.dismissAriaLabel")}
            onClick={() => libraryContext.dismissResyncWarning()}
          >
            ×
          </button>
        </div>
      )}

      {/* Fehleranzeige */}
      {displayedError && (
        <div className="library-error-banner" role="alert">
          <span>{displayedError}</span>
          <button
            type="button"
            className="error-close"
            aria-label={t("common.close")}
            onClick={() => {
              setLocalError(null);
              libraryContext.clearLibraryError();
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Suchfeld */}
      <div className="library-search-box">
        <input
          type="search"
          className="library-search-input"
          data-testid="library-search-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("library.searchPlaceholder")}
          aria-label={t("library.searchAriaLabel")}
        />
      </div>

      {/* Scrollbare Katalog-Liste (Eigene Bibliothek + Standard-ICs) */}
      <div className="library-catalog-scroll">
        {persistenceState?.document && (
          <div className="library-section">
            <div className="library-section-heading">{t("library.sections.userLibrary")}</div>
            {userEntries.length === 0 ? (
              <div className="library-empty-user-note">{t("library.sections.emptyUserLibrary")}</div>
            ) : (
              filteredUserGroups.map((group) => (
                <PaletteCategory
                  key={group.collapseKey}
                  data-category-kind="library-user"
                  title={group.categoryName}
                  isExpanded={!collapsedCategories[group.collapseKey]}
                  onToggle={() => toggleCategory(group.collapseKey)}
                >
                  {group.items.map(renderLibraryEntry)}
                </PaletteCategory>
              ))
            )}
          </div>
        )}

        <div className="library-section">
          <div className="library-section-heading">{t("library.sections.builtInCatalog")}</div>
          {filteredBuiltInGroups.map((group) => (
            <PaletteCategory
              key={group.collapseKey}
              data-category-kind="library-builtin"
              title={group.categoryName}
              isExpanded={!collapsedCategories[group.collapseKey]}
              onToggle={() => toggleCategory(group.collapseKey)}
            >
              {group.items.map(renderLibraryEntry)}
            </PaletteCategory>
          ))}
        </div>

        {!hasAnySearchResults && normalizedQuery.length > 0 && (
          <div className="library-no-results">{t("library.noSearchResults")}</div>
        )}
      </div>

      {/* Kontextmenü auf Bibliothekseinträgen */}
      <ContextMenuPopup
        isOpen={itemMenuState !== null}
        x={itemMenuState?.x ?? 0}
        y={itemMenuState?.y ?? 0}
        ariaLabel={t("palette.contextMenuAriaLabel")}
        items={(() => {
          if (!itemMenuState) {
            return [] as ContextMenuItem[];
          }
          const { entry } = itemMenuState;
          if (entry.isBuiltIn) {
            return [
              {
                id: "lib-insert-copy",
                label: t("library.item.context.insertCopy"),
                disabled: isSimulating || !circuitContext,
                onSelect: () => handleInsertEntryIntoCanvas(entry),
              },
              {
                id: "lib-duplicate-to-user",
                label: t("library.item.context.duplicateToLibrary"),
                separatorBefore: true,
                disabled: !isWritable,
                tooltip: !isWritable ? t("library.item.context.needWritableForCopy") : undefined,
                onSelect: () => {
                  if (entry.builtInKey) {
                    void libraryContext.duplicateBuiltInToLibrary(entry.builtInKey);
                  }
                },
              },
              {
                id: "lib-export-native",
                label: t("library.item.context.exportNative"),
                separatorBefore: true,
                onSelect: () => libraryContext.exportLibraryCircuitNative(entry.circuit.logicalCircuitId),
              },
              {
                id: "lib-export-xml",
                label: t("library.item.context.exportXml"),
                onSelect: () => libraryContext.exportLibraryCircuitXml(entry.circuit.logicalCircuitId),
              },
            ];
          }

          return [
            {
              id: "lib-insert-copy",
              label: t("library.item.context.insertCopy"),
              disabled: isSimulating || !circuitContext,
              onSelect: () => handleInsertEntryIntoCanvas(entry),
            },
            {
              id: "lib-edit-mode",
              label: t("library.item.context.editInMode"),
              separatorBefore: true,
              disabled: !isWritable || isSimulating || !circuitContext,
              tooltip: !isWritable ? t("library.errors.readOnly") : undefined,
              onSelect: () => void libraryContext.enterLibraryEditMode(entry.circuit.logicalCircuitId),
            },
            {
              id: "lib-edit-metadata",
              label: t("library.item.context.editMetadata"),
              disabled: !isWritable,
              tooltip: !isWritable ? t("library.errors.readOnly") : undefined,
              onSelect: () => {
                const target =
                  hydratedUserCircuits.get(entry.circuit.logicalCircuitId) ??
                  buildMetadataEditLogicalCircuit(entry.circuit);
                setMetadataTarget(target);
              },
            },
            {
              id: "lib-export-native",
              label: t("library.item.context.exportNative"),
              separatorBefore: true,
              onSelect: () => libraryContext.exportLibraryCircuitNative(entry.circuit.logicalCircuitId),
            },
            {
              id: "lib-export-xml",
              label: t("library.item.context.exportXml"),
              onSelect: () => libraryContext.exportLibraryCircuitXml(entry.circuit.logicalCircuitId),
            },
            {
              id: "lib-delete-entry",
              label: t("library.item.context.delete"),
              danger: true,
              separatorBefore: true,
              disabled: !isWritable,
              tooltip: !isWritable ? t("library.errors.readOnly") : undefined,
              onSelect: () => handleRequestDeleteEntry(entry),
            },
          ];
        })()}
        onClose={() => setItemMenuState(null)}
      />

      {/* Metadaten-Dialog für Bibliothekseintrag (mit Bibliothek-Rahmenfarbe) */}
      <PropertyDialog
        isOpen={metadataTarget !== null}
        circuit={metadataTarget}
        contextCircuits={hydratedUserCircuitList}
        categories={existingCategories}
        accentVariant="library"
        customTitle={
          metadataTarget
            ? t("dialog.property.titleLibraryEdit", { name: metadataTarget.name })
            : undefined
        }
        onSaveCircuit={(circuitId, updates) => {
          void libraryContext.updateLibraryCircuitMetadata(circuitId, updates);
        }}
        onClose={() => setMetadataTarget(null)}
      />

      {/* Referenzgeschütztes Lösch-Bestätigungs-Modal */}
      <ConfirmDialog
        isOpen={deletePrompt !== null}
        title={
          deletePrompt && deletePrompt.dependents.length > 0
            ? t("library.deleteConfirm.referencedTitle")
            : t("library.deleteConfirm.title")
        }
        message={
          deletePrompt && deletePrompt.dependents.length > 0
            ? t("library.deleteConfirm.referencedMessage", {
              name: deletePrompt.entry.circuit.name,
              dependents: deletePrompt.dependents.map((d) => d.name).join(", "),
            })
            : t("library.deleteConfirm.message", { name: deletePrompt?.entry.circuit.name ?? "" })
        }
        confirmLabel={
          deletePrompt && deletePrompt.dependents.length > 0
            ? t("library.deleteConfirm.confirmCascadeDelete", {
              count: deletePrompt.dependents.length + 1,
            })
            : t("library.deleteConfirm.confirmDelete")
        }
        isDanger={true}
        onConfirm={() => {
          if (!deletePrompt) {
            return;
          }
          const targetId = deletePrompt.entry.circuit.logicalCircuitId;
          const cascadeDependents = deletePrompt.dependents.length > 0;
          setDeletePrompt(null);
          void libraryContext.deleteLibraryCircuits(targetId, { cascadeDependents });
        }}
        onCancel={() => setDeletePrompt(null)}
      />

      {/* Import-Kandidaten-Auswahl für .lclib / .lcweb / .CircuitProject */}
      {importCandidateState && (
        <div className="library-import-overlay" role="dialog" aria-modal="true">
          <div
            className="import-backdrop"
            onClick={() => setImportCandidateState(null)}
          />
          <div className="import-modal">
            <div className="import-modal-header">
              <h4>{t("library.importDialog.title", { fileName: importCandidateState.fileName })}</h4>
              <button
                type="button"
                className="import-close-btn"
                aria-label={t("common.close")}
                onClick={() => setImportCandidateState(null)}
              >
                ×
              </button>
            </div>
            <p className="import-modal-desc">{t("library.importDialog.description")}</p>
            <div className="import-select-all">
              <label>
                <input
                  type="checkbox"
                  checked={importCandidateState.selectedIds.length === importCandidateState.candidates.length}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setImportCandidateState((prev) =>
                      prev
                        ? {
                          ...prev,
                          selectedIds: checked
                            ? prev.candidates.map((c) => c.logicalCircuitId)
                            : [],
                        }
                        : null,
                    );
                  }}
                />
                <span>{t("library.importDialog.selectAll")}</span>
              </label>
            </div>
            <div className="import-candidate-list">
              {importCandidateState.candidates.map((candidate) => {
                const isChecked = importCandidateState.selectedIds.includes(candidate.logicalCircuitId);
                const depCount = Math.max(0, candidate.transitiveCircuitIds.length - 1);
                return (
                  <label key={candidate.logicalCircuitId} className="import-candidate-row">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setImportCandidateState((prev) => {
                          if (!prev) {
                            return null;
                          }
                          const nextIds = checked
                            ? [...prev.selectedIds, candidate.logicalCircuitId]
                            : prev.selectedIds.filter((id) => id !== candidate.logicalCircuitId);
                          return { ...prev, selectedIds: nextIds };
                        });
                      }}
                    />
                    <span className="candidate-name">{candidate.name}</span>
                    {candidate.isProjectRoot && (
                      <span className="candidate-badge">{t("library.importDialog.rootBadge")}</span>
                    )}
                    {depCount > 0 && (
                      <span className="candidate-deps">
                        {t("library.importDialog.depsCount", { count: depCount })}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            <div className="import-modal-footer">
              <button
                type="button"
                className="import-btn"
                onClick={() => setImportCandidateState(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="import-btn primary"
                disabled={importCandidateState.selectedIds.length === 0}
                onClick={() => {
                  const snapshot = importCandidateState;
                  setImportCandidateState(null);
                  void libraryContext.importCircuitsIntoLibrary(
                    snapshot.rawText,
                    snapshot.selectedIds,
                  );
                }}
              >
                {t("library.importDialog.confirmButton")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
})({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",

  "& > .hidden-file-input": {
    display: "none",
  },

  "& > .library-toolbar": {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.25rem",
    padding: "0.5rem 0.65rem",
    borderBottom: "1px solid var(--color-border-subtle)",
    backgroundColor: "var(--color-bg-base)",

    "& > .library-tool-btn": {
      padding: "0.2rem 0.45rem",
      borderRadius: "0.25rem",
      border: "1px solid var(--color-border-strong)",
      backgroundColor: "var(--color-bg-elevated)",
      color: "var(--color-text-primary)",
      fontSize: "0.7rem",
      fontWeight: 500,
      cursor: "pointer",

      "&:hover:not(:disabled)": {
        borderColor: "var(--color-library-accent)",
        backgroundColor: "var(--color-library-bg)",
      },

      "&.danger:hover:not(:disabled)": {
        borderColor: "var(--color-logic-error)",
        backgroundColor: "var(--color-error-bg)",
      },

      "&:disabled": {
        opacity: 0.45,
        cursor: "not-allowed",
      },
    },
  },

  "& > .library-file-status": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.35rem",
    padding: "0.3rem 0.65rem",
    fontSize: "0.7rem",
    borderBottom: "1px solid var(--color-border-subtle)",
    backgroundColor: "var(--color-bg-surface)",

    "&.synced": {
      color: "var(--color-text-secondary)",
    },

    "&.readonly": {
      backgroundColor: "var(--color-warning-bg)",
      color: "var(--color-warning)",
    },

    "& > .status-filename": {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },

    "& > .status-pill": {
      flexShrink: 0,
      fontSize: "0.625rem",
      fontWeight: 600,
      padding: "0.08rem 0.3rem",
      borderRadius: "0.2rem",
      border: "1px solid var(--color-warning-border)",
      backgroundColor: "var(--color-warning-bg-strong)",
    },
  },

  "& > .library-empty-card": {
    margin: "0.5rem 0.65rem 0.25rem",
    padding: "0.6rem 0.65rem",
    borderRadius: "0.375rem",
    border: "1px solid var(--color-library-border)",
    backgroundColor: "var(--color-library-bg)",
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",

    "& > .empty-title": {
      fontSize: "0.78rem",
      fontWeight: 600,
      color: "var(--color-library-accent)",
    },

    "& > .empty-hint": {
      margin: 0,
      fontSize: "0.7rem",
      lineHeight: 1.35,
      color: "var(--color-text-secondary)",
    },

    "& > .empty-actions": {
      display: "flex",
      flexWrap: "wrap",
      gap: "0.35rem",
      marginTop: "0.2rem",

      "& > .empty-btn": {
        padding: "0.28rem 0.55rem",
        borderRadius: "0.25rem",
        border: "1px solid var(--color-border-strong)",
        backgroundColor: "var(--color-bg-elevated)",
        color: "var(--color-text-primary)",
        fontSize: "0.72rem",
        fontWeight: 600,
        cursor: "pointer",

        "&.primary": {
          borderColor: "var(--color-library-accent)",
          backgroundColor: "var(--color-library-accent)",
          color: "var(--color-text-on-accent)",
        },

        "&:hover": {
          filter: "brightness(1.08)",
        },
      },
    },
  },

  "& > .library-resync-banner": {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.4rem",
    margin: "0.5rem 0.65rem 0.25rem",
    padding: "0.5rem 0.6rem",
    borderRadius: "0.375rem",
    border: "1px solid var(--color-warning-border)",
    backgroundColor: "var(--color-warning-bg)",
    color: "var(--color-text-primary)",
    fontSize: "0.72rem",

    "& > .resync-text-col": {
      flex: 1,
      minWidth: 0,
      display: "flex",
      flexDirection: "column",
      gap: "0.25rem",

      "& > .resync-title": {
        fontWeight: 600,
        color: "var(--color-warning)",
      },

      "& > .resync-message": {
        lineHeight: 1.35,
        color: "var(--color-text-secondary)",
      },

      "& > .resync-actions": {
        marginTop: "0.15rem",

        "& > .resync-btn": {
          padding: "0.22rem 0.5rem",
          borderRadius: "0.25rem",
          border: "1px solid var(--color-warning)",
          backgroundColor: "var(--color-warning)",
          color: "var(--color-text-on-accent)",
          fontSize: "0.7rem",
          fontWeight: 600,
          cursor: "pointer",
        },
      },
    },

    "& > .resync-dismiss": {
      border: "none",
      background: "none",
      color: "var(--color-text-secondary)",
      cursor: "pointer",
      fontSize: "0.95rem",
      lineHeight: 1,
      padding: "0 0.15rem",
    },
  },

  "& > .library-error-banner": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.4rem",
    padding: "0.4rem 0.65rem",
    backgroundColor: "var(--color-error-bg)",
    borderBottom: "1px solid var(--color-error-border)",
    color: "var(--color-error-text)",
    fontSize: "0.72rem",

    "& > .error-close": {
      border: "none",
      background: "none",
      color: "inherit",
      cursor: "pointer",
      fontSize: "0.9rem",
    },
  },

  "& > .library-search-box": {
    padding: "0.45rem 0.65rem",
    borderBottom: "1px solid var(--color-border-subtle)",

    "& > .library-search-input": {
      width: "100%",
      padding: "0.3rem 0.5rem",
      borderRadius: "0.25rem",
      border: "1px solid var(--color-border-strong)",
      backgroundColor: "var(--color-bg-base)",
      color: "var(--color-text-primary)",
      fontSize: "0.75rem",
      boxSizing: "border-box",

      "&:focus": {
        outline: "none",
        borderColor: "var(--color-library-accent)",
      },
    },
  },

  "& > .library-catalog-scroll": {
    flex: 1,
    overflowY: "auto",
    minHeight: 0,
    paddingBottom: "0.75rem",

    "& > .library-section": {
      marginTop: "0.25rem",

      "& > .library-section-heading": {
        padding: "0.35rem 0.75rem 0.2rem",
        fontSize: "0.66rem",
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--color-library-accent)",
      },

      "& > .library-empty-user-note": {
        padding: "0.35rem 0.75rem 0.55rem",
        fontSize: "0.7rem",
        lineHeight: 1.35,
        color: "var(--color-text-muted)",
      },
    },

    "& .library-entry-card": {
      display: "flex",
      alignItems: "center",
      gap: "0.5rem",
      padding: "0.38rem 0.65rem",
      cursor: "grab",
      borderLeft: "2px solid transparent",
      userSelect: "none",

      "&:hover:not(.is-disabled)": {
        backgroundColor: "var(--color-surface-hover)",
        borderLeftColor: "var(--color-library-accent)",
      },

      "&.is-editing": {
        backgroundColor: "var(--color-library-bg)",
        borderLeftColor: "var(--color-library-accent)",
      },

      "&.is-disabled": {
        opacity: 0.45,
        cursor: "not-allowed",
      },

      "& > .entry-glyph": {
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "3rem",
        minWidth: "3rem",
        height: "2.25rem",

        "& > .preview-svg": {
          display: "block",
        },
      },

      "& > .entry-meta": {
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "0.1rem",

        "& > .entry-title-row": {
          display: "flex",
          alignItems: "center",
          gap: "0.3rem",

          "& > .entry-name": {
            fontSize: "0.78rem",
            fontWeight: 500,
            color: "var(--color-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          },

          "& > .entry-badge": {
            flexShrink: 0,
            fontSize: "0.58rem",
            fontWeight: 700,
            padding: "0.05rem 0.25rem",
            borderRadius: "0.2rem",

            "&.readonly": {
              color: "var(--color-text-secondary)",
              border: "1px solid var(--color-border-strong)",
              backgroundColor: "var(--color-bg-elevated)",
            },

            "&.editing": {
              color: "var(--color-text-on-accent)",
              backgroundColor: "var(--color-library-accent)",
            },
          },
        },

        "& > .entry-sub-row": {
          display: "flex",
          alignItems: "center",
          gap: "0.35rem",
          fontSize: "0.66rem",
          color: "var(--color-text-muted)",

          "& > .entry-pins": {
            flexShrink: 0,
            fontFamily: "var(--font-family-mono)",
          },

          "& > .entry-pin-names": {
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          },
        },
      },
    },

    "& > .library-no-results": {
      padding: "0.9rem 0.75rem",
      fontSize: "0.75rem",
      color: "var(--color-text-muted)",
      textAlign: "center",
    },
  },

  "& > .library-import-overlay": {
    position: "fixed",
    inset: 0,
    zIndex: 1100,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",

    "& > .import-backdrop": {
      position: "absolute",
      inset: 0,
      backgroundColor: "rgba(0, 0, 0, 0.65)",
      backdropFilter: "blur(2px)",
    },

    "& > .import-modal": {
      position: "relative",
      width: "26rem",
      maxWidth: "92vw",
      maxHeight: "82vh",
      display: "flex",
      flexDirection: "column",
      backgroundColor: "var(--color-bg-surface)",
      border: "1px solid var(--color-library-accent)",
      borderRadius: "0.5rem",
      boxShadow: "0 10px 25px rgba(0, 0, 0, 0.5)",
      overflow: "hidden",
      padding: "0.85rem 1rem",
      gap: "0.6rem",
      color: "var(--color-text-primary)",

      "& > .import-modal-header": {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",

        "& > h4": {
          margin: 0,
          fontSize: "0.92rem",
          fontWeight: 600,
        },

        "& > .import-close-btn": {
          border: "none",
          background: "none",
          color: "var(--color-text-secondary)",
          fontSize: "1.1rem",
          cursor: "pointer",
        },
      },

      "& > .import-modal-desc": {
        margin: 0,
        fontSize: "0.76rem",
        color: "var(--color-text-secondary)",
        lineHeight: 1.4,
      },

      "& > .import-select-all": {
        fontSize: "0.76rem",
        fontWeight: 600,

        "& label": {
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          cursor: "pointer",
        },
      },

      "& > .import-candidate-list": {
        flex: 1,
        overflowY: "auto",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "0.35rem",
        padding: "0.35rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",

        "& > .import-candidate-row": {
          display: "flex",
          alignItems: "center",
          gap: "0.45rem",
          padding: "0.25rem 0.35rem",
          borderRadius: "0.25rem",
          fontSize: "0.76rem",
          cursor: "pointer",

          "&:hover": {
            backgroundColor: "var(--color-surface-hover)",
          },

          "& > .candidate-name": {
            fontWeight: 500,
          },

          "& > .candidate-badge": {
            fontSize: "0.64rem",
            padding: "0.06rem 0.3rem",
            borderRadius: "0.2rem",
            backgroundColor: "var(--color-accent-tint)",
            color: "var(--color-accent-primary)",
          },

          "& > .candidate-deps": {
            marginLeft: "auto",
            fontSize: "0.68rem",
            color: "var(--color-text-muted)",
          },
        },
      },

      "& > .import-modal-footer": {
        display: "flex",
        justifyContent: "flex-end",
        gap: "0.45rem",

        "& > .import-btn": {
          padding: "0.35rem 0.75rem",
          borderRadius: "0.3rem",
          border: "1px solid var(--color-border-strong)",
          backgroundColor: "var(--color-bg-elevated)",
          color: "var(--color-text-primary)",
          fontSize: "0.76rem",
          cursor: "pointer",

          "&.primary": {
            borderColor: "var(--color-library-accent)",
            backgroundColor: "var(--color-library-accent)",
            color: "var(--color-text-on-accent)",
            fontWeight: 600,
          },

          "&:disabled": {
            opacity: 0.45,
            cursor: "not-allowed",
          },
        },
      },
    },
  },
});

export default LibraryView;
