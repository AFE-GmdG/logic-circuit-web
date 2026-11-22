import React from "react";

import type AiHighlightState from "../../types/canvas/aiHighlightState";
import type CursorPosition from "../../types/canvas/cursorPosition";
import type GridPoint from "../../types/canvas/gridPoint";
import type ViewportTransform from "../../types/canvas/viewportTransform";

export type CanvasClipboardActions = {
  copySelection: () => Promise<boolean>;
  copySelectionForDesktop?: () => Promise<boolean>;
  cutSelection: () => Promise<boolean>;
  pasteFromClipboard: () => Promise<void>;
};

type CanvasContextType = {
  viewport: ViewportTransform;
  setViewport: React.Dispatch<React.SetStateAction<ViewportTransform>>;
  cursor: CursorPosition | null;
  setCursor: React.Dispatch<React.SetStateAction<CursorPosition | null>>;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  resetView: () => void;
  selectedCount: number;
  setSelectedCount: React.Dispatch<React.SetStateAction<number>>;
  aiHighlightedIds: AiHighlightState;
  highlightAiElements: (elements: Partial<AiHighlightState>, durationMs?: number) => void;
  hasClipboardContent: boolean;
  setHasClipboardContent: React.Dispatch<React.SetStateAction<boolean>>;
  refreshClipboardAvailability: () => Promise<boolean>;
  registerClipboardActions: (actions: CanvasClipboardActions | null) => void;
  copySelection: () => Promise<boolean>;
  copySelectionForDesktop?: () => Promise<boolean>;
  cutSelection: () => Promise<boolean>;
  pasteFromClipboard: () => Promise<void>;
  registerSelectAllAction?: (action: (() => void) | null) => void;
  selectAll?: () => void;
  registerFocusGridPoint?: (action: ((point: GridPoint, circuitId?: string) => void) | null) => void;
  focusGridPoint?: (point: GridPoint, circuitId?: string) => void;
  registerOpenFindBar?: (action: (() => void) | null) => void;
  openFindBar?: () => void;
};

const CanvasContext = React.createContext<CanvasContextType>(undefined!);

export default CanvasContext;
