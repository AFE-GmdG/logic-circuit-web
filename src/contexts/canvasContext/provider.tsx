import React from "react";

import CanvasContext, { type CanvasClipboardActions } from ".";

import type AiHighlightState from "../../types/canvas/aiHighlightState";
import type CursorPosition from "../../types/canvas/cursorPosition";
import type GridPoint from "../../types/canvas/gridPoint";
import type ViewportTransform from "../../types/canvas/viewportTransform";

import { getInMemoryClipboardText } from "../../utils/clipboardUtils";
import { clampZoom, DEFAULT_ZOOM } from "../../utils/coordinateSystem";

type CanvasContextProviderProps = {
  children: React.ReactNode;
};

const DEFAULT_ORIGIN_OFFSET = 36;
const DEFAULT_AI_HIGHLIGHT_DURATION_MS = 2400;

const CanvasContextProvider: React.FC<CanvasContextProviderProps> = ({ children }) => {
  const [viewport, setViewport] = React.useState<ViewportTransform>({
    panX: DEFAULT_ORIGIN_OFFSET,
    panY: DEFAULT_ORIGIN_OFFSET,
    zoom: DEFAULT_ZOOM,
  });

  const [cursor, setCursor] = React.useState<CursorPosition | null>(null);
  const [selectedCount, setSelectedCount] = React.useState(0);
  const [aiHighlightedIds, setAiHighlightedIds] = React.useState<AiHighlightState>({
    symbolIds: [],
    textNoteIds: [],
    wireIds: [],
  });
  const aiExpirationsRef = React.useRef<{
    symbolIds: Map<string, number>;
    textNoteIds: Map<string, number>;
    wireIds: Map<string, number>;
  }>({
    symbolIds: new Map(),
    textNoteIds: new Map(),
    wireIds: new Map(),
  });
  const aiHighlightTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncAiHighlightState = React.useCallback(
    () => {
      const now = Date.now();
      const { symbolIds, textNoteIds, wireIds } = aiExpirationsRef.current;

      const pruneExpired = (map: Map<string, number>): string[] => {
        for (const [id, expiresAt] of map.entries()) {
          if (expiresAt <= now) {
            map.delete(id);
          }
        }
        return Array.from(map.keys());
      };

      const nextSymbols = pruneExpired(symbolIds);
      const nextNotes = pruneExpired(textNoteIds);
      const nextWires = pruneExpired(wireIds);

      setAiHighlightedIds({
        symbolIds: nextSymbols,
        textNoteIds: nextNotes,
        wireIds: nextWires,
      });

      if (aiHighlightTimerRef.current !== null) {
        clearTimeout(aiHighlightTimerRef.current);
        aiHighlightTimerRef.current = null;
      }

      let earliest = Infinity;
      for (const expiresAt of symbolIds.values()) {
        earliest = Math.min(earliest, expiresAt);
      }
      for (const expiresAt of textNoteIds.values()) {
        earliest = Math.min(earliest, expiresAt);
      }
      for (const expiresAt of wireIds.values()) {
        earliest = Math.min(earliest, expiresAt);
      }

      if (Number.isFinite(earliest)) {
        const delay = Math.max(16, earliest - now);
        aiHighlightTimerRef.current = setTimeout(syncAiHighlightState, delay);
      }
    },
    [],
  );

  const highlightAiElements = React.useCallback(
    (elements: Partial<AiHighlightState>, durationMs = DEFAULT_AI_HIGHLIGHT_DURATION_MS) => {
      const safeDuration = Math.max(100, durationMs);
      const expiresAt = Date.now() + safeDuration;
      const { symbolIds, textNoteIds, wireIds } = aiExpirationsRef.current;

      for (const id of elements.symbolIds ?? []) {
        symbolIds.set(id, expiresAt);
      }
      for (const id of elements.textNoteIds ?? []) {
        textNoteIds.set(id, expiresAt);
      }
      for (const id of elements.wireIds ?? []) {
        wireIds.set(id, expiresAt);
      }

      syncAiHighlightState();
    },
    [syncAiHighlightState],
  );

  React.useEffect(
    () => {
      return () => {
        if (aiHighlightTimerRef.current !== null) {
          clearTimeout(aiHighlightTimerRef.current);
          aiHighlightTimerRef.current = null;
        }
      };
    },
    [],
  );

  const zoomIn = React.useCallback(
    () => {
      setViewport((prev) => ({
        ...prev,
        zoom: clampZoom(prev.zoom * 1.2),
      }));
    },
    [],
  );

  const zoomOut = React.useCallback(
    () => {
      setViewport((prev) => ({
        ...prev,
        zoom: clampZoom(prev.zoom / 1.2),
      }));
    },
    [],
  );

  const resetZoom = React.useCallback(
    () => {
      setViewport((prev) => ({
        ...prev,
        zoom: DEFAULT_ZOOM,
      }));
    },
    [],
  );

  const resetView = React.useCallback(
    () => {
      setViewport({
        panX: DEFAULT_ORIGIN_OFFSET,
        panY: DEFAULT_ORIGIN_OFFSET,
        zoom: DEFAULT_ZOOM,
      });
    },
    [],
  );

  const [hasClipboardContent, setHasClipboardContent] = React.useState<boolean>(
    () => getInMemoryClipboardText().trim().length > 0,
  );

  const clipboardActionsRef = React.useRef<CanvasClipboardActions | null>(null);
  const selectAllActionRef = React.useRef<(() => void) | null>(null);
  const focusGridPointActionRef = React.useRef<((point: GridPoint, circuitId?: string) => void) | null>(null);
  const openFindBarActionRef = React.useRef<(() => void) | null>(null);

  const registerClipboardActions = React.useCallback(
    (actions: CanvasClipboardActions | null) => {
      clipboardActionsRef.current = actions;
    },
    [],
  );

  const registerSelectAllAction = React.useCallback(
    (action: (() => void) | null) => {
      selectAllActionRef.current = action;
    },
    [],
  );

  const registerFocusGridPoint = React.useCallback(
    (action: ((point: GridPoint, circuitId?: string) => void) | null) => {
      focusGridPointActionRef.current = action;
    },
    [],
  );

  const registerOpenFindBar = React.useCallback(
    (action: (() => void) | null) => {
      openFindBarActionRef.current = action;
    },
    [],
  );

  const refreshClipboardAvailability = React.useCallback(
    async (): Promise<boolean> => {
      if (getInMemoryClipboardText().trim().length > 0) {
        setHasClipboardContent(true);
        return true;
      }

      if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.readText === "function") {
        try {
          if (navigator.permissions && typeof navigator.permissions.query === "function") {
            const perm = await navigator.permissions.query({
              name: "clipboard-read" as PermissionName,
            });
            if (perm.state === "granted") {
              const text = await navigator.clipboard.readText();
              const hasText = text.trim().length > 0;
              setHasClipboardContent(hasText);
              return hasText;
            }
            if (perm.state === "denied") {
              setHasClipboardContent(false);
              return false;
            }
          }
        } catch {
          // Fallback: Bei Browsern ohne clipboard-read Permission-Query nicht unnötig sperren
        }
        setHasClipboardContent(true);
        return true;
      }

      setHasClipboardContent(false);
      return false;
    },
    [],
  );

  const copySelection = React.useCallback(
    async (): Promise<boolean> => {
      if (!clipboardActionsRef.current) {
        return false;
      }
      return clipboardActionsRef.current.copySelection();
    },
    [],
  );

  const copySelectionForDesktop = React.useCallback(
    async (): Promise<boolean> => {
      if (!clipboardActionsRef.current?.copySelectionForDesktop) {
        return false;
      }
      return clipboardActionsRef.current.copySelectionForDesktop();
    },
    [],
  );

  const cutSelection = React.useCallback(
    async (): Promise<boolean> => {
      if (!clipboardActionsRef.current) {
        return false;
      }
      return clipboardActionsRef.current.cutSelection();
    },
    [],
  );

  const pasteFromClipboard = React.useCallback(
    async (): Promise<void> => {
      if (!clipboardActionsRef.current) {
        return;
      }
      await clipboardActionsRef.current.pasteFromClipboard();
    },
    [],
  );

  const selectAll = React.useCallback(
    () => {
      selectAllActionRef.current?.();
    },
    [],
  );

  const focusGridPoint = React.useCallback(
    (point: GridPoint, circuitId?: string) => {
      focusGridPointActionRef.current?.(point, circuitId);
    },
    [],
  );

  const openFindBar = React.useCallback(
    () => {
      openFindBarActionRef.current?.();
    },
    [],
  );

  return (
    <CanvasContext.Provider
      value={{
        viewport,
        setViewport,
        cursor,
        setCursor,
        zoomIn,
        zoomOut,
        resetZoom,
        resetView,
        selectedCount,
        setSelectedCount,
        aiHighlightedIds,
        highlightAiElements,
        hasClipboardContent,
        setHasClipboardContent,
        refreshClipboardAvailability,
        registerClipboardActions,
        copySelection,
        copySelectionForDesktop,
        cutSelection,
        pasteFromClipboard,
        registerSelectAllAction,
        selectAll,
        registerFocusGridPoint,
        focusGridPoint,
        registerOpenFindBar,
        openFindBar,
      }}
    >
      {children}
    </CanvasContext.Provider>
  );
};

export default CanvasContextProvider;
