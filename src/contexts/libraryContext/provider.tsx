import React from "react";

import { useTranslation } from "react-i18next";

import LibraryContext, {
  type LibraryCircuitMetadataUpdate,
  type LibraryDeleteDependent,
  type LibraryDeleteResult,
  type SidebarPaletteTab,
} from ".";

import type CircuitProject from "../../types/circuit/circuitProject";
import type Project from "../../types/circuit/project";
import type CircuitLibraryDocument from "../../types/storage/circuitLibrary";
import type { LibraryPersistenceState } from "../../types/storage/circuitLibrary";
import type { NativeLogicalCircuit } from "../../types/storage/nativeProjectFormat";

import {
  BUILT_IN_CIRCUIT_IDS,
  type BuiltInCircuitKey,
  duplicateBuiltInCircuitToLibrary,
  getBuiltInLibraryCircuits,
  getBuiltInLibraryItems,
} from "../../utils/builtInLibraryCatalog";
import { circuitContainsDisplays } from "../../utils/circuitLayout";
import {
  type FileSystemDeps,
  type FileSystemFileHandleLike,
  saveLibraryCacheRecord,
} from "../../utils/fileSystemStorage";
import {
  transferProjectCircuitToLibrary,
  type TransferToLibraryResult,
} from "../../utils/libraryCircuitTransfer";
import {
  buildCircuitLibraryDocument,
  buildLibraryFileName,
  createAndLinkLibraryFile,
  exportLibraryCircuitAsDesktopXml,
  exportLibraryCircuitAsNativeProject,
  importCircuitsFromFileText,
  loadInitialLibraryState,
  openAndLinkLibraryFile,
  parseCircuitLibraryDocument,
  resyncLibraryWithPermission,
  saveLibraryDocumentToLinkedFile,
  serializeCircuitLibrary,
  unlinkLibraryFile,
} from "../../utils/libraryStorage";
import { buildCircuitProjectFromNativeCircuits } from "../../utils/storage/nativeProjectReader";
import {
  buildNativeProjectFileName,
  serializeLogicalCircuitToNative,
} from "../../utils/storage/nativeProjectWriter";
import { getHydratedNativeCircuitsMap } from "../../utils/subCircuitPreview";

import CircuitContext, { type CircuitProjectSnapshot } from "../circuitContext";
import SimulationContext from "../simulationContext";

type LibraryContextProviderProps = {
  children: React.ReactNode;
  initialPersistenceState?: LibraryPersistenceState;
  storageDeps?: FileSystemDeps;
  skipInitialLoad?: boolean;
};

const EMPTY_PERSISTENCE_STATE: LibraryPersistenceState = {
  status: "uninitialized",
  isReadOnly: true,
  fileName: null,
  cachedAt: null,
  lastSyncedAt: null,
  document: null,
};

function triggerTextDownload(content: string, fileName: string, mimeType: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    return;
  }
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

function sanitizeExportBaseName(rawName: string): string {
  const trimmed = rawName.trim().replace(/[<>:"/\\|?*]+/g, "_");
  return trimmed.length > 0 ? trimmed : "Circuit";
}

function buildLibraryEditProjectMeta(
  fileName: string | null,
  rootCircuit: NativeLogicalCircuit,
): Project {
  return {
    projectId: `lib-edit-${rootCircuit.logicalCircuitId}`,
    name: fileName ? fileName.replace(/\.lclib$/i, "") : rootCircuit.name,
    note: rootCircuit.note,
    zoom: 1,
    frequency: 10,
    isMaximumSpeed: false,
    logicalCircuitId: rootCircuit.logicalCircuitId,
    startupCircuitId: undefined,
    categoryTextNoteCollapsed: false,
    categoryInputOutputCollapsed: false,
    categoryPrimitivesCollapsed: false,
  };
}

const LibraryContextProvider: React.FC<LibraryContextProviderProps> = ({
  children,
  initialPersistenceState,
  storageDeps,
  skipInitialLoad = false,
}) => {
  const { t, i18n } = useTranslation();
  const circuitContext = React.useContext(CircuitContext);
  const simulationContext = React.useContext(SimulationContext);

  const [activeSidebarTab, setActiveSidebarTab] = React.useState<SidebarPaletteTab>("project");
  const [persistenceState, setPersistenceStateRaw] = React.useState<LibraryPersistenceState>(
    () => initialPersistenceState ?? EMPTY_PERSISTENCE_STATE,
  );
  const persistenceStateRef = React.useRef<LibraryPersistenceState>(persistenceState);
  persistenceStateRef.current = persistenceState;
  const activeHandleRef = React.useRef<FileSystemFileHandleLike | null>(
    initialPersistenceState?.handle ?? null,
  );
  const hasLoadedInitialRef = React.useRef(false);

  const updatePersistenceState = React.useCallback(
    (nextState: LibraryPersistenceState) => {
      if (nextState.status === "uninitialized") {
        activeHandleRef.current = null;
      } else if (nextState.handle !== undefined) {
        activeHandleRef.current = nextState.handle;
      }
      persistenceStateRef.current = nextState;
      setPersistenceStateRaw(nextState);
    },
    [],
  );

  const [isLoading, setIsLoading] = React.useState(false);
  const [isResyncWarningDismissed, setIsResyncWarningDismissed] = React.useState(false);
  const [libraryError, setLibraryError] = React.useState<string | null>(null);
  const [editingLibraryCircuitId, setEditingLibraryCircuitIdRaw] = React.useState<string | null>(null);
  const editingLibraryCircuitIdRef = React.useRef<string | null>(null);
  editingLibraryCircuitIdRef.current = editingLibraryCircuitId;

  const updateEditingLibraryCircuitId = React.useCallback(
    (nextId: string | null) => {
      editingLibraryCircuitIdRef.current = nextId;
      setEditingLibraryCircuitIdRaw(nextId);
    },
    [],
  );

  const savedProjectSnapshotRef = React.useRef<CircuitProjectSnapshot | null>(null);

  const clearLibraryError = React.useCallback(
    () => {
      setLibraryError(null);
    },
    [],
  );

  const dismissResyncWarning = React.useCallback(
    () => {
      setIsResyncWarningDismissed(true);
    },
    [],
  );

  const reloadInitialLibrary = React.useCallback(
    async () => {
      setIsLoading(true);
      try {
        const nextState = await loadInitialLibraryState(storageDeps);
        updatePersistenceState(nextState);
        setIsResyncWarningDismissed(false);
        setLibraryError(nextState.errorReason ?? null);
      } catch (err) {
        setLibraryError(err instanceof Error ? err.message : t("library.errors.loadFailed"));
      } finally {
        setIsLoading(false);
      }
    },
    [
      storageDeps,
      t,
      updatePersistenceState,
    ],
  );

  React.useEffect(
    () => {
      if (hasLoadedInitialRef.current || skipInitialLoad || initialPersistenceState !== undefined) {
        return;
      }
      hasLoadedInitialRef.current = true;
      void reloadInitialLibrary();
    },
    [
      initialPersistenceState,
      reloadInitialLibrary,
      skipInitialLoad,
    ],
  );

  const builtInItems = React.useMemo(
    () => {
      const translateFn = (key: string) => t(key);
      return getBuiltInLibraryItems(translateFn);
    },
    // Neuberechnung erzwingen, wenn sich die aktive UI-Sprache ändert
    [i18n.language, t],
  );

  const builtInCircuits = React.useMemo(
    () => {
      const translateFn = (key: string) => t(key);
      return getBuiltInLibraryCircuits(translateFn);
    },
    [i18n.language, t],
  );

  const userCircuits = React.useMemo(
    () => persistenceState.document?.logicalCircuits ?? [],
    [persistenceState.document],
  );

  const isWritable = persistenceState.document !== null && !persistenceState.isReadOnly;

  const persistUpdatedDocument = React.useCallback(
    async (nextCircuits: NativeLogicalCircuit[]): Promise<boolean> => {
      const current = persistenceStateRef.current;
      if (!current.document || current.isReadOnly) {
        setLibraryError(t("library.errors.readOnly"));
        return false;
      }

      const nextDoc: CircuitLibraryDocument = buildCircuitLibraryDocument(nextCircuits);
      const nextState = await saveLibraryDocumentToLinkedFile(
        nextDoc,
        {
          requestPermission: true,
          existingHandle: activeHandleRef.current,
          existingFileName: current.fileName,
        },
        storageDeps,
      );
      updatePersistenceState(nextState);

      if (nextState.isReadOnly || nextState.status !== "synced") {
        setLibraryError(nextState.errorReason ?? t("library.errors.saveFailed"));
        return false;
      }

      setLibraryError(null);
      return true;
    },
    [
      storageDeps,
      t,
      updatePersistenceState,
    ],
  );

  const openLibraryFile = React.useCallback(
    async (): Promise<boolean> => {
      setIsLoading(true);
      try {
        const result = await openAndLinkLibraryFile(undefined, storageDeps);
        if (result.status === "cancelled") {
          return false;
        }
        updatePersistenceState(result);
        setIsResyncWarningDismissed(false);
        setLibraryError(result.errorReason ?? null);
        return true;
      } catch (err) {
        setLibraryError(err instanceof Error ? err.message : t("library.errors.loadFailed"));
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [
      storageDeps,
      t,
      updatePersistenceState,
    ],
  );

  const openLibraryFromText = React.useCallback(
    (rawText: string, fileName?: string | null): boolean => {
      try {
        const parsed = parseCircuitLibraryDocument(rawText);
        const now = Date.now();
        const resolvedName = fileName && fileName.trim().length > 0 ? fileName : buildLibraryFileName();
        updatePersistenceState({
          status: "unsupported",
          isReadOnly: true,
          fileName: resolvedName,
          cachedAt: now,
          lastSyncedAt: null,
          document: parsed,
        });
        setIsResyncWarningDismissed(false);
        setLibraryError(null);
        void saveLibraryCacheRecord({
          fileName: resolvedName,
          content: serializeCircuitLibrary(parsed),
          cachedAt: now,
        }, storageDeps).catch(() => {
          // Best-Effort-Cache falls IndexedDB im Fallback nicht verfügbar ist
        });
        return true;
      } catch (err) {
        setLibraryError(err instanceof Error ? err.message : t("library.errors.loadFailed"));
        return false;
      }
    },
    [
      storageDeps,
      t,
      updatePersistenceState,
    ],
  );

  const createLibraryFile = React.useCallback(
    async (suggestedName?: string): Promise<boolean> => {
      setIsLoading(true);
      try {
        const result = await createAndLinkLibraryFile({ suggestedName }, storageDeps);
        if (result.status === "cancelled") {
          return false;
        }
        updatePersistenceState(result);
        setIsResyncWarningDismissed(false);
        setLibraryError(result.errorReason ?? null);
        return result.status === "synced";
      } catch (err) {
        setLibraryError(err instanceof Error ? err.message : t("library.errors.createFailed"));
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [
      storageDeps,
      t,
      updatePersistenceState,
    ],
  );

  const resyncLibrary = React.useCallback(
    async (): Promise<boolean> => {
      setIsLoading(true);
      try {
        const nextState = await resyncLibraryWithPermission(storageDeps, activeHandleRef.current);
        updatePersistenceState(nextState);
        if (nextState.status === "synced") {
          setIsResyncWarningDismissed(false);
          setLibraryError(null);
          return true;
        }
        setLibraryError(nextState.errorReason ?? t("library.errors.resyncFailed"));
        return false;
      } catch (err) {
        setLibraryError(err instanceof Error ? err.message : t("library.errors.resyncFailed"));
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [
      storageDeps,
      t,
      updatePersistenceState,
    ],
  );

  const exitLibraryEditMode = React.useCallback(
    async (): Promise<void> => {
      if (editingLibraryCircuitIdRef.current === null) {
        return;
      }
      if (simulationContext?.isSimulating) {
        simulationContext.stopSimulation();
      }
      const snapshot = savedProjectSnapshotRef.current;
      savedProjectSnapshotRef.current = null;
      updateEditingLibraryCircuitId(null);
      if (snapshot && circuitContext?.restoreProjectSnapshot) {
        circuitContext.restoreProjectSnapshot(snapshot, { suppressCollabSync: true });
      }
    },
    [
      circuitContext,
      simulationContext,
      updateEditingLibraryCircuitId,
    ],
  );

  const unlinkLibrary = React.useCallback(
    async (): Promise<void> => {
      if (editingLibraryCircuitIdRef.current !== null) {
        await exitLibraryEditMode();
      }
      await unlinkLibraryFile({ clearCache: true }, storageDeps);
      updatePersistenceState(EMPTY_PERSISTENCE_STATE);
      setIsResyncWarningDismissed(false);
      setLibraryError(null);
    },
    [
      exitLibraryEditMode,
      storageDeps,
      updatePersistenceState,
    ],
  );

  const addProjectCircuitToLibrary = React.useCallback(
    async (
      sourceProject: CircuitProject,
      rootCircuitId: string,
      metadataOverrides?: LibraryCircuitMetadataUpdate,
    ): Promise<TransferToLibraryResult | null> => {
      const current = persistenceStateRef.current;
      if (!current.document || current.isReadOnly) {
        setLibraryError(t("library.errors.readOnly"));
        return null;
      }

      const transfer = transferProjectCircuitToLibrary(
        sourceProject,
        rootCircuitId,
        current.document.logicalCircuits,
        {
          rootMetadataOverrides: metadataOverrides,
          deduplicateRoot: false,
        },
      );

      const ok = await persistUpdatedDocument(transfer.logicalCircuits);
      return ok ? transfer : null;
    },
    [persistUpdatedDocument, t],
  );

  const duplicateBuiltInToLibrary = React.useCallback(
    async (builtInKey: BuiltInCircuitKey): Promise<TransferToLibraryResult | null> => {
      const current = persistenceStateRef.current;
      if (!current.document || current.isReadOnly) {
        setLibraryError(t("library.errors.readOnly"));
        return null;
      }

      const transfer = duplicateBuiltInCircuitToLibrary(
        BUILT_IN_CIRCUIT_IDS[builtInKey],
        current.document.logicalCircuits,
        { translate: (key) => t(key) },
      );
      const ok = await persistUpdatedDocument(transfer.logicalCircuits);
      return ok ? transfer : null;
    },
    [persistUpdatedDocument, t],
  );

  const updateLibraryCircuitMetadata = React.useCallback(
    async (circuitId: string, updates: LibraryCircuitMetadataUpdate): Promise<boolean> => {
      const current = persistenceStateRef.current;
      if (!current.document || current.isReadOnly) {
        setLibraryError(t("library.errors.readOnly"));
        return false;
      }

      let resolvedCircuitShape = updates.circuitShape;
      if (resolvedCircuitShape === "display") {
        const hydratedMap = getHydratedNativeCircuitsMap(current.document.logicalCircuits);
        const hydratedTarget = hydratedMap.get(circuitId);
        if (!hydratedTarget || !circuitContainsDisplays(hydratedTarget, hydratedMap)) {
          resolvedCircuitShape = "rectangular";
        }
      }

      let found = false;
      const pinOrderMap = updates.pinOrder
        ? new Map(updates.pinOrder.map((entry) => [entry.pinId, entry.index]))
        : null;
      const nextCircuits = current.document.logicalCircuits.map((lc) => {
        if (lc.logicalCircuitId !== circuitId) {
          return lc;
        }
        found = true;
        return {
          ...lc,
          name: updates.name !== undefined ? (updates.name.trim() || lc.name) : lc.name,
          notation: updates.notation !== undefined ? updates.notation : lc.notation,
          category: updates.category !== undefined ? updates.category : lc.category,
          note: updates.note !== undefined ? updates.note : lc.note,
          circuitShape: resolvedCircuitShape !== undefined ? resolvedCircuitShape : lc.circuitShape,
          showLabelAbove: updates.showLabelAbove !== undefined ? updates.showLabelAbove : lc.showLabelAbove,
          displayMargin: updates.displayMargin !== undefined ? updates.displayMargin : lc.displayMargin,
          exportToHDL: updates.exportToHDL !== undefined ? updates.exportToHDL : lc.exportToHDL,
          pins: pinOrderMap
            ? lc.pins.map((pin) => {
              const nextIndex = pinOrderMap.get(pin.pinId);
              return nextIndex !== undefined ? { ...pin, index: nextIndex } : pin;
            })
            : lc.pins,
        };
      });

      if (!found) {
        return false;
      }

      const ok = await persistUpdatedDocument(nextCircuits);
      if (ok && editingLibraryCircuitIdRef.current !== null && circuitContext) {
        circuitContext.updateCircuitProperties(circuitId, {
          ...updates,
          ...(resolvedCircuitShape !== undefined ? { circuitShape: resolvedCircuitShape } : {}),
        });
      }
      return ok;
    },
    [
      circuitContext,
      persistUpdatedDocument,
      t,
    ],
  );

  const getLibraryDeletionDependents = React.useCallback(
    (circuitId: string): LibraryDeleteDependent[] => {
      const circuits = persistenceStateRef.current.document?.logicalCircuits ?? [];
      const reverseDependents = new Map<string, NativeLogicalCircuit[]>();

      for (const lc of circuits) {
        for (const elem of lc.elements) {
          if (elem.kind === "subCircuit") {
            const list = reverseDependents.get(elem.logicalCircuitId) ?? [];
            list.push(lc);
            reverseDependents.set(elem.logicalCircuitId, list);
          }
        }
      }

      const visited = new Set<string>([circuitId]);
      const queue: string[] = [circuitId];
      const result: LibraryDeleteDependent[] = [];

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        const parents = reverseDependents.get(currentId) ?? [];
        for (const parent of parents) {
          if (!visited.has(parent.logicalCircuitId)) {
            visited.add(parent.logicalCircuitId);
            queue.push(parent.logicalCircuitId);
            result.push({
              logicalCircuitId: parent.logicalCircuitId,
              name: parent.name,
            });
          }
        }
      }

      return result;
    },
    [],
  );

  const deleteLibraryCircuits = React.useCallback(
    async (
      circuitId: string,
      options?: { cascadeDependents?: boolean },
    ): Promise<LibraryDeleteResult> => {
      const current = persistenceStateRef.current;
      if (!current.document || current.isReadOnly) {
        setLibraryError(t("library.errors.readOnly"));
        return { deletedIds: [], blockedByDependents: [] };
      }

      const dependents = getLibraryDeletionDependents(circuitId);
      if (dependents.length > 0 && !options?.cascadeDependents) {
        return {
          deletedIds: [],
          blockedByDependents: dependents,
        };
      }

      const removeSet = new Set<string>([
        circuitId,
        ...dependents.map((d) => d.logicalCircuitId),
      ]);
      const nextCircuits = current.document.logicalCircuits.filter(
        (lc) => !removeSet.has(lc.logicalCircuitId),
      );

      const ok = await persistUpdatedDocument(nextCircuits);
      if (!ok) {
        return { deletedIds: [], blockedByDependents: [] };
      }

      if (editingLibraryCircuitIdRef.current && removeSet.has(editingLibraryCircuitIdRef.current)) {
        await exitLibraryEditMode();
      }

      return {
        deletedIds: Array.from(removeSet),
        blockedByDependents: [],
      };
    },
    [
      exitLibraryEditMode,
      getLibraryDeletionDependents,
      persistUpdatedDocument,
      t,
    ],
  );

  const importCircuitsIntoLibrary = React.useCallback(
    async (rawText: string, selectedRootCircuitIds?: readonly string[]): Promise<number> => {
      const current = persistenceStateRef.current;
      if (!current.document || current.isReadOnly) {
        setLibraryError(t("library.errors.readOnly"));
        return 0;
      }

      const extracted = importCircuitsFromFileText(rawText, selectedRootCircuitIds);
      if (extracted.logicalCircuits.length === 0) {
        return 0;
      }

      const targetIds = selectedRootCircuitIds && selectedRootCircuitIds.length > 0
        ? selectedRootCircuitIds
        : extracted.logicalCircuits.map((lc) => lc.logicalCircuitId);

      const tempMeta: Project = {
        projectId: "temp-library-import",
        name: "Temp Import",
        note: "",
        zoom: 1,
        frequency: 10,
        isMaximumSpeed: false,
        logicalCircuitId: extracted.logicalCircuits[0].logicalCircuitId,
        startupCircuitId: undefined,
        categoryTextNoteCollapsed: false,
        categoryInputOutputCollapsed: false,
        categoryPrimitivesCollapsed: false,
      };

      const tempProject = buildCircuitProjectFromNativeCircuits(tempMeta, [], extracted.logicalCircuits);
      let workingCircuits = [...current.document.logicalCircuits];
      let addedCount = 0;

      for (const rootId of targetIds) {
        if (!tempProject.logicalCircuits.some((lc) => lc.logicalCircuitId === rootId)) {
          continue;
        }
        const transfer = transferProjectCircuitToLibrary(
          tempProject,
          rootId,
          workingCircuits,
          { deduplicateRoot: false },
        );
        workingCircuits = transfer.logicalCircuits;
        addedCount += transfer.addedCircuits.length;
      }

      const ok = await persistUpdatedDocument(workingCircuits);
      return ok ? addedCount : 0;
    },
    [persistUpdatedDocument, t],
  );

  const findAvailableCircuitSource = React.useCallback(
    (circuitId: string): { allCircuits: readonly NativeLogicalCircuit[]; target: NativeLogicalCircuit } | null => {
      const userList = persistenceStateRef.current.document?.logicalCircuits ?? [];
      const userMatch = userList.find((lc) => lc.logicalCircuitId === circuitId);
      if (userMatch) {
        return { allCircuits: userList, target: userMatch };
      }
      const builtInMatch = builtInCircuits.find((lc) => lc.logicalCircuitId === circuitId);
      if (builtInMatch) {
        return { allCircuits: builtInCircuits, target: builtInMatch };
      }
      return null;
    },
    [builtInCircuits],
  );

  const exportLibraryCircuitNative = React.useCallback(
    (circuitId: string) => {
      const found = findAvailableCircuitSource(circuitId);
      if (!found) {
        return;
      }
      const jsonText = exportLibraryCircuitAsNativeProject(found.allCircuits, circuitId);
      const fileName = buildNativeProjectFileName(found.target.name);
      triggerTextDownload(jsonText, fileName, "application/json;charset=utf-8");
    },
    [findAvailableCircuitSource],
  );

  const exportLibraryCircuitXml = React.useCallback(
    (circuitId: string) => {
      const found = findAvailableCircuitSource(circuitId);
      if (!found) {
        return;
      }
      const xmlText = exportLibraryCircuitAsDesktopXml(found.allCircuits, circuitId);
      const baseName = sanitizeExportBaseName(found.target.name);
      triggerTextDownload(xmlText, `${baseName}.CircuitProject`, "application/xml;charset=utf-8");
    },
    [findAvailableCircuitSource],
  );

  const exportLibraryDocument = React.useCallback(
    () => {
      const doc = persistenceStateRef.current.document;
      if (!doc) {
        return;
      }
      const jsonText = serializeCircuitLibrary(doc);
      const fileName = persistenceStateRef.current.fileName ?? buildLibraryFileName();
      triggerTextDownload(jsonText, fileName, "application/json;charset=utf-8");
    },
    [],
  );

  const enterLibraryEditMode = React.useCallback(
    async (circuitId: string): Promise<boolean> => {
      const current = persistenceStateRef.current;
      if (!current.document || current.isReadOnly || !circuitContext?.captureProjectSnapshot) {
        setLibraryError(t("library.errors.readOnly"));
        return false;
      }

      const targetCircuit = current.document.logicalCircuits.find(
        (lc) => lc.logicalCircuitId === circuitId,
      );
      if (!targetCircuit) {
        setLibraryError(t("library.errors.circuitNotFound"));
        return false;
      }

      if (simulationContext?.isSimulating) {
        simulationContext.stopSimulation();
      }

      if (editingLibraryCircuitIdRef.current === null) {
        savedProjectSnapshotRef.current = circuitContext.captureProjectSnapshot();
      }

      const libraryProject = buildCircuitProjectFromNativeCircuits(
        buildLibraryEditProjectMeta(current.fileName, targetCircuit),
        [],
        current.document.logicalCircuits,
      );
      updateEditingLibraryCircuitId(circuitId);
      circuitContext.loadProject(libraryProject, {
        handle: null,
        fileName: current.fileName,
        suppressCollabSync: true,
      });
      setLibraryError(null);
      return true;
    },
    [
      circuitContext,
      simulationContext,
      t,
      updateEditingLibraryCircuitId,
    ],
  );

  const saveLibraryEditSession = React.useCallback(
    async (): Promise<boolean> => {
      if (editingLibraryCircuitIdRef.current === null || !circuitContext) {
        return false;
      }
      if (simulationContext?.isSimulating) {
        await simulationContext.flushPersistentMemories();
      }

      const nativeCircuits = circuitContext.project.logicalCircuits.map((lc) =>
        serializeLogicalCircuitToNative(lc, circuitContext.project),
      );
      const ok = await persistUpdatedDocument(nativeCircuits);
      if (ok) {
        circuitContext.markProjectSaved();
      }
      return ok;
    },
    [
      circuitContext,
      persistUpdatedDocument,
      simulationContext,
    ],
  );

  const getSavedSessionProject = React.useCallback(
    (): CircuitProject | null => savedProjectSnapshotRef.current?.project ?? null,
    [],
  );

  const updateSavedSessionProject = React.useCallback(
    (nextProject: CircuitProject) => {
      if (!savedProjectSnapshotRef.current) {
        return;
      }
      const prevSnapshot = savedProjectSnapshotRef.current;
      const stillHasCircuit = nextProject.logicalCircuits.some(
        (lc) => lc.logicalCircuitId === prevSnapshot.currentCircuitId,
      );
      const nextCurrentId = stillHasCircuit
        ? prevSnapshot.currentCircuitId
        : (nextProject.project.logicalCircuitId || nextProject.logicalCircuits[0]?.logicalCircuitId || "");
      savedProjectSnapshotRef.current = {
        ...prevSnapshot,
        project: nextProject,
        currentCircuitId: nextCurrentId,
      };
    },
    [],
  );

  return (
    <LibraryContext.Provider
      value={{
        activeSidebarTab,
        setActiveSidebarTab,
        persistenceState,
        isLoading,
        isResyncWarningDismissed,
        dismissResyncWarning,
        libraryError,
        clearLibraryError,
        builtInItems,
        builtInCircuits,
        userCircuits,
        isWritable,
        get editingLibraryCircuitId() {
          return editingLibraryCircuitIdRef.current;
        },
        get isEditingLibrary() {
          return editingLibraryCircuitIdRef.current !== null;
        },
        openLibraryFile,
        openLibraryFromText,
        createLibraryFile,
        resyncLibrary,
        unlinkLibrary,
        reloadInitialLibrary,
        addProjectCircuitToLibrary,
        duplicateBuiltInToLibrary,
        updateLibraryCircuitMetadata,
        getLibraryDeletionDependents,
        deleteLibraryCircuits,
        importCircuitsIntoLibrary,
        exportLibraryCircuitNative,
        exportLibraryCircuitXml,
        exportLibraryDocument,
        enterLibraryEditMode,
        saveLibraryEditSession,
        exitLibraryEditMode,
        getSavedSessionProject,
        updateSavedSessionProject,
      }}
    >
      {children}
    </LibraryContext.Provider>
  );
};

export default LibraryContextProvider;
