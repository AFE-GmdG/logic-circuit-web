import React from "react";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CanvasContext from "../../contexts/canvasContext";
import CircuitContext from "../../contexts/circuitContext";
import SimulationContext from "../../contexts/simulationContext";
import useCircuitCleanUpAnalysis from "../../hooks/useCircuitCleanUpAnalysis";

import type BoundingBox from "../../types/canvas/boundingBox";
import type CanvasPoint from "../../types/canvas/canvasPoint";
import type FloatingPasteState from "../../types/canvas/floatingPasteState";
import type GridPoint from "../../types/canvas/gridPoint";
import type SelectionBoxType from "../../types/canvas/selectionBox";
import type ViewportTransform from "../../types/canvas/viewportTransform";
import type CircuitButton from "../../types/circuit/circuitButton";
import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type PaletteSelection from "../../types/circuit/paletteSelection";
import type Pin from "../../types/circuit/pin";
import type Rotation from "../../types/circuit/rotation";
import type RotationDirection from "../../types/circuit/rotationDirection";
import type TextNote from "../../types/circuit/textNote";
import type Wire from "../../types/circuit/wire";
import type WireEndpointUpdate from "../../types/circuit/wireEndpointUpdate";
import type FindResult from "../../types/find/findResult";
import type PropertyChange from "../../types/history/propertyChange";
import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../../types/simulation/state";

import {
  getButtonInstanceId,
  getGraphicsArrayInstanceId,
  getMemoryInstanceId,
} from "../../simulation/compiler/circuitMap";
import type CircuitMap from "../../simulation/compiler/circuitMap";
import {
  BUTTON_MAX_GRID_SIZE,
  BUTTON_MIN_GRID_SIZE,
  doBoundingBoxesIntersect,
  getComponentLayout,
  getSymbolGridBoundingBox,
  getTextNoteGridBoundingBox,
  gridPointKey,
  LED_MATRIX_MAX_DIM,
  LED_MATRIX_MIN_DIM,
  RESIZABLE_SYMBOL_MAX_GRID_SIZE,
  RESIZABLE_SYMBOL_MIN_GRID_SIZE,
  TEXT_NOTE_MAX_GRID_SIZE,
  TEXT_NOTE_MIN_GRID_SIZE,
  wouldCreateCircuitCycle,
} from "../../utils/circuitLayout";
import {
  buildClipboardContent,
  buildClipboardXml,
  isCircuitClipboardText,
  prepareClipboardPaste,
  readClipboardText,
  setInMemoryClipboardText,
  writeClipboardText,
} from "../../utils/clipboardUtils";
import {
  calculateZoomAtPoint,
  canvasToGrid,
  DEFAULT_ZOOM,
  GRID_SIZE,
  screenToCanvas,
} from "../../utils/coordinateSystem";
import {
  createFloatingMoveState,
  createFloatingPasteState,
  rotateFloatingState,
  translateFloatingState,
} from "../../utils/floatingPasteUtils";
import {
  isSupportedProjectFile,
  readProjectFileText,
} from "../../utils/storage/projectFileUtils";
import {
  findJamAt,
  findJamNear,
  findWireEndpointNear,
  findWireNear,
  formatJamTooltip,
  formatSignalTooltip,
  formatWireCleanUpTooltip,
  getConductorWiresForWire,
  isPointNearGridPoint,
  validateCircuitWires,
} from "../../utils/wireUtils";

import CanvasContextMenu, { type CanvasContextTarget } from "./canvasContextMenu";
import CanvasGrid from "./canvasGrid";
import CircuitSymbolView, { CLEANUP_DIM_OPACITY } from "./circuitSymbolView";
import FindBar from "./findBar";
import FloatingPasteLayer from "./floatingPasteLayer";
import SelectionBox from "./selectionBox";
import TextNoteModal from "./textNoteModal";
import TextNoteView from "./textNoteView";
import ConfirmDialog from "../app/confirmDialog";
import SubCircuitGlyph from "../componentPalette/subCircuitGlyph";
import MemoryInspectorDialog from "../memoryInspectorDialog";
import PropertyDialog from "../propertyDialog";
import SymbolRenderer from "../symbols/symbolRenderer";

type CircuitCanvasProps = React.ComponentPropsWithoutRef<"main">;

type PanDragState = {
  startX: number;
  startY: number;
  startPanX: number;
  startPanY: number;
};

type EntityDragState = {
  initialSymbolPositions: Map<string, GridPoint>;
  initialNotePositions: Map<string, GridPoint>;
  initialWireSnapshots: Map<string, Wire>;
  selectedWireIdSet: Set<string>;
  movedPointsKeySet: Set<string>;
  startPointerGrid: GridPoint;
  clickedSymbolId?: string;
  clickedNoteId?: string;
  clickedWireId?: string;
  hasMoved: boolean;
};

type WireEndpointDragState = {
  wireId: string;
  endpoint: 1 | 2;
  originalPoint: GridPoint;
  hasJamAtOrigin: boolean;
  initialWireSnapshots: Map<string, Wire>;
  hasMoved: boolean;
};

type NoteResizeState = {
  textNoteId: string;
  initialNote: TextNote;
  initialX: number;
  initialY: number;
  initialWidth: number;
  initialHeight: number;
  startPointerGrid: GridPoint;
  hx: 0 | 1 | 2;
  hy: 0 | 1 | 2;
  rotation: Rotation;
};

type SymbolResizeState = {
  symbolId: string;
  initialSymbol: CircuitSymbol;
  initialPin?: Pin;
  initialWireSnapshots: Map<string, Wire>;
  initialX: number;
  initialY: number;
  initialWidth: number;
  initialHeight: number;
  startPointerGrid: GridPoint;
  hx: 0 | 1 | 2;
  hy: 0 | 1 | 2;
  rotation: Rotation;
  kind?: string;
};

type HoveredPinInfo = {
  point: GridPoint;
  screenX: number;
  screenY: number;
  tooltip: string;
  isError?: boolean;
};

type SimulationClickRef = { symbolId: string; time: number } | null;

// Aktiviert oder schaltet einen Taster/Schalter anhand seines Instanz-Pfads während der Simulation
function activateSimulationButton(
  buttonId: string,
  isToggle: boolean,
  actions: {
    toggleButton: (id: string) => void;
    setButtonState: (id: string, pressed: boolean) => void;
    onPressCaptured?: (id: string) => void;
  },
): void {
  if (isToggle) {
    actions.toggleButton(buttonId);
    return;
  }
  actions.setButtonState(buttonId, true);
  actions.onPressCaptured?.(buttonId);
}

// Verarbeitet Pointer-Down auf einem Symbol (inkl. eingebetteter Display-Buttons & SubCircuit-Doppelklick) während der Simulation
export function dispatchSimulationSymbolPointerDown(params: {
  symbol: CircuitSymbol;
  target: EventTarget | null;
  detail: number;
  shiftOrMeta: boolean;
  now?: number;
  lastSymbolClick: SimulationClickRef;
  activeSimulationMap: CircuitMap | null | undefined;
  toggleButton: (buttonId: string) => void;
  setButtonState: (buttonId: string, pressed: boolean) => void;
  selectCircuitMap: (map: CircuitMap) => void;
  selectSymbol: (symbolId: string, additive: boolean) => void;
  selectEntities: (sIds: string[], nIds: string[], additive: boolean, wIds: string[]) => void;
}): {
  nextLastClick: SimulationClickRef;
  capturedButtonId: string | null;
  handledAction: "displayButton" | "subCircuitOpen" | "button" | "select";
} {
  const {
    symbol,
    target,
    detail,
    shiftOrMeta,
    now = Date.now(),
    lastSymbolClick,
    activeSimulationMap,
    toggleButton,
    setButtonState,
    selectCircuitMap,
    selectSymbol,
    selectEntities,
  } = params;

  const targetEl = target as {
    closest?: (selector: string) => { getAttribute?: (attr: string) => string | null } | null;
  } | null;
  const displayBtnEl = targetEl?.closest?.("[data-display-button-path]") ?? null;
  if (displayBtnEl) {
    let capturedButtonId: string | null = null;
    const buttonPath = displayBtnEl.getAttribute?.("data-display-button-path") ?? null;
    const isToggle = displayBtnEl.getAttribute?.("data-display-button-toggle") === "true";
    if (buttonPath) {
      activateSimulationButton(buttonPath, isToggle, {
        toggleButton,
        setButtonState,
        onPressCaptured: (id) => {
          capturedButtonId = id;
        },
      });
    }
    return {
      nextLastClick: null,
      capturedButtonId,
      handledAction: "displayButton",
    };
  }

  let nextLastClick: SimulationClickRef = lastSymbolClick;
  let capturedButtonId: string | null = null;

  if (symbol.circuit.kind === "circuitButton") {
    const btn = symbol.circuit as CircuitButton;
    const buttonId = getButtonInstanceId(activeSimulationMap, symbol);
    activateSimulationButton(buttonId, Boolean(btn.isToggle), {
      toggleButton,
      setButtonState,
      onPressCaptured: (id) => {
        capturedButtonId = id;
      },
    });
    return {
      nextLastClick: null,
      capturedButtonId,
      handledAction: "button",
    };
  } else if (symbol.circuit.kind === "logicalCircuit") {
    const isSimDouble = detail >= 2 || (
      lastSymbolClick !== null &&
      lastSymbolClick.symbolId === symbol.circuitSymbolId &&
      now - lastSymbolClick.time < 350
    );
    nextLastClick = { symbolId: symbol.circuitSymbolId, time: now };
    if (isSimDouble) {
      const childMap = activeSimulationMap?.child(symbol);
      if (childMap) {
        selectCircuitMap(childMap);
        return {
          nextLastClick: null,
          capturedButtonId: null,
          handledAction: "subCircuitOpen",
        };
      }
    }
  }

  if (shiftOrMeta) {
    selectSymbol(symbol.circuitSymbolId, true);
  } else {
    selectEntities([symbol.circuitSymbolId], [], false, []);
  }

  return {
    nextLastClick,
    capturedButtonId,
    handledAction: "select",
  };
}

// Verarbeitet Doppelklicks auf Symbole während der Simulation unter Ausschluss eingebetteter Display-Buttons
export function dispatchSimulationSymbolDoubleClick(params: {
  symbol: CircuitSymbol;
  target: EventTarget | null;
  activeSimulationMap: CircuitMap | null | undefined;
  selectCircuitMap: (map: CircuitMap) => void;
  onOpenMemoryInspector?: (
    symbol: CircuitSymbol,
    activeSimulationMap: CircuitMap | null | undefined,
  ) => void;
}): boolean {
  const targetEl = params.target as { closest?: (selector: string) => unknown } | null;
  if (targetEl?.closest?.("[data-display-button-path]")) {
    return false;
  }
  if (params.symbol.circuit.kind === "logicalCircuit") {
    const childMap = params.activeSimulationMap?.child(params.symbol);
    if (childMap) {
      params.selectCircuitMap(childMap);
      return true;
    }
  }
  if (
    (params.symbol.circuit.kind === "memory" || params.symbol.circuit.kind === "graphicsArray") &&
    params.onOpenMemoryInspector
  ) {
    params.onOpenMemoryInspector(params.symbol, params.activeSimulationMap);
    return true;
  }
  return false;
}

const CircuitCanvas = styled(({ ...other }: CircuitCanvasProps) => {
  const { t, i18n: i18nInstance } = useTranslation();
  const {
    viewport,
    setViewport,
    setCursor,
    setSelectedCount,
    aiHighlightedIds,
    highlightAiElements,
    hasClipboardContent,
    setHasClipboardContent,
    registerClipboardActions,
    registerSelectAllAction,
    registerFocusGridPoint,
    registerOpenFindBar,
  } = React.useContext(CanvasContext);
  const {
    project,
    currentCircuit,
    setCurrentCircuitId,
    selectedSymbolIds,
    selectedTextNoteIds,
    selectedWireIds,
    selectSymbol,
    selectTextNote,
    selectWire,
    selectConductor,
    selectEntities,
    addSymbol,
    addTextNote,
    addWire,
    splitWire,
    mergeWires,
    updateWiresLive,
    updateTextNote,
    updateCircuitSymbolProperties,
    updateCircuitProperties,
    resizeCircuitSymbol,
    moveSymbols,
    moveTextNotes,
    moveEntities,
    commitFloatingMove,
    removeEntities,
    commitPastePayload,
    rotateSelectedSymbols,
    undo,
    redo,
    recordDelta,
    activePaletteDrag,
    hasUnsavedChanges,
    importProjectFromText,
    isCleanUpVisualizationEnabled = false,
  } = React.useContext(CircuitContext);
  const {
    isSimulating,
    wireStateMap,
    setButtonState,
    toggleButton,
    snapshot,
    circuitMap,
    selectedCircuitMap,
    selectCircuitMap,
    cleanUpReport: simulationCleanUpReport = null,
  } = React.useContext(SimulationContext);
  const activeSimulationMap = selectedCircuitMap ?? circuitMap;
  const editorCleanUpReport = useCircuitCleanUpAnalysis(
    currentCircuit,
    !isSimulating && Boolean(isCleanUpVisualizationEnabled),
    {
      // Im Editiermodus zählen angeschlossene In-/Out-Pins jeder bearbeiteten Schaltung als aktive Schnittstellen-Ports
      treatRootPinsAsBoundary: true,
    },
  );
  const activeCleanUpReport = isSimulating
    ? simulationCleanUpReport
    : isCleanUpVisualizationEnabled
      ? editorCleanUpReport
      : null;
  const scopedCleanUpReport =
    activeCleanUpReport?.circuitId === currentCircuit.logicalCircuitId ? activeCleanUpReport : null;
  const activePressedButtonIdRef = React.useRef<string | null>(null);

  const containerRef = React.useRef<SVGSVGElement | null>(null);
  const panDragRef = React.useRef<PanDragState | null>(null);
  const entityDragRef = React.useRef<EntityDragState | null>(null);
  const wireEndpointDragRef = React.useRef<WireEndpointDragState | null>(null);
  const noteResizeRef = React.useRef<NoteResizeState | null>(null);
  const symbolResizeRef = React.useRef<SymbolResizeState | null>(null);
  const initialSelectedSymbolIdsRef = React.useRef<string[]>([]);
  const initialSelectedNoteIdsRef = React.useRef<string[]>([]);
  const initialSelectedWireIdsRef = React.useRef<string[]>([]);
  const lastNoteClickRef = React.useRef<{ noteId: string; time: number } | null>(null);
  const lastSymbolClickRef = React.useRef<{ symbolId: string; time: number } | null>(null);

  const circuitViewportsRef = React.useRef<Map<string, typeof viewport>>(new Map());
  const activeCircuitIdRef = React.useRef<string>(currentCircuit.logicalCircuitId);
  const latestViewportRef = React.useRef(viewport);
  latestViewportRef.current = viewport;
  const pendingFocusRef = React.useRef<{ circuitId: string; point: GridPoint } | null>(null);
  const [contextTarget, setContextTarget] = React.useState<CanvasContextTarget | null>(null);

  const computeCenteredViewport = React.useCallback(
    (point: GridPoint, zoom: number): ViewportTransform => {
      const container = containerRef.current;
      const rect = container?.getBoundingClientRect();
      const width = rect && rect.width > 0 ? rect.width : 800;
      const height = rect && rect.height > 0 ? rect.height : 600;
      return {
        zoom,
        panX: width / 2 - point.x * GRID_SIZE * zoom,
        panY: height / 2 - point.y * GRID_SIZE * zoom,
      };
    },
    [],
  );

  // Speichert und restauriert Zoom und Pan pro Schaltung bei Schaltungswechsel
  React.useEffect(
    () => {
      if (activeCircuitIdRef.current !== currentCircuit.logicalCircuitId) {
        circuitViewportsRef.current.set(activeCircuitIdRef.current, latestViewportRef.current);
        const savedViewport = circuitViewportsRef.current.get(currentCircuit.logicalCircuitId);
        if (pendingFocusRef.current && pendingFocusRef.current.circuitId === currentCircuit.logicalCircuitId) {
          const targetPoint = pendingFocusRef.current.point;
          pendingFocusRef.current = null;
          setViewport(computeCenteredViewport(targetPoint, latestViewportRef.current.zoom));
        } else if (savedViewport) {
          setViewport(savedViewport);
        } else {
          setViewport({
            panX: 36,
            panY: 36,
            zoom: DEFAULT_ZOOM,
          });
        }
        activeCircuitIdRef.current = currentCircuit.logicalCircuitId;

        setIsPanning(false);
        setIsSelecting(false);
        setIsSelectingShift(false);
        setIsMovingEntity(false);
        setIsDraggingWireEndpoint(false);
        setWirePledge(null);
        setHoveredPinInfo(null);
        setIsResizingNote(false);
        setIsResizingSymbol(false);
        setSelectionBox(null);
        setCandidateSymbolIds([]);
        setCandidateNoteIds([]);
        setCandidateWireIds([]);
        panDragRef.current = null;
        entityDragRef.current = null;
        wireEndpointDragRef.current = null;
        noteResizeRef.current = null;
        symbolResizeRef.current = null;
        floatingDragRef.current = null;
        setFloatingPaste(null);
        setClipboardNotice(null);
        setContextTarget(null);
      }
    },
    [
      computeCenteredViewport,
      currentCircuit.logicalCircuitId,
      setViewport,
    ],
  );

  const [isSpacePressed, setIsSpacePressed] = React.useState(false);
  const [isPanning, setIsPanning] = React.useState(false);
  const [isSelecting, setIsSelecting] = React.useState(false);
  const [isSelectingShift, setIsSelectingShift] = React.useState(false);
  const [isMovingEntity, setIsMovingEntity] = React.useState(false);
  const [isDraggingWireEndpoint, setIsDraggingWireEndpoint] = React.useState(false);
  const [wirePledge, setWirePledge] = React.useState<{
    startGrid: GridPoint;
    currentGrid: GridPoint;
  } | null>(null);
  const [hoveredPinInfo, setHoveredPinInfo] = React.useState<HoveredPinInfo | null>(null);
  const [isResizingNote, setIsResizingNote] = React.useState(false);
  const [isResizingSymbol, setIsResizingSymbol] = React.useState(false);

  const [candidateSymbolIds, setCandidateSymbolIds] = React.useState<string[]>([]);
  const [candidateNoteIds, setCandidateNoteIds] = React.useState<string[]>([]);
  const [candidateWireIds, setCandidateWireIds] = React.useState<string[]>([]);
  const [selectionBox, setSelectionBox] = React.useState<SelectionBoxType | null>(null);
  const [dragGhost, setDragGhost] = React.useState<{ selection: PaletteSelection; grid: GridPoint } | null>(null);
  const [fileDropError, setFileDropError] = React.useState<string | null>(null);
  const [pendingDroppedFile, setPendingDroppedFile] = React.useState<File | null>(null);
  const [floatingPaste, setFloatingPaste] = React.useState<FloatingPasteState | null>(null);
  const [clipboardNotice, setClipboardNotice] = React.useState<{
    message: string;
    plainText?: string;
  } | null>(null);
  const floatingPasteRef = React.useRef<FloatingPasteState | null>(null);
  floatingPasteRef.current = floatingPaste;
  const floatingDragRef = React.useRef<{
    initialState: FloatingPasteState;
    startPointerGrid: GridPoint;
    hasMoved: boolean;
  } | null>(null);
  const [editingTextNote, setEditingTextNote] = React.useState<TextNote | null>(null);
  const [editingSymbol, setEditingSymbol] = React.useState<CircuitSymbol | null>(null);
  const [editingCircuit, setEditingCircuit] = React.useState<LogicalCircuit | null>(null);
  const [inspectingMemory, setInspectingMemory] = React.useState<{
    symbol: CircuitSymbol;
    memoryInstanceId: string;
    circuitPath: string;
  } | null>(null);
  const [isFindBarOpen, setIsFindBarOpen] = React.useState(false);
  const [findBarFocusSignal, setFindBarFocusSignal] = React.useState(0);

  // Berechnet Bitbreiten-Validierung und rote Fehler-Indikatorkreise für die aktive Schaltung
  const wireValidation = React.useMemo(
    () =>
      validateCircuitWires(
        currentCircuit.circuitSymbols,
        currentCircuit.wires,
        currentCircuit.conductorMap,
      ),
    [
      currentCircuit.circuitSymbols,
      currentCircuit.conductorMap,
      currentCircuit.wires,
      i18nInstance.language,
    ],
  );

  const handleOpenTextNoteEditor = React.useCallback(
    (textNote: TextNote) => {
      if (isSimulating) {
        return;
      }
      setEditingTextNote(textNote);
    },
    [isSimulating],
  );

  const handleOpenSymbolProperties = React.useCallback(
    (symbol: CircuitSymbol) => {
      if (isSimulating) {
        return;
      }
      setEditingSymbol(symbol);
    },
    [isSimulating],
  );

  const handleOpenCircuitProperties = React.useCallback(
    (circuitToEdit?: LogicalCircuit) => {
      if (isSimulating) {
        return;
      }
      setEditingCircuit(circuitToEdit ?? currentCircuit);
    },
    [currentCircuit, isSimulating],
  );

  const handleOpenMemoryInspector = React.useCallback(
    (symbol: CircuitSymbol, simMap: CircuitMap | null | undefined) => {
      const kind = symbol.circuit.kind;
      if (!isSimulating || (kind !== "memory" && kind !== "graphicsArray")) {
        return;
      }
      setInspectingMemory({
        symbol,
        memoryInstanceId:
          kind === "graphicsArray"
            ? getGraphicsArrayInstanceId(simMap, symbol)
            : getMemoryInstanceId(simMap, symbol),
        circuitPath: simMap ? simMap.path(symbol) : symbol.circuit.name,
      });
    },
    [isSimulating],
  );

  React.useEffect(
    () => {
      if (isSimulating) {
        setEditingSymbol(null);
        setEditingTextNote(null);
        setEditingCircuit(null);
        setContextTarget(null);
        setPendingDroppedFile(null);
        setIsFindBarOpen(false);
        floatingDragRef.current = null;
        setFloatingPaste(null);
      } else {
        setInspectingMemory(null);
      }
    },
    [isSimulating],
  );

  const getVisibleViewportBoundsGrid = React.useCallback(
    (): BoundingBox | null => {
      const container = containerRef.current;
      if (!container) {
        return null;
      }
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return null;
      }
      const topLeftCanvas = screenToCanvas({ x: 0, y: 0 }, viewport);
      const bottomRightCanvas = screenToCanvas({ x: rect.width, y: rect.height }, viewport);
      const minGrid = canvasToGrid(topLeftCanvas);
      const maxGrid = canvasToGrid(bottomRightCanvas);
      return {
        minX: Math.min(minGrid.x, maxGrid.x),
        minY: Math.min(minGrid.y, maxGrid.y),
        maxX: Math.max(minGrid.x, maxGrid.x),
        maxY: Math.max(minGrid.y, maxGrid.y),
      };
    },
    [viewport],
  );

  const getViewportCenterGrid = React.useCallback(
    (): GridPoint => {
      const bounds = getVisibleViewportBoundsGrid();
      if (!bounds) {
        return { x: 8, y: 8 };
      }
      return {
        x: Math.round((bounds.minX + bounds.maxX) / 2),
        y: Math.round((bounds.minY + bounds.maxY) / 2),
      };
    },
    [getVisibleViewportBoundsGrid],
  );

  const commitFloatingPaste = React.useCallback(
    (): boolean => {
      const currentFloating = floatingPasteRef.current;
      if (!currentFloating) {
        return false;
      }
      floatingDragRef.current = null;
      setFloatingPaste(null);
      if (currentFloating.mode === "move" && currentFloating.moveMeta) {
        if (commitFloatingMove) {
          commitFloatingMove(currentFloating);
        } else {
          const { symbolIds, textNoteIds, wireIds, dx, dy, withWires } = currentFloating.moveMeta;
          if (dx !== 0 || dy !== 0) {
            moveEntities({
              dx,
              dy,
              symbolIds,
              textNoteIds,
              wireIds,
              withWires,
            });
          }
        }
        return true;
      }
      commitPastePayload(currentFloating.payload);
      return true;
    },
    [
      commitFloatingMove,
      commitPastePayload,
      moveEntities,
    ],
  );

  const cancelFloatingPaste = React.useCallback(
    () => {
      floatingDragRef.current = null;
      setFloatingPaste(null);
    },
    [],
  );

  const moveFloatingPaste = React.useCallback(
    (dx: number, dy: number, options?: { withWires?: boolean }) => {
      setFloatingPaste((prev) => {
        if (!prev) {
          return null;
        }
        return translateFloatingState(prev, dx, dy, currentCircuit, options);
      });
    },
    [currentCircuit],
  );

  const rotateFloatingPaste = React.useCallback(
    (direction: RotationDirection, options?: { withWires?: boolean }) => {
      setFloatingPaste((prev) => {
        if (!prev) {
          return prev;
        }
        return rotateFloatingState(prev, direction, currentCircuit, options);
      });
    },
    [currentCircuit],
  );

  const performCopySelectionToClipboard = React.useCallback(
    async (format: "native" | "desktopXml"): Promise<boolean> => {
      if (isSimulating) {
        return false;
      }
      const hasSelection =
        selectedSymbolIds.length > 0 ||
        selectedTextNoteIds.length > 0 ||
        selectedWireIds.length > 0;
      if (!hasSelection) {
        return false;
      }

      const content = format === "desktopXml"
        ? buildClipboardXml(
          project,
          currentCircuit,
          selectedSymbolIds,
          selectedWireIds,
          selectedTextNoteIds,
        )
        : buildClipboardContent(
          project,
          currentCircuit,
          selectedSymbolIds,
          selectedWireIds,
          selectedTextNoteIds,
        );
      await writeClipboardText(content);
      setHasClipboardContent(true);
      setClipboardNotice(
        format === "desktopXml"
          ? { message: t("canvas.clipboard.copiedDesktopXml") }
          : null,
      );
      return true;
    },
    [
      currentCircuit,
      isSimulating,
      project,
      selectedSymbolIds,
      selectedTextNoteIds,
      selectedWireIds,
      setHasClipboardContent,
      t,
    ],
  );

  const copySelectionToClipboard = React.useCallback(
    () => performCopySelectionToClipboard("native"),
    [performCopySelectionToClipboard],
  );

  const copySelectionForDesktopToClipboard = React.useCallback(
    () => performCopySelectionToClipboard("desktopXml"),
    [performCopySelectionToClipboard],
  );

  const cutSelectionToClipboard = React.useCallback(
    async (): Promise<boolean> => {
      const copied = await copySelectionToClipboard();
      if (!copied) {
        return false;
      }
      if (floatingPasteRef.current?.mode === "move") {
        cancelFloatingPaste();
      }
      removeEntities(selectedSymbolIds, selectedTextNoteIds, selectedWireIds);
      return true;
    },
    [
      cancelFloatingPaste,
      copySelectionToClipboard,
      removeEntities,
      selectedSymbolIds,
      selectedTextNoteIds,
      selectedWireIds,
    ],
  );

  const startFloatingPasteFromText = React.useCallback(
    (rawText: string, anchorGridPoint?: GridPoint | null) => {
      if (isSimulating) {
        return;
      }

      const trimmed = rawText.trim();
      if (!trimmed) {
        setHasClipboardContent(false);
        setClipboardNotice({ message: t("canvas.clipboard.empty") });
        return;
      }

      if (!isCircuitClipboardText(rawText)) {
        setClipboardNotice({
          message: t("canvas.clipboard.notCircuit"),
          plainText: rawText,
        });
        return;
      }

      if (floatingPasteRef.current) {
        commitFloatingPaste();
      }

      try {
        const prepared = prepareClipboardPaste(
          rawText,
          project,
          currentCircuit.logicalCircuitId,
        );
        const floatingState = createFloatingPasteState(
          prepared,
          currentCircuit,
          getVisibleViewportBoundsGrid(),
          anchorGridPoint,
        );
        setClipboardNotice(null);
        setWirePledge(null);
        setContextTarget(null);
        selectEntities([], [], false, []);
        setHasClipboardContent(true);
        setFloatingPaste(floatingState);
      } catch (err) {
        setClipboardNotice({
          message:
            err instanceof Error
              ? err.message
              : t("canvas.clipboard.pasteFailed"),
        });
      }
    },
    [
      commitFloatingPaste,
      currentCircuit,
      getVisibleViewportBoundsGrid,
      isSimulating,
      project,
      selectEntities,
      setHasClipboardContent,
      t,
    ],
  );

  const pasteFromClipboard = React.useCallback(
    async (anchorGridPoint?: GridPoint | null) => {
      if (isSimulating) {
        return;
      }
      const text = await readClipboardText();
      startFloatingPasteFromText(text, anchorGridPoint);
    },
    [isSimulating, startFloatingPasteFromText],
  );

  const selectAllElements = React.useCallback(
    () => {
      setContextTarget(null);
      if (!isSimulating && floatingPasteRef.current) {
        commitFloatingPaste();
      }
      selectEntities(
        currentCircuit.circuitSymbols.map((s) => s.circuitSymbolId),
        currentCircuit.textNotes.map((n) => n.textNoteId),
        false,
        currentCircuit.wires.map((w) => w.wireId),
      );
    },
    [
      commitFloatingPaste,
      currentCircuit.circuitSymbols,
      currentCircuit.textNotes,
      currentCircuit.wires,
      isSimulating,
      selectEntities,
    ],
  );

  const focusGridPoint = React.useCallback(
    (point: GridPoint, circuitId?: string) => {
      if (circuitId && circuitId !== activeCircuitIdRef.current) {
        pendingFocusRef.current = { circuitId, point };
        return;
      }
      pendingFocusRef.current = null;
      setViewport(computeCenteredViewport(point, latestViewportRef.current.zoom));
    },
    [computeCenteredViewport, setViewport],
  );

  const handleInsertPlainTextAsNote = React.useCallback(
    () => {
      if (isSimulating || !clipboardNotice?.plainText) {
        return;
      }
      const noteText = clipboardNotice.plainText.trim();
      setClipboardNotice(null);
      if (!noteText) {
        return;
      }
      if (floatingPasteRef.current) {
        commitFloatingPaste();
      }
      const created = addTextNote(noteText, getViewportCenterGrid());
      selectEntities([], [created.textNoteId], false, []);
    },
    [
      addTextNote,
      clipboardNotice,
      commitFloatingPaste,
      getViewportCenterGrid,
      isSimulating,
      selectEntities,
    ],
  );

  React.useEffect(
    () => {
      registerClipboardActions({
        copySelection: copySelectionToClipboard,
        copySelectionForDesktop: copySelectionForDesktopToClipboard,
        cutSelection: cutSelectionToClipboard,
        pasteFromClipboard: () => pasteFromClipboard(),
      });
      return () => registerClipboardActions(null);
    },
    [
      copySelectionForDesktopToClipboard,
      copySelectionToClipboard,
      cutSelectionToClipboard,
      pasteFromClipboard,
      registerClipboardActions,
    ],
  );

  React.useEffect(
    () => {
      registerSelectAllAction?.(selectAllElements);
      return () => {
        registerSelectAllAction?.(null);
      };
    },
    [registerSelectAllAction, selectAllElements],
  );

  React.useEffect(
    () => {
      registerFocusGridPoint?.(focusGridPoint);
      return () => {
        registerFocusGridPoint?.(null);
      };
    },
    [focusGridPoint, registerFocusGridPoint],
  );

  const handleOpenFindBar = React.useCallback(
    () => {
      if (isSimulating) {
        return;
      }
      setContextTarget(null);
      setIsFindBarOpen(true);
      setFindBarFocusSignal((prev) => prev + 1);
    },
    [isSimulating],
  );

  const handleNavigateToFindResult = React.useCallback(
    (result: FindResult) => {
      if (isSimulating) {
        return;
      }
      if (floatingPasteRef.current) {
        commitFloatingPaste();
      }
      setContextTarget(null);

      const targetCircuitId = result.circuitId;
      const switchingCircuit = targetCircuitId !== activeCircuitIdRef.current;

      if (switchingCircuit) {
        setCurrentCircuitId(targetCircuitId);
      }

      if (result.entityType === "circuit") {
        if (!switchingCircuit) {
          selectEntities([], [], false, []);
        }
        return;
      }

      if (result.entityType === "symbol" && result.symbolId) {
        selectEntities([result.symbolId], [], false, []);
        highlightAiElements({ symbolIds: [result.symbolId] });
      } else if (result.entityType === "textNote" && result.textNoteId) {
        selectEntities([], [result.textNoteId], false, []);
        highlightAiElements({ textNoteIds: [result.textNoteId] });
      }

      const targetPoint = result.focusPoint ?? result.gridPoint;
      if (targetPoint) {
        focusGridPoint(targetPoint, targetCircuitId);
      }
    },
    [
      commitFloatingPaste,
      focusGridPoint,
      highlightAiElements,
      isSimulating,
      selectEntities,
      setCurrentCircuitId,
    ],
  );

  React.useEffect(
    () => {
      registerOpenFindBar?.(handleOpenFindBar);
      return () => {
        registerOpenFindBar?.(null);
      };
    },
    [handleOpenFindBar, registerOpenFindBar],
  );

  // Globales Tastenkürzel Strg+F zum Öffnen oder Refokussieren der Such-Leiste (im Editiermodus)
  React.useEffect(
    () => {
      const handleGlobalFindKeyDown = (event: KeyboardEvent) => {
        if (isSimulating) {
          return;
        }
        if (editingTextNote !== null || editingSymbol !== null || editingCircuit !== null) {
          return;
        }
        if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
          return;
        }
        if (event.code !== "KeyF" && event.key.toLowerCase() !== "f") {
          return;
        }

        const targetEl = event.target as HTMLElement | null;
        if (
          targetEl?.closest?.(
            "[role=\"dialog\"], [role=\"alertdialog\"], [data-component$=\"Modal\"], [data-component=\"PropertyDialog\"]",
          )
        ) {
          return;
        }

        const activeTag = targetEl?.tagName?.toLowerCase();
        const isInsideFindBar = Boolean(targetEl?.closest?.("[data-component=\"FindBar\"]"));
        const isOtherEditableField =
          !isInsideFindBar &&
          Boolean(
            activeTag === "input" ||
              activeTag === "textarea" ||
              activeTag === "select" ||
              targetEl?.isContentEditable,
          );
        if (isOtherEditableField) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        handleOpenFindBar();
      };

      window.addEventListener("keydown", handleGlobalFindKeyDown, { capture: true });
      return () => {
        window.removeEventListener("keydown", handleGlobalFindKeyDown, { capture: true });
      };
    },
    [
      editingCircuit,
      editingSymbol,
      editingTextNote,
      handleOpenFindBar,
      isSimulating,
    ],
  );

  React.useEffect(
    () => {
      const isTargetInteractiveInput = (target: EventTarget | null): boolean => {
        const targetEl = target as HTMLElement | null;
        const activeTag = targetEl?.tagName?.toLowerCase();
        return Boolean(
          activeTag === "input" ||
            activeTag === "textarea" ||
            activeTag === "select" ||
            targetEl?.isContentEditable ||
            targetEl?.hasAttribute?.("data-clipboard-helper") ||
            targetEl?.closest?.(
              "[role=\"dialog\"], [data-component$=\"Modal\"], [data-component=\"PropertyDialog\"], [data-component=\"FindBar\"]",
            ),
        );
      };

      const isCanvasClipboardDisabled = (): boolean =>
        isSimulating || editingTextNote !== null || editingSymbol !== null || editingCircuit !== null;

      const handleWindowCopyOrCut = (event: ClipboardEvent, isCut: boolean) => {
        if (isCanvasClipboardDisabled() || isTargetInteractiveInput(event.target)) {
          return;
        }
        if (window.getSelection()?.toString()) {
          return;
        }
        const hasSelection =
          selectedSymbolIds.length > 0 ||
          selectedTextNoteIds.length > 0 ||
          selectedWireIds.length > 0;
        if (!hasSelection || !event.clipboardData) {
          return;
        }

        const clipboardText = buildClipboardContent(
          project,
          currentCircuit,
          selectedSymbolIds,
          selectedWireIds,
          selectedTextNoteIds,
        );
        event.preventDefault();
        event.clipboardData.setData("text/plain", clipboardText);
        setInMemoryClipboardText(clipboardText);
        setHasClipboardContent(true);
        setClipboardNotice(null);
        if (isCut) {
          removeEntities(selectedSymbolIds, selectedTextNoteIds, selectedWireIds);
        }
      };

      const handleWindowCopy = (event: ClipboardEvent) => handleWindowCopyOrCut(event, false);
      const handleWindowCut = (event: ClipboardEvent) => handleWindowCopyOrCut(event, true);

      const handleWindowPaste = (event: ClipboardEvent) => {
        if (isCanvasClipboardDisabled() || isTargetInteractiveInput(event.target)) {
          return;
        }

        const pastedText = event.clipboardData?.getData("text/plain") ?? "";
        if (pastedText) {
          event.preventDefault();
          startFloatingPasteFromText(pastedText);
        } else {
          void pasteFromClipboard();
        }
      };

      window.addEventListener("copy", handleWindowCopy);
      window.addEventListener("cut", handleWindowCut);
      window.addEventListener("paste", handleWindowPaste);
      return () => {
        window.removeEventListener("copy", handleWindowCopy);
        window.removeEventListener("cut", handleWindowCut);
        window.removeEventListener("paste", handleWindowPaste);
      };
    },
    [
      currentCircuit,
      editingCircuit,
      editingSymbol,
      editingTextNote,
      isSimulating,
      pasteFromClipboard,
      project,
      removeEntities,
      selectedSymbolIds,
      selectedTextNoteIds,
      selectedWireIds,
      setHasClipboardContent,
      startFloatingPasteFromText,
    ],
  );

  // Synchronisiert die Anzahl ausgewählter Elemente mit der Statusleiste (inkl. Live-Vorschau beim Aufziehen des Rahmens)
  React.useEffect(
    () => {
      if (isSelecting) {
        if (isSelectingShift) {
          const combinedSymbols = new Set([...initialSelectedSymbolIdsRef.current, ...candidateSymbolIds]);
          const combinedNotes = new Set([...initialSelectedNoteIdsRef.current, ...candidateNoteIds]);
          const combinedWires = new Set([...initialSelectedWireIdsRef.current, ...candidateWireIds]);
          setSelectedCount(combinedSymbols.size + combinedNotes.size + combinedWires.size);
        } else {
          setSelectedCount(candidateSymbolIds.length + candidateNoteIds.length + candidateWireIds.length);
        }
      } else {
        setSelectedCount(selectedSymbolIds.length + selectedTextNoteIds.length + selectedWireIds.length);
      }
    },
    [
      candidateNoteIds,
      candidateSymbolIds,
      candidateWireIds,
      isSelecting,
      isSelectingShift,
      selectedSymbolIds.length,
      selectedTextNoteIds.length,
      selectedWireIds.length,
      setSelectedCount,
    ],
  );

  // Tastatur-Listener für Leertaste (Pan), Entf/Backspace (Löschen), R/Shift+R/L (Rotation), Undo/Redo und Enter/F2
  React.useEffect(
    () => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (
          editingTextNote !== null ||
          editingSymbol !== null ||
          editingCircuit !== null
        ) {
          return;
        }

        const activeTag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
        if (activeTag === "input" || activeTag === "textarea" || activeTag === "select") {
          return;
        }

        if ((event.target as HTMLElement | null)?.closest?.(
          // eslint-disable-next-line max-len
          "[role=\"dialog\"], [role=\"alertdialog\"], [role=\"menu\"], [data-component$=\"Modal\"], [data-component=\"PropertyDialog\"], [data-component=\"FindBar\"]",
        )) {
          return;
        }

        if (event.code === "Escape") {
          if (isFindBarOpen) {
            event.preventDefault();
            setIsFindBarOpen(false);
            return;
          }
          if (contextTarget !== null) {
            event.preventDefault();
            setContextTarget(null);
            return;
          }
          if (floatingPasteRef.current !== null) {
            event.preventDefault();
            cancelFloatingPaste();
            return;
          }
          if (clipboardNotice !== null) {
            event.preventDefault();
            setClipboardNotice(null);
            return;
          }
          if (wirePledge !== null) {
            setWirePledge(null);
            return;
          }
        }

        if (event.code === "Space" && !event.repeat) {
          event.preventDefault();
          setIsSpacePressed(true);
        }

        // Strg+A ist auch im Simulationsmodus erlaubt (z. B. um Elemente für MCP zu markieren)
        if (event.ctrlKey || event.metaKey) {
          const keyLower = event.key.toLowerCase();
          if ((event.code === "KeyA" || keyLower === "a") && !event.altKey) {
            event.preventDefault();
            selectAllElements();
            return;
          }
        }

        // Undo (Strg+Z), Redo (Strg+Y / Strg+Umschalt+Z) sowie Strg+C / Strg+X
        if ((event.ctrlKey || event.metaKey) && !isSimulating) {
          const keyLower = event.key.toLowerCase();
          if ((event.code === "KeyC" || keyLower === "c") && !event.altKey) {
            const hasSelection =
              selectedSymbolIds.length > 0 ||
              selectedTextNoteIds.length > 0 ||
              selectedWireIds.length > 0;
            if (hasSelection) {
              event.preventDefault();
              void copySelectionToClipboard();
            }
            return;
          }
          if ((event.code === "KeyX" || keyLower === "x") && !event.altKey) {
            const hasSelection =
              selectedSymbolIds.length > 0 ||
              selectedTextNoteIds.length > 0 ||
              selectedWireIds.length > 0;
            if (hasSelection) {
              event.preventDefault();
              void cutSelectionToClipboard();
            }
            return;
          }
          if ((event.code === "KeyZ" || keyLower === "z") && !event.shiftKey) {
            event.preventDefault();
            if (floatingPasteRef.current !== null) {
              cancelFloatingPaste();
              return;
            }
            undo();
            return;
          }
          if (
            event.code === "KeyY" ||
            keyLower === "y" ||
            ((event.code === "KeyZ" || keyLower === "z") && event.shiftKey)
          ) {
            event.preventDefault();
            redo();
            return;
          }
        }

        // Während der Simulation sind destruktive oder modifizierende Aktionen auf der Schaltung gesperrt
        if (isSimulating) {
          return;
        }

        // Tastatursteuerung für schwebendes Paste-/Verschiebe-Overlay (Verschieben, Drehen, Bestätigen, Verwerfen)
        if (floatingPasteRef.current !== null && !event.ctrlKey && !event.metaKey) {
          if (event.code === "Delete" || event.code === "Backspace") {
            event.preventDefault();
            cancelFloatingPaste();
            return;
          }
          if (event.code === "Enter") {
            event.preventDefault();
            commitFloatingPaste();
            return;
          }
          if (event.code === "ArrowLeft") {
            event.preventDefault();
            moveFloatingPaste(-1, 0, { withWires: !event.shiftKey });
            return;
          }
          if (event.code === "ArrowRight") {
            event.preventDefault();
            moveFloatingPaste(1, 0, { withWires: !event.shiftKey });
            return;
          }
          if (event.code === "ArrowUp") {
            event.preventDefault();
            moveFloatingPaste(0, -1, { withWires: !event.shiftKey });
            return;
          }
          if (event.code === "ArrowDown") {
            event.preventDefault();
            moveFloatingPaste(0, 1, { withWires: !event.shiftKey });
            return;
          }
          if (event.code === "KeyR" || event.key.toLowerCase() === "r") {
            event.preventDefault();
            rotateFloatingPaste(event.shiftKey ? "counterClockwise" : "clockwise");
            return;
          }
          if (event.code === "KeyL" || event.key.toLowerCase() === "l") {
            event.preventDefault();
            rotateFloatingPaste("counterClockwise", { withWires: !event.shiftKey });
            return;
          }
        }

        // Erste Pfeiltaste aktiviert den Schwebemodus, um vorzeitige Leitungsverknüpfungen zu vermeiden (1 Undo bei Ablegen)
        if (
          floatingPasteRef.current === null &&
          contextTarget === null &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          (event.code === "ArrowLeft" ||
            event.code === "ArrowRight" ||
            event.code === "ArrowUp" ||
            event.code === "ArrowDown")
        ) {
          const hasSelection =
            selectedSymbolIds.length > 0 ||
            selectedTextNoteIds.length > 0 ||
            selectedWireIds.length > 0;
          if (hasSelection) {
            event.preventDefault();
            const dx = event.code === "ArrowLeft" ? -1 : event.code === "ArrowRight" ? 1 : 0;
            const dy = event.code === "ArrowUp" ? -1 : event.code === "ArrowDown" ? 1 : 0;
            const nextFloating = createFloatingMoveState(currentCircuit, {
              symbolIds: selectedSymbolIds,
              textNoteIds: selectedTextNoteIds,
              wireIds: selectedWireIds,
              dx,
              dy,
              withWires: !event.shiftKey,
            });
            if (nextFloating) {
              setClipboardNotice(null);
              setWirePledge(null);
              setFloatingPaste(nextFloating);
            }
            return;
          }
        }

        if (event.code === "Delete" || event.code === "Backspace") {
          const hasSymbols = selectedSymbolIds.length > 0;
          const hasNotes = selectedTextNoteIds.length > 0;
          const hasWires = selectedWireIds.length > 0;
          if (hasSymbols || hasNotes || hasWires) {
            event.preventDefault();
            removeEntities(selectedSymbolIds, selectedTextNoteIds, selectedWireIds);
          }
        }

        // Erstes R / Shift+R / L aktiviert den Schwebemodus, damit Leitungsverknüpfungen erst beim Ablegen entstehen
        if ((event.code === "KeyR" || event.key.toLowerCase() === "r") && !event.ctrlKey && !event.metaKey) {
          const hasSelection =
            selectedSymbolIds.length > 0 ||
            selectedTextNoteIds.length > 0 ||
            selectedWireIds.length > 0;
          if (hasSelection) {
            event.preventDefault();
            const direction: RotationDirection = event.shiftKey ? "counterClockwise" : "clockwise";
            const nextFloating = createFloatingMoveState(currentCircuit, {
              symbolIds: selectedSymbolIds,
              textNoteIds: selectedTextNoteIds,
              wireIds: selectedWireIds,
              dx: 0,
              dy: 0,
              withWires: true,
              initialRotation: direction,
            });
            if (nextFloating) {
              setClipboardNotice(null);
              setWirePledge(null);
              setFloatingPaste(nextFloating);
            }
            return;
          }
        }

        if ((event.code === "KeyL" || event.key.toLowerCase() === "l") && !event.ctrlKey && !event.metaKey) {
          const hasSelection =
            selectedSymbolIds.length > 0 ||
            selectedTextNoteIds.length > 0 ||
            selectedWireIds.length > 0;
          if (hasSelection) {
            event.preventDefault();
            const nextFloating = createFloatingMoveState(currentCircuit, {
              symbolIds: selectedSymbolIds,
              textNoteIds: selectedTextNoteIds,
              wireIds: selectedWireIds,
              dx: 0,
              dy: 0,
              withWires: !event.shiftKey,
              initialRotation: "counterClockwise",
            });
            if (nextFloating) {
              setClipboardNotice(null);
              setWirePledge(null);
              setFloatingPaste(nextFloating);
            }
            return;
          }
        }

        // Enter oder F2 öffnet den Notiz-Editor für die aktuell selektierte Text-Notiz bzw. den Eigenschaftendialog
        if (
          (event.code === "Enter" || event.code === "F2") &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          if (selectedTextNoteIds.length === 1 && selectedSymbolIds.length === 0) {
            const noteToEdit = currentCircuit.textNotes.find((n) => n.textNoteId === selectedTextNoteIds[0]);
            if (noteToEdit) {
              event.preventDefault();
              handleOpenTextNoteEditor(noteToEdit);
              return;
            }
          }

          if (selectedSymbolIds.length === 1 && selectedTextNoteIds.length === 0) {
            const symToEdit = currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === selectedSymbolIds[0]);
            if (symToEdit) {
              event.preventDefault();
              handleOpenSymbolProperties(symToEdit);
              return;
            }
          }

          if (
            event.code === "F2" &&
            selectedSymbolIds.length === 0 &&
            selectedTextNoteIds.length === 0 &&
            selectedWireIds.length === 0
          ) {
            event.preventDefault();
            handleOpenCircuitProperties(currentCircuit);
            return;
          }
        }
      };

      const handleKeyUp = (event: KeyboardEvent) => {
        if (event.code === "Space") {
          setIsSpacePressed(false);
          setIsPanning(false);
          panDragRef.current = null;
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("keyup", handleKeyUp);

      return () => {
        window.removeEventListener("keydown", handleKeyDown);
        window.removeEventListener("keyup", handleKeyUp);
      };
    },
    [
      currentCircuit,
      editingCircuit,
      editingSymbol,
      editingTextNote,
      handleOpenCircuitProperties,
      handleOpenSymbolProperties,
      handleOpenTextNoteEditor,
      isFindBarOpen,
      isSimulating,
      moveFloatingPaste,
      redo,
      removeEntities,
      rotateFloatingPaste,
      selectAllElements,
      selectedSymbolIds,
      selectedTextNoteIds,
      selectedWireIds,
      undo,
      wirePledge,
      cancelFloatingPaste,
      clipboardNotice,
      commitFloatingPaste,
      contextTarget,
      copySelectionToClipboard,
      cutSelectionToClipboard,
    ],
  );

  // Hilfsfunktion: Bereitet das gemeinsame Verschieben von Symbolen, Notizen und Leitungen inkl. Rubberbanding vor
  const beginEntityDrag = React.useCallback(
    (
      pointerId: number,
      pointerGrid: GridPoint,
      targetSymbolIds: string[],
      targetNoteIds: string[],
      targetWireIds: string[],
      clickedInfo?: { symbolId?: string; noteId?: string; wireId?: string },
    ) => {
      const initialSymbolPositions = new Map<string, GridPoint>();
      const movedPointsKeySet = new Set<string>();

      for (const id of targetSymbolIds) {
        const sym = currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === id);
        if (sym) {
          initialSymbolPositions.set(id, { x: sym.x, y: sym.y });
          for (const jam of sym.jams) {
            movedPointsKeySet.add(gridPointKey(jam.absolutePoint));
          }
        }
      }

      const initialNotePositions = new Map<string, GridPoint>();
      for (const id of targetNoteIds) {
        const note = currentCircuit.textNotes.find((n) => n.textNoteId === id);
        if (note) {
          initialNotePositions.set(id, { x: note.x, y: note.y });
        }
      }

      const selectedWireIdSet = new Set<string>(targetWireIds);
      const initialWireSnapshots = new Map<string, Wire>();
      for (const w of currentCircuit.wires) {
        initialWireSnapshots.set(w.wireId, {
          ...w,
          point1: { ...w.point1 },
          point2: { ...w.point2 },
        });
        if (selectedWireIdSet.has(w.wireId)) {
          movedPointsKeySet.add(gridPointKey(w.point1));
          movedPointsKeySet.add(gridPointKey(w.point2));
        }
      }

      entityDragRef.current = {
        initialSymbolPositions,
        initialNotePositions,
        initialWireSnapshots,
        selectedWireIdSet,
        movedPointsKeySet,
        startPointerGrid: pointerGrid,
        clickedSymbolId: clickedInfo?.symbolId,
        clickedNoteId: clickedInfo?.noteId,
        clickedWireId: clickedInfo?.wireId,
        hasMoved: false,
      };
      setIsMovingEntity(true);

      if (containerRef.current) {
        containerRef.current.setPointerCapture(pointerId);
      }
    },
    [
      currentCircuit.circuitSymbols,
      currentCircuit.textNotes,
      currentCircuit.wires,
    ],
  );

  // Mausrad-Zoom zentriert auf die Cursorposition
  const handleWheel = React.useCallback(
    (event: React.WheelEvent<SVGSVGElement>) => {
      event.preventDefault();
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const cursorScreen: CanvasPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      const zoomFactor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      const nextZoom = viewport.zoom * zoomFactor;
      const nextViewport = calculateZoomAtPoint(viewport, cursorScreen, nextZoom);

      if (panDragRef.current) {
        panDragRef.current.startPanX = nextViewport.panX;
        panDragRef.current.startPanY = nextViewport.panY;
        panDragRef.current.startX = event.clientX;
        panDragRef.current.startY = event.clientY;
      }

      setViewport(nextViewport);
    },
    [setViewport, viewport],
  );

  // Starten des Leitungszeichnens (bei Klick nahe einem Pin) oder Verschiebens beim Klick auf ein Bauteil-Symbol
  const handleSymbolPointerDown = React.useCallback(
    (event: React.PointerEvent<SVGGElement>, symbol: CircuitSymbol) => {
      const isMiddleButton = event.button === 1;
      const isLeftWithSpace = event.button === 0 && isSpacePressed;

      if (isMiddleButton || isLeftWithSpace) {
        return;
      }

      if (event.button === 0) {
        event.stopPropagation();

        if (!isSimulating && floatingPasteRef.current !== null) {
          commitFloatingPaste();
          return;
        }

        // Interaktives Betätigen von Tastern, Schaltern und Anzeige-Subschaltungen während der Simulation
        if (isSimulating) {
          const result = dispatchSimulationSymbolPointerDown({
            symbol,
            target: event.target,
            detail: event.detail,
            shiftOrMeta: event.shiftKey || event.ctrlKey || event.metaKey,
            lastSymbolClick: lastSymbolClickRef.current,
            activeSimulationMap,
            toggleButton,
            setButtonState,
            selectCircuitMap,
            selectSymbol,
            selectEntities,
          });
          lastSymbolClickRef.current = result.nextLastClick;
          if (result.capturedButtonId) {
            activePressedButtonIdRef.current = result.capturedButtonId;
            if (typeof containerRef.current?.setPointerCapture === "function") {
              containerRef.current.setPointerCapture(event.pointerId);
            }
          }
          return;
        }

        // Doppelklick auf ein Bauteil öffnet den Eigenschaftendialog bzw. die Subschaltung
        const isDouble = event.detail >= 2 || (
          lastSymbolClickRef.current !== null &&
          lastSymbolClickRef.current.symbolId === symbol.circuitSymbolId &&
          Date.now() - lastSymbolClickRef.current.time < 350
        );
        lastSymbolClickRef.current = { symbolId: symbol.circuitSymbolId, time: Date.now() };

        if (isDouble) {
          lastSymbolClickRef.current = null;
          setWirePledge(null);
          if (symbol.circuit.kind === "logicalCircuit") {
            const subCircuitId = (symbol.circuit as LogicalCircuit).logicalCircuitId;
            if (subCircuitId) {
              setCurrentCircuitId(subCircuitId);
              return;
            }
          } else {
            handleOpenSymbolProperties(symbol);
            return;
          }
        }

        const container = containerRef.current;
        if (!container) {
          return;
        }

        const rect = container.getBoundingClientRect();
        const screenPoint: CanvasPoint = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };
        const canvasPoint = screenToCanvas(screenPoint, viewport);
        const pointerGrid = canvasToGrid(canvasPoint);

        // Prüfen, ob direkt auf einen Bauteil-Pin (Jam) geklickt wurde -> StartWire (analog zu JamMouseDown in EditorDiagram.cs)
        if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !isSimulating) {
          const hitJam = findJamNear(canvasPoint, currentCircuit.circuitSymbols);
          if (hitJam) {
            selectEntities([], [], false, []);
            setWirePledge({
              startGrid: { ...hitJam.jam.absolutePoint },
              currentGrid: { ...hitJam.jam.absolutePoint },
            });
            container.setPointerCapture(event.pointerId);
            return;
          }
        }

        const isAlreadySelected = selectedSymbolIds.includes(symbol.circuitSymbolId);
        let targetSymbolIds: string[];
        let targetNoteIds: string[];
        let targetWireIds: string[];

        if (event.shiftKey || event.ctrlKey || event.metaKey) {
          selectSymbol(symbol.circuitSymbolId, true);
          if (isAlreadySelected) {
            targetSymbolIds = selectedSymbolIds.filter((id) => id !== symbol.circuitSymbolId);
          } else {
            targetSymbolIds = [...selectedSymbolIds, symbol.circuitSymbolId];
          }
          targetNoteIds = selectedTextNoteIds;
          targetWireIds = selectedWireIds;
        } else {
          if (isAlreadySelected) {
            targetSymbolIds = selectedSymbolIds;
            targetNoteIds = selectedTextNoteIds;
            targetWireIds = selectedWireIds;
          } else {
            selectEntities([symbol.circuitSymbolId], [], false, []);
            targetSymbolIds = [symbol.circuitSymbolId];
            targetNoteIds = [];
            targetWireIds = [];
          }
        }

        if (!targetSymbolIds.includes(symbol.circuitSymbolId)) {
          targetSymbolIds = [...targetSymbolIds, symbol.circuitSymbolId];
        }

        beginEntityDrag(
          event.pointerId,
          pointerGrid,
          targetSymbolIds,
          targetNoteIds,
          targetWireIds,
          { symbolId: symbol.circuitSymbolId },
        );
      }
    },
    [
      activeSimulationMap,
      beginEntityDrag,
      currentCircuit.circuitSymbols,
      handleOpenSymbolProperties,
      isSimulating,
      isSpacePressed,
      selectCircuitMap,
      selectEntities,
      selectSymbol,
      selectedSymbolIds,
      selectedTextNoteIds,
      selectedWireIds,
      setButtonState,
      setCurrentCircuitId,
      toggleButton,
      viewport,
    ],
  );

  // Starten des Verschiebens oder Öffnen des Editors bei Klick/Doppelklick auf eine Text-Notiz
  const handleTextNotePointerDown = React.useCallback(
    (event: React.PointerEvent<SVGGElement>, textNote: TextNote) => {
      const isMiddleButton = event.button === 1;
      const isLeftWithSpace = event.button === 0 && isSpacePressed;

      if (isMiddleButton || isLeftWithSpace) {
        return;
      }

      if (event.button === 0) {
        event.stopPropagation();

        if (!isSimulating && floatingPasteRef.current !== null) {
          commitFloatingPaste();
          return;
        }

        if (isSimulating) {
          if (event.shiftKey || event.ctrlKey || event.metaKey) {
            selectTextNote(textNote.textNoteId, true);
          } else {
            selectEntities([], [textNote.textNoteId], false, []);
          }
          return;
        }

        const now = Date.now();
        const isDoubleClick = event.detail >= 2 ||
          (lastNoteClickRef.current?.noteId === textNote.textNoteId && now - lastNoteClickRef.current.time < 350);

        if (isDoubleClick) {
          event.preventDefault();
          lastNoteClickRef.current = null;
          handleOpenTextNoteEditor(textNote);
          return;
        }
        lastNoteClickRef.current = { noteId: textNote.textNoteId, time: now };

        const container = containerRef.current;
        if (!container) {
          return;
        }

        const rect = container.getBoundingClientRect();
        const screenPoint: CanvasPoint = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };
        const canvasPoint = screenToCanvas(screenPoint, viewport);
        const pointerGrid = canvasToGrid(canvasPoint);

        const isAlreadySelected = selectedTextNoteIds.includes(textNote.textNoteId);
        let targetSymbolIds: string[];
        let targetNoteIds: string[];
        let targetWireIds: string[];

        if (event.shiftKey || event.ctrlKey || event.metaKey) {
          selectTextNote(textNote.textNoteId, true);
          if (isAlreadySelected) {
            targetNoteIds = selectedTextNoteIds.filter((id) => id !== textNote.textNoteId);
          } else {
            targetNoteIds = [...selectedTextNoteIds, textNote.textNoteId];
          }
          targetSymbolIds = selectedSymbolIds;
          targetWireIds = selectedWireIds;
        } else {
          if (isAlreadySelected) {
            targetSymbolIds = selectedSymbolIds;
            targetNoteIds = selectedTextNoteIds;
            targetWireIds = selectedWireIds;
          } else {
            selectEntities([], [textNote.textNoteId], false, []);
            targetSymbolIds = [];
            targetNoteIds = [textNote.textNoteId];
            targetWireIds = [];
          }
        }

        if (!targetNoteIds.includes(textNote.textNoteId)) {
          targetNoteIds = [...targetNoteIds, textNote.textNoteId];
        }

        beginEntityDrag(
          event.pointerId,
          pointerGrid,
          targetSymbolIds,
          targetNoteIds,
          targetWireIds,
          { noteId: textNote.textNoteId },
        );
      }
    },
    [
      beginEntityDrag,
      handleOpenTextNoteEditor,
      isSpacePressed,
      selectEntities,
      selectTextNote,
      selectedSymbolIds,
      selectedTextNoteIds,
      selectedWireIds,
      viewport,
    ],
  );

  // Startet das Ziehen eines einzelnen Leitungsendpunkts (WirePointMarker in EditorDiagram.cs)
  const startWireEndpointDrag = React.useCallback(
    (pointerId: number, wire: Wire, endpoint: 1 | 2) => {
      const originalPoint = endpoint === 1 ? { ...wire.point1 } : { ...wire.point2 };
      const hasJamAtOrigin = findJamAt(originalPoint, currentCircuit.circuitSymbols) !== null;
      const initialWireSnapshots = new Map<string, Wire>();
      for (const w of currentCircuit.wires) {
        initialWireSnapshots.set(w.wireId, {
          ...w,
          point1: { ...w.point1 },
          point2: { ...w.point2 },
        });
      }

      wireEndpointDragRef.current = {
        wireId: wire.wireId,
        endpoint,
        originalPoint,
        hasJamAtOrigin,
        initialWireSnapshots,
        hasMoved: false,
      };
      setIsDraggingWireEndpoint(true);
      if (containerRef.current) {
        containerRef.current.setPointerCapture(pointerId);
      }
    },
    [currentCircuit.circuitSymbols, currentCircuit.wires],
  );

  // Klick/Drag auf den Endpunkt-Griff (WirePointMarker) einer ausgewählten Leitung
  const handleWireEndpointPointerDown = React.useCallback(
    (event: React.PointerEvent<SVGCircleElement>, wire: Wire, endpoint: 1 | 2) => {
      if (event.button !== 0 || isSpacePressed || isSimulating) {
        return;
      }
      event.stopPropagation();

      // Alt + Klick bei genau 2 ausgewählten Leitungen verschmilzt diese am gemeinsamen Endpunkt (Merge)
      if (event.altKey && selectedWireIds.length === 2) {
        const pt = endpoint === 1 ? wire.point1 : wire.point2;
        const otherWireId = selectedWireIds.find((id) => id !== wire.wireId);
        if (otherWireId) {
          const otherWire = currentCircuit.wires.find((w) => w.wireId === otherWireId);
          if (
            otherWire &&
            ((otherWire.x1 === pt.x && otherWire.y1 === pt.y) ||
              (otherWire.x2 === pt.x && otherWire.y2 === pt.y))
          ) {
            mergeWires(wire.wireId, otherWire.wireId);
          }
        }
        return;
      }

      // Shift + Klick wählt den gesamten Conductor aus
      if (event.shiftKey) {
        const container = containerRef.current;
        if (!container) {
          return;
        }
        const rect = container.getBoundingClientRect();
        const canvasPoint = screenToCanvas(
          { x: event.clientX - rect.left, y: event.clientY - rect.top },
          viewport,
        );
        const pointerGrid = canvasToGrid(canvasPoint);

        if (event.ctrlKey || event.metaKey) {
          selectConductor(wire.wireId, "toggle");
          return;
        }
        const conductorWires = getConductorWiresForWire(wire, currentCircuit.conductorMap);
        const conductorWireIds = conductorWires.map((w) => w.wireId);
        selectConductor(wire.wireId, "replace");
        beginEntityDrag(event.pointerId, pointerGrid, [], [], conductorWireIds);
        return;
      }

      startWireEndpointDrag(event.pointerId, wire, endpoint);
    },
    [
      beginEntityDrag,
      currentCircuit.conductorMap,
      currentCircuit.wires,
      isSimulating,
      isSpacePressed,
      mergeWires,
      selectConductor,
      selectedWireIds,
      startWireEndpointDrag,
      viewport,
    ],
  );

  // Klick/Drag auf ein Leitungssegment (analog zu SymbolMouseDown / MarkerMouseDown für Wire in EditorDiagram.cs)
  const handleWirePointerDown = React.useCallback(
    (event: React.PointerEvent<SVGElement>, wire: Wire) => {
      if (isSimulating) {
        if (event.button === 0 && !isSpacePressed) {
          event.stopPropagation();
          if (event.shiftKey || event.ctrlKey || event.metaKey) {
            selectWire(wire.wireId, true);
          } else {
            selectEntities([], [], false, [wire.wireId]);
          }
        }
        return;
      }

      if (event.button !== 0 || isSpacePressed) {
        return;
      }
      event.stopPropagation();

      if (floatingPasteRef.current !== null) {
        commitFloatingPaste();
        return;
      }

      const container = containerRef.current;
      if (!container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const screenPoint: CanvasPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const canvasPoint = screenToCanvas(screenPoint, viewport);
      const pointerGrid = canvasToGrid(canvasPoint);

      // Alt + Klick auf eine ausgewählte Leitung: Split am Rasterpunkt bzw. Merge bei 2 ausgewählten Leitungen
      if (event.altKey) {
        if (selectedWireIds.length === 2) {
          const nearEp1 = isPointNearGridPoint(canvasPoint, wire.point1);
          const nearEp2 = isPointNearGridPoint(canvasPoint, wire.point2);
          if (nearEp1 || nearEp2) {
            const pt = nearEp1 ? wire.point1 : wire.point2;
            const otherWireId = selectedWireIds.find((id) => id !== wire.wireId);
            const otherWire = otherWireId
              ? currentCircuit.wires.find((w) => w.wireId === otherWireId)
              : undefined;
            if (
              otherWire &&
              ((otherWire.x1 === pt.x && otherWire.y1 === pt.y) ||
                (otherWire.x2 === pt.x && otherWire.y2 === pt.y))
            ) {
              mergeWires(wire.wireId, otherWire.wireId);
              return;
            }
          }
        }
        splitWire(wire.wireId, pointerGrid);
        return;
      }

      // Shift + Klick wählt den gesamten Conductor aus (analog zu EditorDiagram.SelectConductor)
      if (event.shiftKey) {
        if (event.ctrlKey || event.metaKey) {
          selectConductor(wire.wireId, "toggle");
          return;
        }
        const conductorWires = getConductorWiresForWire(wire, currentCircuit.conductorMap);
        const conductorWireIds = conductorWires.map((w) => w.wireId);
        selectConductor(wire.wireId, "replace");
        beginEntityDrag(event.pointerId, pointerGrid, [], [], conductorWireIds, { wireId: wire.wireId });
        return;
      }

      // Strg + Klick schaltet die Auswahl der Leitung um
      if (event.ctrlKey || event.metaKey) {
        const isAlreadySelected = selectedWireIds.includes(wire.wireId);
        selectWire(wire.wireId, true);
        const nextWireIds = isAlreadySelected
          ? selectedWireIds.filter((id) => id !== wire.wireId)
          : [...selectedWireIds, wire.wireId];
        if (!isAlreadySelected) {
          beginEntityDrag(
            event.pointerId,
            pointerGrid,
            selectedSymbolIds,
            selectedTextNoteIds,
            nextWireIds,
            { wireId: wire.wireId },
          );
        }
        return;
      }

      const isAlreadySelected = selectedWireIds.includes(wire.wireId);
      const nearPoint1 = isPointNearGridPoint(canvasPoint, wire.point1);
      const nearPoint2 = isPointNearGridPoint(canvasPoint, wire.point2);

      // Ist die Leitung bereits ausgewählt und wurde nahe an einem ihrer Endpunkte geklickt -> Endpunkt verschieben
      if (isAlreadySelected && selectedWireIds.length === 1 && (nearPoint1 || nearPoint2)) {
        startWireEndpointDrag(event.pointerId, wire, nearPoint1 ? 1 : 2);
        return;
      }

      // Ist die Leitung nicht ausgewählt und wurde nahe an einem Endpunkt (oder Bauteil-Pin) geklickt -> neue Leitung ziehen (StartWire)
      if (!isAlreadySelected && (nearPoint1 || nearPoint2)) {
        const startPt = nearPoint1 ? wire.point1 : wire.point2;
        selectEntities([], [], false, []);
        setWirePledge({
          startGrid: { ...startPt },
          currentGrid: { ...startPt },
        });
        container.setPointerCapture(event.pointerId);
        return;
      }

      // Standard-Klick auf den Leitungskörper -> Leitung auswählen und bewegen
      let targetSymbolIds: string[];
      let targetNoteIds: string[];
      let targetWireIds: string[];

      if (isAlreadySelected) {
        targetSymbolIds = selectedSymbolIds;
        targetNoteIds = selectedTextNoteIds;
        targetWireIds = selectedWireIds;
      } else {
        selectEntities([], [], false, [wire.wireId]);
        targetSymbolIds = [];
        targetNoteIds = [];
        targetWireIds = [wire.wireId];
      }

      beginEntityDrag(
        event.pointerId,
        pointerGrid,
        targetSymbolIds,
        targetNoteIds,
        targetWireIds,
        { wireId: wire.wireId },
      );
    },
    [
      beginEntityDrag,
      currentCircuit.conductorMap,
      currentCircuit.wires,
      isSimulating,
      isSpacePressed,
      mergeWires,
      selectConductor,
      selectEntities,
      selectWire,
      selectedSymbolIds,
      selectedTextNoteIds,
      selectedWireIds,
      splitWire,
      startWireEndpointDrag,
      viewport,
    ],
  );

  // Starten der Größenänderung an einem der 8 Anfasser einer Text-Notiz
  const handleResizeHandlePointerDown = React.useCallback(
    (
      event: React.PointerEvent<SVGRectElement>,
      textNote: TextNote,
      hx: 0 | 1 | 2,
      hy: 0 | 1 | 2,
    ) => {
      if (event.button !== 0) {
        return;
      }
      event.stopPropagation();

      const container = containerRef.current;
      if (!container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const screenPoint: CanvasPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const canvasPoint = screenToCanvas(screenPoint, viewport);
      const pointerGrid = canvasToGrid(canvasPoint);

      noteResizeRef.current = {
        textNoteId: textNote.textNoteId,
        initialNote: textNote,
        initialX: textNote.x,
        initialY: textNote.y,
        initialWidth: textNote.width || 4,
        initialHeight: textNote.height || 1,
        startPointerGrid: pointerGrid,
        hx,
        hy,
        rotation: textNote.rotation,
      };
      setIsResizingNote(true);

      if (containerRef.current) {
        containerRef.current.setPointerCapture(event.pointerId);
      }
    },
    [viewport],
  );

  // Starten der Größenänderung an einem der 8 Anfasser eines Schaltungs-Bausteins
  const handleSymbolResizeHandlePointerDown = React.useCallback(
    (
      event: React.PointerEvent<SVGRectElement>,
      symbol: CircuitSymbol,
      hx: 0 | 1 | 2,
      hy: 0 | 1 | 2,
    ) => {
      if (event.button !== 0) {
        return;
      }
      event.stopPropagation();

      const container = containerRef.current;
      if (!container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const screenPoint: CanvasPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const canvasPoint = screenToCanvas(screenPoint, viewport);
      const pointerGrid = canvasToGrid(canvasPoint);

      const initialPin = symbol.circuit.kind === "pin"
        ? project.pins.find((p) => p.pinId === symbol.circuit.circuitId)
        : undefined;

      const initialWireSnapshots = new Map<string, Wire>();
      for (const w of currentCircuit.wires) {
        initialWireSnapshots.set(w.wireId, {
          ...w,
          point1: { ...w.point1 },
          point2: { ...w.point2 },
        });
      }

      symbolResizeRef.current = {
        symbolId: symbol.circuitSymbolId,
        initialSymbol: symbol,
        initialPin,
        initialWireSnapshots,
        initialX: symbol.x,
        initialY: symbol.y,
        initialWidth: symbol.circuit.symbolWidth || 2,
        initialHeight: symbol.circuit.symbolHeight || 2,
        startPointerGrid: pointerGrid,
        hx,
        hy,
        rotation: symbol.rotation,
        kind: symbol.circuit.kind,
      };
      setIsResizingSymbol(true);

      if (containerRef.current) {
        containerRef.current.setPointerCapture(event.pointerId);
      }
    },
    [
      currentCircuit.wires,
      project.pins,
      viewport,
    ],
  );

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const isMiddleButton = event.button === 1;
      const isLeftButtonWithSpace = event.button === 0 && isSpacePressed;

      if (isMiddleButton || isLeftButtonWithSpace) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsPanning(true);
        panDragRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          startPanX: viewport.panX,
          startPanY: viewport.panY,
        };
        return;
      }

      if (event.button === 0) {
        if (!isSimulating && floatingPasteRef.current !== null) {
          commitFloatingPaste();
          return;
        }

        if (event.detail >= 2 && !isSimulating) {
          handleOpenCircuitProperties(currentCircuit);
          return;
        }

        const container = containerRef.current;
        if (!container) {
          return;
        }

        const rect = container.getBoundingClientRect();
        const startX = event.clientX - rect.left;
        const startY = event.clientY - rect.top;
        const canvasPoint = screenToCanvas({ x: startX, y: startY }, viewport);

        // Prüfen, ob nahe an einem Bauteil-Pin (Jam) oder Leitungsendpunkt auf dem freien Canvas geklickt wurde -> StartWire
        if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !isSimulating) {
          const hitJam = findJamNear(canvasPoint, currentCircuit.circuitSymbols);
          if (hitJam) {
            selectEntities([], [], false, []);
            setWirePledge({
              startGrid: { ...hitJam.jam.absolutePoint },
              currentGrid: { ...hitJam.jam.absolutePoint },
            });
            event.currentTarget.setPointerCapture(event.pointerId);
            return;
          }

          const hitEndpoint = findWireEndpointNear(canvasPoint, currentCircuit.wires);
          if (hitEndpoint && !selectedWireIds.includes(hitEndpoint.wire.wireId)) {
            selectEntities([], [], false, []);
            setWirePledge({
              startGrid: { ...hitEndpoint.point },
              currentGrid: { ...hitEndpoint.point },
            });
            event.currentTarget.setPointerCapture(event.pointerId);
            return;
          }
        }

        initialSelectedSymbolIdsRef.current = selectedSymbolIds;
        initialSelectedNoteIdsRef.current = selectedTextNoteIds;
        initialSelectedWireIdsRef.current = selectedWireIds;
        setIsSelectingShift(event.shiftKey);
        setCandidateSymbolIds([]);
        setCandidateNoteIds([]);
        setCandidateWireIds([]);
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsSelecting(true);
        setSelectionBox({
          startX,
          startY,
          currentX: startX,
          currentY: startY,
        });
      }
    },
    [
      currentCircuit,
      handleOpenCircuitProperties,
      isSimulating,
      isSpacePressed,
      selectEntities,
      selectedSymbolIds,
      selectedTextNoteIds,
      selectedWireIds,
      viewport,
    ],
  );

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const screenPoint: CanvasPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      if (isPanning && panDragRef.current) {
        const deltaX = event.clientX - panDragRef.current.startX;
        const deltaY = event.clientY - panDragRef.current.startY;
        const nextPanX = panDragRef.current.startPanX + deltaX;
        const nextPanY = panDragRef.current.startPanY + deltaY;

        setViewport((prev) => ({
          ...prev,
          panX: nextPanX,
          panY: nextPanY,
        }));

        const currentViewport = { ...viewport, panX: nextPanX, panY: nextPanY };
        const canvasPoint = screenToCanvas(screenPoint, currentViewport);
        const gridPoint = canvasToGrid(canvasPoint);
        setCursor({ grid: gridPoint, canvas: canvasPoint });
        return;
      }

      // Aktuelle Cursor-Koordinaten für die Statusleiste aktualisieren
      const canvasPoint = screenToCanvas(screenPoint, viewport);
      const gridPoint = canvasToGrid(canvasPoint);
      setCursor({ grid: gridPoint, canvas: canvasPoint });

      // Blockweises Verschieben des schwebenden Paste-/Verschiebe-Overlays ohne vorzeitiges Wire-Merging
      if (floatingDragRef.current) {
        const { initialState, startPointerGrid, hasMoved } = floatingDragRef.current;
        const dx = gridPoint.x - startPointerGrid.x;
        const dy = gridPoint.y - startPointerGrid.y;
        if (dx !== 0 || dy !== 0 || hasMoved) {
          floatingDragRef.current.hasMoved = true;
          setFloatingPaste(
            translateFloatingState(initialState, dx, dy, currentCircuit, {
              withWires: event.shiftKey ? false : initialState.moveMeta?.withWires,
            }),
          );
        }
        return;
      }

      // Pin-Hover-Erkennung und Fehler-Indikator-Tooltip aktualisieren
      if (!isPanning && !isSelecting && !isMovingEntity && !isResizingNote && !isResizingSymbol) {
        const errorHit = wireValidation.errorIndicators.find((ind) =>
          isPointNearGridPoint(canvasPoint, ind.point),
        );
        if (errorHit) {
          setHoveredPinInfo({
            point: errorHit.point,
            screenX: errorHit.point.x * GRID_SIZE * viewport.zoom + viewport.panX,
            screenY: errorHit.point.y * GRID_SIZE * viewport.zoom + viewport.panY,
            tooltip: errorHit.tooltip,
            isError: true,
          });
        } else {
          const jamHit = findJamNear(canvasPoint, currentCircuit.circuitSymbols);
          if (jamHit) {
            const pt = jamHit.jam.absolutePoint;
            let tooltip = formatJamTooltip(jamHit.symbol, jamHit.jam);
            if (isSimulating && snapshot && activeSimulationMap) {
              const idxs = activeSimulationMap.jamStateIndexes(jamHit.jam);
              const sigText = formatSignalTooltip(idxs, snapshot.stateArray);
              if (sigText) {
                tooltip = `${tooltip}\n${sigText}`;
              }
            }
            setHoveredPinInfo({
              point: pt,
              screenX: pt.x * GRID_SIZE * viewport.zoom + viewport.panX,
              screenY: pt.y * GRID_SIZE * viewport.zoom + viewport.panY,
              tooltip,
              isError: false,
            });
          } else {
            const wireHit =
              (isSimulating && snapshot && activeSimulationMap) || scopedCleanUpReport
                ? findWireNear(canvasPoint, currentCircuit.wires)
                : null;
            if (wireHit) {
              const parts: string[] = [];
              if (isSimulating && snapshot && activeSimulationMap) {
                const idxs = activeSimulationMap.stateIndexes(wireHit);
                const sigText = formatSignalTooltip(idxs, snapshot.stateArray);
                if (sigText) {
                  parts.push(sigText);
                }
              }
              const cleanUpNote = formatWireCleanUpTooltip(
                scopedCleanUpReport?.wireInfoById.get(wireHit.wireId),
              );
              if (cleanUpNote) {
                parts.push(cleanUpNote);
              }
              if (parts.length > 0) {
                setHoveredPinInfo({
                  point: canvasPoint,
                  screenX: screenPoint.x,
                  screenY: screenPoint.y,
                  tooltip: parts.join("\n"),
                  isError: false,
                });
              } else {
                setHoveredPinInfo((prev) => (prev === null ? null : null));
              }
            } else {
              setHoveredPinInfo((prev) => (prev === null ? null : null));
            }
          }
        }
      } else {
        setHoveredPinInfo((prev) => (prev === null ? null : null));
      }

      // Live-Vorschau beim Ziehen einer neuen Leitung (WirePledge)
      if (wirePledge !== null) {
        setWirePledge((prev) => {
          if (!prev) {
            return null;
          }
          if (prev.currentGrid.x === gridPoint.x && prev.currentGrid.y === gridPoint.y) {
            return prev;
          }
          return {
            ...prev,
            currentGrid: gridPoint,
          };
        });
        return;
      }

      // Ziehen eines einzelnen Leitungsendpunkts (WirePointMarker) inkl. Rubberbanding
      if (isDraggingWireEndpoint && wireEndpointDragRef.current) {
        const {
          wireId,
          endpoint,
          originalPoint,
          hasJamAtOrigin,
          initialWireSnapshots,
        } = wireEndpointDragRef.current;

        const dx = gridPoint.x - originalPoint.x;
        const dy = gridPoint.y - originalPoint.y;

        if (dx !== 0 || dy !== 0 || wireEndpointDragRef.current.hasMoved) {
          if (dx !== 0 || dy !== 0) {
            wireEndpointDragRef.current.hasMoved = true;
          }
          const withWires = !event.shiftKey;
          const updates: { wireId: string; x1: number; y1: number; x2: number; y2: number }[] = [];

          for (const [id, initW] of initialWireSnapshots.entries()) {
            if (id === wireId) {
              updates.push({
                wireId: id,
                x1: endpoint === 1 ? initW.x1 + dx : initW.x1,
                y1: endpoint === 1 ? initW.y1 + dy : initW.y1,
                x2: endpoint === 2 ? initW.x2 + dx : initW.x2,
                y2: endpoint === 2 ? initW.y2 + dy : initW.y2,
              });
            } else if (withWires && !hasJamAtOrigin && !selectedWireIds.includes(id)) {
              const match1 = initW.x1 === originalPoint.x && initW.y1 === originalPoint.y;
              const match2 = initW.x2 === originalPoint.x && initW.y2 === originalPoint.y;
              if (match1 || match2) {
                updates.push({
                  wireId: id,
                  x1: match1 ? initW.x1 + dx : initW.x1,
                  y1: match1 ? initW.y1 + dy : initW.y1,
                  x2: match2 ? initW.x2 + dx : initW.x2,
                  y2: match2 ? initW.y2 + dy : initW.y2,
                });
              } else {
                updates.push({
                  wireId: id,
                  x1: initW.x1,
                  y1: initW.y1,
                  x2: initW.x2,
                  y2: initW.y2,
                });
              }
            } else {
              updates.push({
                wireId: id,
                x1: initW.x1,
                y1: initW.y1,
                x2: initW.x2,
                y2: initW.y2,
              });
            }
          }
          updateWiresLive(updates);
        }
        return;
      }

      // Größenänderung einer Text-Notiz an den 8 Anfassern
      if (isResizingNote && noteResizeRef.current) {
        const currentPointer = gridPoint;
        const startPointer = noteResizeRef.current.startPointerGrid;
        const screenDx = currentPointer.x - startPointer.x;
        const screenDy = currentPointer.y - startPointer.y;

        let localDx = screenDx;
        let localDy = screenDy;
        switch (noteResizeRef.current.rotation) {
          case "right":
            localDx = screenDy;
            localDy = -screenDx;
            break;
          case "down":
            localDx = -screenDx;
            localDy = -screenDy;
            break;
          case "left":
            localDx = -screenDy;
            localDy = screenDx;
            break;
          case "up":
          default:
            localDx = screenDx;
            localDy = screenDy;
            break;
        }

        const { initialX, initialY, initialWidth, initialHeight, hx, hy } = noteResizeRef.current;

        let newWidth = initialWidth;
        let newHeight = initialHeight;
        let newLocalX = 0;
        let newLocalY = 0;

        if (hx === 0) {
          newWidth = Math.max(
            TEXT_NOTE_MIN_GRID_SIZE,
            Math.min(TEXT_NOTE_MAX_GRID_SIZE, initialWidth - localDx),
          );
          newLocalX = initialWidth - newWidth;
        } else if (hx === 2) {
          newWidth = Math.max(
            TEXT_NOTE_MIN_GRID_SIZE,
            Math.min(TEXT_NOTE_MAX_GRID_SIZE, initialWidth + localDx),
          );
        }

        if (hy === 0) {
          newHeight = Math.max(
            TEXT_NOTE_MIN_GRID_SIZE,
            Math.min(TEXT_NOTE_MAX_GRID_SIZE, initialHeight - localDy),
          );
          newLocalY = initialHeight - newHeight;
        } else if (hy === 2) {
          newHeight = Math.max(
            TEXT_NOTE_MIN_GRID_SIZE,
            Math.min(TEXT_NOTE_MAX_GRID_SIZE, initialHeight + localDy),
          );
        }

        let globalDeltaX = newLocalX;
        let globalDeltaY = newLocalY;
        switch (noteResizeRef.current.rotation) {
          case "right":
            globalDeltaX = -newLocalY;
            globalDeltaY = newLocalX;
            break;
          case "down":
            globalDeltaX = -newLocalX;
            globalDeltaY = -newLocalY;
            break;
          case "left":
            globalDeltaX = newLocalY;
            globalDeltaY = -newLocalX;
            break;
          case "up":
          default:
            globalDeltaX = newLocalX;
            globalDeltaY = newLocalY;
            break;
        }

        updateTextNote(
          noteResizeRef.current.textNoteId,
          {
            x: initialX + globalDeltaX,
            y: initialY + globalDeltaY,
            width: newWidth,
            height: newHeight,
          },
          { recordHistory: false },
        );
        return;
      }

      // Größenänderung eines Schaltungs-Bausteins an einem der 8 Anfasser
      if (isResizingSymbol && symbolResizeRef.current) {
        const screenDx = gridPoint.x - symbolResizeRef.current.startPointerGrid.x;
        const screenDy = gridPoint.y - symbolResizeRef.current.startPointerGrid.y;

        let localDx = screenDx;
        let localDy = screenDy;
        switch (symbolResizeRef.current.rotation) {
          case "right":
            localDx = screenDy;
            localDy = -screenDx;
            break;
          case "down":
            localDx = -screenDx;
            localDy = -screenDy;
            break;
          case "left":
            localDx = -screenDy;
            localDy = screenDx;
            break;
          case "up":
          default:
            localDx = screenDx;
            localDy = screenDy;
            break;
        }

        const { initialX, initialY, initialWidth, initialHeight, hx, hy, kind } = symbolResizeRef.current;

        const isMatrix = kind === "ledMatrix";
        const isButton = kind === "circuitButton";
        const minW = isMatrix ? LED_MATRIX_MIN_DIM + 1 : isButton ? BUTTON_MIN_GRID_SIZE : RESIZABLE_SYMBOL_MIN_GRID_SIZE;
        const maxW = isMatrix ? LED_MATRIX_MAX_DIM + 1 : isButton ? BUTTON_MAX_GRID_SIZE : RESIZABLE_SYMBOL_MAX_GRID_SIZE;
        const minH = minW;
        const maxH = maxW;

        let newWidth = initialWidth;
        let newHeight = initialHeight;
        let newLocalX = 0;
        let newLocalY = 0;

        if (hx === 0) {
          newWidth = Math.max(minW, Math.min(maxW, initialWidth - localDx));
          newLocalX = initialWidth - newWidth;
        } else if (hx === 2) {
          newWidth = Math.max(minW, Math.min(maxW, initialWidth + localDx));
        }

        if (hy === 0) {
          newHeight = Math.max(minH, Math.min(maxH, initialHeight - localDy));
          newLocalY = initialHeight - newHeight;
        } else if (hy === 2) {
          newHeight = Math.max(minH, Math.min(maxH, initialHeight + localDy));
        }

        let globalDeltaX = newLocalX;
        let globalDeltaY = newLocalY;
        switch (symbolResizeRef.current.rotation) {
          case "right":
            globalDeltaX = -newLocalY;
            globalDeltaY = newLocalX;
            break;
          case "down":
            globalDeltaX = -newLocalX;
            globalDeltaY = -newLocalY;
            break;
          case "left":
            globalDeltaX = newLocalY;
            globalDeltaY = -newLocalX;
            break;
          case "up":
          default:
            globalDeltaX = newLocalX;
            globalDeltaY = newLocalY;
            break;
        }

        resizeCircuitSymbol(
          symbolResizeRef.current.symbolId,
          {
            x: initialX + globalDeltaX,
            y: initialY + globalDeltaY,
            width: newWidth,
            height: newHeight,
          },
          { recordHistory: false, withWires: !event.shiftKey },
        );
        return;
      }

      // Synchrones Verschieben aller ausgewählten Elemente (Bauteile, Notizen und Leitungen inkl. Rubberbanding)
      if (isMovingEntity && entityDragRef.current) {
        const dx = gridPoint.x - entityDragRef.current.startPointerGrid.x;
        const dy = gridPoint.y - entityDragRef.current.startPointerGrid.y;

        if (dx !== 0 || dy !== 0 || entityDragRef.current.hasMoved) {
          if (dx !== 0 || dy !== 0) {
            entityDragRef.current.hasMoved = true;
          }
          if (entityDragRef.current.initialSymbolPositions.size > 0) {
            const symUpdates: { symbolId: string; gridPoint: GridPoint }[] = [];
            for (const [id, startPos] of entityDragRef.current.initialSymbolPositions.entries()) {
              symUpdates.push({
                symbolId: id,
                gridPoint: { x: startPos.x + dx, y: startPos.y + dy },
              });
            }
            moveSymbols(symUpdates, { recordHistory: false, withWires: false });
          }

          if (entityDragRef.current.initialNotePositions.size > 0) {
            const noteUpdates: { textNoteId: string; gridPoint: GridPoint }[] = [];
            for (const [id, startPos] of entityDragRef.current.initialNotePositions.entries()) {
              noteUpdates.push({
                textNoteId: id,
                gridPoint: { x: startPos.x + dx, y: startPos.y + dy },
              });
            }
            moveTextNotes(noteUpdates, { recordHistory: false });
          }

          // Leitungen bewegen: ausgewählte Leitungen komplett, nicht ausgewählte Leitungen per Rubberbanding (sofern Shift nicht gehalten wird)
          if (entityDragRef.current.initialWireSnapshots.size > 0) {
            const withWires = !event.shiftKey;
            const {
              initialWireSnapshots,
              selectedWireIdSet,
              movedPointsKeySet,
            } = entityDragRef.current;
            const wireUpdates: { wireId: string; x1: number; y1: number; x2: number; y2: number }[] = [];

            for (const [wireId, initW] of initialWireSnapshots.entries()) {
              if (selectedWireIdSet.has(wireId)) {
                wireUpdates.push({
                  wireId,
                  x1: initW.x1 + dx,
                  y1: initW.y1 + dy,
                  x2: initW.x2 + dx,
                  y2: initW.y2 + dy,
                });
              } else if (withWires) {
                const moveP1 = movedPointsKeySet.has(gridPointKey(initW.point1));
                const moveP2 = movedPointsKeySet.has(gridPointKey(initW.point2));
                wireUpdates.push({
                  wireId,
                  x1: moveP1 ? initW.x1 + dx : initW.x1,
                  y1: moveP1 ? initW.y1 + dy : initW.y1,
                  x2: moveP2 ? initW.x2 + dx : initW.x2,
                  y2: moveP2 ? initW.y2 + dy : initW.y2,
                });
              } else {
                wireUpdates.push({
                  wireId,
                  x1: initW.x1,
                  y1: initW.y1,
                  x2: initW.x2,
                  y2: initW.y2,
                });
              }
            }
            updateWiresLive(wireUpdates);
          }
        }
        return;
      }

      if (isSelecting && selectionBox) {
        setSelectionBox((prev) => (prev ? { ...prev, currentX: screenPoint.x, currentY: screenPoint.y } : null));
        setIsSelectingShift(event.shiftKey);

        const dragDist = Math.hypot(
          screenPoint.x - selectionBox.startX,
          screenPoint.y - selectionBox.startY,
        );

        if (dragDist >= 4) {
          const startCanvas = screenToCanvas(
            { x: selectionBox.startX, y: selectionBox.startY },
            viewport,
          );
          const endCanvas = screenToCanvas(
            { x: screenPoint.x, y: screenPoint.y },
            viewport,
          );

          const minCanvasX = Math.min(startCanvas.x, endCanvas.x);
          const maxCanvasX = Math.max(startCanvas.x, endCanvas.x);
          const minCanvasY = Math.min(startCanvas.y, endCanvas.y);
          const maxCanvasY = Math.max(startCanvas.y, endCanvas.y);

          const selectionGridBox = {
            minX: minCanvasX / GRID_SIZE,
            minY: minCanvasY / GRID_SIZE,
            maxX: maxCanvasX / GRID_SIZE,
            maxY: maxCanvasY / GRID_SIZE,
          };

          const hitSymbolIds = currentCircuit.circuitSymbols
            .filter((sym) => {
              const symBox = getSymbolGridBoundingBox(sym);
              return doBoundingBoxesIntersect(selectionGridBox, symBox);
            })
            .map((sym) => sym.circuitSymbolId);

          const hitNoteIds = currentCircuit.textNotes
            .filter((note) => {
              const noteBox = getTextNoteGridBoundingBox(note);
              return doBoundingBoxesIntersect(selectionGridBox, noteBox);
            })
            .map((note) => note.textNoteId);

          // Analog zu EditorDiagram.Select(Rect): Leitungen werden erfasst, wenn beide Endpunkte im Rechteck liegen
          const hitWireIds = currentCircuit.wires
            .filter(
              (w) =>
                w.x1 >= selectionGridBox.minX &&
                w.x1 <= selectionGridBox.maxX &&
                w.y1 >= selectionGridBox.minY &&
                w.y1 <= selectionGridBox.maxY &&
                w.x2 >= selectionGridBox.minX &&
                w.x2 <= selectionGridBox.maxX &&
                w.y2 >= selectionGridBox.minY &&
                w.y2 <= selectionGridBox.maxY,
            )
            .map((w) => w.wireId);

          setCandidateSymbolIds((prev) => {
            if (prev.length === hitSymbolIds.length && prev.every((id, idx) => id === hitSymbolIds[idx])) {
              return prev;
            }
            return hitSymbolIds;
          });

          setCandidateNoteIds((prev) => {
            if (prev.length === hitNoteIds.length && prev.every((id, idx) => id === hitNoteIds[idx])) {
              return prev;
            }
            return hitNoteIds;
          });

          setCandidateWireIds((prev) => {
            if (prev.length === hitWireIds.length && prev.every((id, idx) => id === hitWireIds[idx])) {
              return prev;
            }
            return hitWireIds;
          });
        } else {
          setCandidateSymbolIds((prev) => (prev.length === 0 ? prev : []));
          setCandidateNoteIds((prev) => (prev.length === 0 ? prev : []));
          setCandidateWireIds((prev) => (prev.length === 0 ? prev : []));
        }
      }
    },
    [
      activeSimulationMap,
      currentCircuit,
      isDraggingWireEndpoint,
      isMovingEntity,
      isPanning,
      isResizingNote,
      isResizingSymbol,
      isSelecting,
      isSimulating,
      moveSymbols,
      moveTextNotes,
      resizeCircuitSymbol,
      scopedCleanUpReport,
      selectedWireIds,
      selectionBox,
      setCursor,
      setViewport,
      snapshot,
      updateTextNote,
      updateWiresLive,
      viewport,
      wirePledge,
      wireValidation.errorIndicators,
    ],
  );

  const handlePointerUp = React.useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (activePressedButtonIdRef.current) {
        setButtonState(activePressedButtonIdRef.current, false);
        activePressedButtonIdRef.current = null;
      }

      if (isPanning) {
        setIsPanning(false);
        panDragRef.current = null;
      }

      if (floatingDragRef.current !== null) {
        floatingDragRef.current = null;
        return;
      }

      // Abschließen des Leitungszeichnens (WirePledge.Commit)
      if (wirePledge !== null) {
        const container = containerRef.current;
        let endGrid = wirePledge.currentGrid;
        let endCanvasPoint: CanvasPoint | null = null;
        if (container) {
          const rect = container.getBoundingClientRect();
          endCanvasPoint = screenToCanvas(
            { x: event.clientX - rect.left, y: event.clientY - rect.top },
            viewport,
          );
          endGrid = canvasToGrid(endCanvasPoint);
        }

        const startGrid = wirePledge.startGrid;
        setWirePledge(null);

        if (startGrid.x !== endGrid.x || startGrid.y !== endGrid.y) {
          addWire(startGrid, endGrid);
        } else if (endCanvasPoint) {
          // Wenn nicht gezogen wurde (point1 === point2), wie in WirePledge.cs nahegelegene Leitung auswählen
          const nearWire = findWireNear(endCanvasPoint, currentCircuit.wires);
          if (nearWire) {
            selectEntities([], [], false, [nearWire.wireId]);
          }
        }
        return;
      }

      // Abschließen des Ziehens eines einzelnen Leitungsendpunkts (WirePointMarker)
      if (isDraggingWireEndpoint) {
        if (wireEndpointDragRef.current && wireEndpointDragRef.current.hasMoved) {
          const { initialWireSnapshots } = wireEndpointDragRef.current;
          const updatedWires: WireEndpointUpdate[] = [];
          const removedWires: Wire[] = [];
          const zeroLengthIds: string[] = [];

          for (const [wireId, beforeWire] of initialWireSnapshots.entries()) {
            const currentWire = currentCircuit.wires.find((w) => w.wireId === wireId);
            if (!currentWire) {
              continue;
            }
            if (currentWire.x1 === currentWire.x2 && currentWire.y1 === currentWire.y2) {
              removedWires.push(beforeWire);
              zeroLengthIds.push(wireId);
            } else if (
              currentWire.x1 !== beforeWire.x1 ||
              currentWire.y1 !== beforeWire.y1 ||
              currentWire.x2 !== beforeWire.x2 ||
              currentWire.y2 !== beforeWire.y2
            ) {
              updatedWires.push({
                wireId,
                before: {
                  x1: beforeWire.x1,
                  y1: beforeWire.y1,
                  x2: beforeWire.x2,
                  y2: beforeWire.y2,
                },
                after: {
                  x1: currentWire.x1,
                  y1: currentWire.y1,
                  x2: currentWire.x2,
                  y2: currentWire.y2,
                },
              });
            }
          }

          if (zeroLengthIds.length > 0) {
            updateWiresLive([], zeroLengthIds);
          }

          if (updatedWires.length > 0 || removedWires.length > 0) {
            recordDelta({
              type: "wireBatch",
              logicalCircuitId: currentCircuit.logicalCircuitId,
              addedWires: [],
              removedWires,
              updatedWires,
            });
          }
        }
        setIsDraggingWireEndpoint(false);
        wireEndpointDragRef.current = null;
        return;
      }

      if (isResizingNote) {
        if (noteResizeRef.current) {
          const { textNoteId, initialNote } = noteResizeRef.current;
          const afterNote = currentCircuit.textNotes.find((n) => n.textNoteId === textNoteId);
          if (afterNote) {
            const changes: Record<string, PropertyChange> = {};
            if (initialNote.x !== afterNote.x) {
              changes.x = { before: initialNote.x, after: afterNote.x };
            }
            if (initialNote.y !== afterNote.y) {
              changes.y = { before: initialNote.y, after: afterNote.y };
            }
            if (initialNote.width !== afterNote.width) {
              changes.width = { before: initialNote.width, after: afterNote.width };
            }
            if (initialNote.height !== afterNote.height) {
              changes.height = { before: initialNote.height, after: afterNote.height };
            }
            if (Object.keys(changes).length > 0) {
              recordDelta({
                type: "updateProperty",
                logicalCircuitId: currentCircuit.logicalCircuitId,
                targetType: "textNote",
                targetId: textNoteId,
                changes,
                beforeTextNote: initialNote,
                afterTextNote: afterNote,
              });
            }
          }
        }
        setIsResizingNote(false);
        noteResizeRef.current = null;
      }

      if (isResizingSymbol) {
        if (symbolResizeRef.current) {
          const { symbolId, initialSymbol, initialPin, initialWireSnapshots } = symbolResizeRef.current;
          const afterSymbol = currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === symbolId);
          if (afterSymbol) {
            const changes: Record<string, PropertyChange> = {};
            if (initialSymbol.x !== afterSymbol.x) {
              changes.x = { before: initialSymbol.x, after: afterSymbol.x };
            }
            if (initialSymbol.y !== afterSymbol.y) {
              changes.y = { before: initialSymbol.y, after: afterSymbol.y };
            }
            if (initialSymbol.circuit.symbolWidth !== afterSymbol.circuit.symbolWidth) {
              changes.width = {
                before: initialSymbol.circuit.symbolWidth,
                after: afterSymbol.circuit.symbolWidth,
              };
            }
            if (initialSymbol.circuit.symbolHeight !== afterSymbol.circuit.symbolHeight) {
              changes.height = {
                before: initialSymbol.circuit.symbolHeight,
                after: afterSymbol.circuit.symbolHeight,
              };
            }
            if (Object.keys(changes).length > 0) {
              const afterPin = afterSymbol.circuit.kind === "pin"
                ? project.pins.find((p) => p.pinId === afterSymbol.circuit.circuitId)
                : undefined;

              const wireChanges: WireEndpointUpdate[] = [];
              const removedWires: Wire[] = [];
              for (const [wireId, beforeWire] of initialWireSnapshots.entries()) {
                const currentWire = currentCircuit.wires.find((w) => w.wireId === wireId);
                if (!currentWire) {
                  removedWires.push(beforeWire);
                } else if (
                  currentWire.x1 !== beforeWire.x1 ||
                  currentWire.y1 !== beforeWire.y1 ||
                  currentWire.x2 !== beforeWire.x2 ||
                  currentWire.y2 !== beforeWire.y2
                ) {
                  wireChanges.push({
                    wireId,
                    before: {
                      x1: beforeWire.x1,
                      y1: beforeWire.y1,
                      x2: beforeWire.x2,
                      y2: beforeWire.y2,
                    },
                    after: {
                      x1: currentWire.x1,
                      y1: currentWire.y1,
                      x2: currentWire.x2,
                      y2: currentWire.y2,
                    },
                  });
                }
              }

              recordDelta({
                type: "updateProperty",
                logicalCircuitId: currentCircuit.logicalCircuitId,
                targetType: "symbol",
                targetId: symbolId,
                changes,
                beforeSymbol: {
                  symbol: initialSymbol,
                  circuit: initialSymbol.circuit,
                  pin: initialPin,
                },
                afterSymbol: {
                  symbol: afterSymbol,
                  circuit: afterSymbol.circuit,
                  pin: afterPin,
                },
                wireChanges: wireChanges.length > 0 ? wireChanges : undefined,
                removedWires: removedWires.length > 0 ? removedWires : undefined,
              });
            }
          }
        }
        setIsResizingSymbol(false);
        symbolResizeRef.current = null;
      }

      if (isMovingEntity) {
        if (entityDragRef.current) {
          if (entityDragRef.current.hasMoved) {
            const symbolPositions: { symbolId: string; before: GridPoint; after: GridPoint }[] = [];
            const textNotePositions: { textNoteId: string; before: GridPoint; after: GridPoint }[] = [];
            const wireChanges: WireEndpointUpdate[] = [];
            const removedWires: Wire[] = [];
            const zeroLengthIds: string[] = [];
            let totalDx = 0;
            let totalDy = 0;

            for (const [id, startPos] of entityDragRef.current.initialSymbolPositions.entries()) {
              const currentSym = currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === id);
              if (currentSym && (currentSym.x !== startPos.x || currentSym.y !== startPos.y)) {
                totalDx = currentSym.x - startPos.x;
                totalDy = currentSym.y - startPos.y;
                symbolPositions.push({
                  symbolId: id,
                  before: startPos,
                  after: { x: currentSym.x, y: currentSym.y },
                });
              }
            }

            for (const [id, startPos] of entityDragRef.current.initialNotePositions.entries()) {
              const currentNote = currentCircuit.textNotes.find((n) => n.textNoteId === id);
              if (currentNote && (currentNote.x !== startPos.x || currentNote.y !== startPos.y)) {
                totalDx = currentNote.x - startPos.x;
                totalDy = currentNote.y - startPos.y;
                textNotePositions.push({
                  textNoteId: id,
                  before: startPos,
                  after: { x: currentNote.x, y: currentNote.y },
                });
              }
            }

            for (const [wireId, beforeWire] of entityDragRef.current.initialWireSnapshots.entries()) {
              const currentWire = currentCircuit.wires.find((w) => w.wireId === wireId);
              if (!currentWire) {
                continue;
              }
              if (currentWire.x1 === currentWire.x2 && currentWire.y1 === currentWire.y2) {
                removedWires.push(beforeWire);
                zeroLengthIds.push(wireId);
              } else if (
                currentWire.x1 !== beforeWire.x1 ||
                currentWire.y1 !== beforeWire.y1 ||
                currentWire.x2 !== beforeWire.x2 ||
                currentWire.y2 !== beforeWire.y2
              ) {
                if (totalDx === 0 && totalDy === 0) {
                  totalDx = currentWire.x1 - beforeWire.x1 || currentWire.x2 - beforeWire.x2;
                  totalDy = currentWire.y1 - beforeWire.y1 || currentWire.y2 - beforeWire.y2;
                }
                wireChanges.push({
                  wireId,
                  before: {
                    x1: beforeWire.x1,
                    y1: beforeWire.y1,
                    x2: beforeWire.x2,
                    y2: beforeWire.y2,
                  },
                  after: {
                    x1: currentWire.x1,
                    y1: currentWire.y1,
                    x2: currentWire.x2,
                    y2: currentWire.y2,
                  },
                });
              }
            }

            if (zeroLengthIds.length > 0) {
              updateWiresLive([], zeroLengthIds);
            }

            if (
              symbolPositions.length > 0 ||
              textNotePositions.length > 0 ||
              wireChanges.length > 0 ||
              removedWires.length > 0
            ) {
              recordDelta({
                type: "move",
                logicalCircuitId: currentCircuit.logicalCircuitId,
                symbolIds: symbolPositions.map((p) => p.symbolId),
                textNoteIds: textNotePositions.map((p) => p.textNoteId),
                wireIds: Array.from(entityDragRef.current.selectedWireIdSet),
                dx: totalDx,
                dy: totalDy,
                symbolPositions,
                textNotePositions,
                wireChanges: wireChanges.length > 0 ? wireChanges : undefined,
                removedWires: removedWires.length > 0 ? removedWires : undefined,
              });
            }
          } else if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
            if (entityDragRef.current.clickedSymbolId) {
              selectEntities([entityDragRef.current.clickedSymbolId], [], false, []);
            } else if (entityDragRef.current.clickedNoteId) {
              selectEntities([], [entityDragRef.current.clickedNoteId], false, []);
            } else if (entityDragRef.current.clickedWireId) {
              selectEntities([], [], false, [entityDragRef.current.clickedWireId]);
            }
          }
        }
        setIsMovingEntity(false);
        entityDragRef.current = null;
      }

      if (isSelecting && selectionBox) {
        const dragDist = Math.hypot(
          selectionBox.currentX - selectionBox.startX,
          selectionBox.currentY - selectionBox.startY,
        );

        const isShift = event.shiftKey || isSelectingShift;

        if (dragDist >= 4) {
          const startCanvas = screenToCanvas(
            { x: selectionBox.startX, y: selectionBox.startY },
            viewport,
          );
          const endCanvas = screenToCanvas(
            { x: selectionBox.currentX, y: selectionBox.currentY },
            viewport,
          );

          const minCanvasX = Math.min(startCanvas.x, endCanvas.x);
          const maxCanvasX = Math.max(startCanvas.x, endCanvas.x);
          const minCanvasY = Math.min(startCanvas.y, endCanvas.y);
          const maxCanvasY = Math.max(startCanvas.y, endCanvas.y);

          const selectionGridBox = {
            minX: minCanvasX / GRID_SIZE,
            minY: minCanvasY / GRID_SIZE,
            maxX: maxCanvasX / GRID_SIZE,
            maxY: maxCanvasY / GRID_SIZE,
          };

          const hitSymbolIds = currentCircuit.circuitSymbols
            .filter((sym) => {
              const symBox = getSymbolGridBoundingBox(sym);
              return doBoundingBoxesIntersect(selectionGridBox, symBox);
            })
            .map((sym) => sym.circuitSymbolId);

          const hitNoteIds = currentCircuit.textNotes
            .filter((note) => {
              const noteBox = getTextNoteGridBoundingBox(note);
              return doBoundingBoxesIntersect(selectionGridBox, noteBox);
            })
            .map((note) => note.textNoteId);

          const hitWireIds = currentCircuit.wires
            .filter(
              (w) =>
                w.x1 >= selectionGridBox.minX &&
                w.x1 <= selectionGridBox.maxX &&
                w.y1 >= selectionGridBox.minY &&
                w.y1 <= selectionGridBox.maxY &&
                w.x2 >= selectionGridBox.minX &&
                w.x2 <= selectionGridBox.maxX &&
                w.y2 >= selectionGridBox.minY &&
                w.y2 <= selectionGridBox.maxY,
            )
            .map((w) => w.wireId);

          selectEntities(hitSymbolIds, hitNoteIds, isShift, hitWireIds);
        } else {
          if (!isShift) {
            selectEntities([], [], false, []);
          }
        }

        setIsSelecting(false);
        setSelectionBox(null);
        setCandidateSymbolIds([]);
        setCandidateNoteIds([]);
        setCandidateWireIds([]);
        setIsSelectingShift(false);
        initialSelectedSymbolIdsRef.current = [];
        initialSelectedNoteIdsRef.current = [];
        initialSelectedWireIdsRef.current = [];
      }
    },
    [
      addWire,
      currentCircuit.circuitSymbols,
      currentCircuit.logicalCircuitId,
      currentCircuit.textNotes,
      currentCircuit.wires,
      isDraggingWireEndpoint,
      isMovingEntity,
      isPanning,
      isResizingNote,
      isResizingSymbol,
      isSelecting,
      isSelectingShift,
      project.pins,
      recordDelta,
      selectEntities,
      selectionBox,
      setButtonState,
      updateWiresLive,
      viewport,
      wirePledge,
    ],
  );

  const handlePointerLeave = React.useCallback(
    () => {
      if (activePressedButtonIdRef.current) {
        setButtonState(activePressedButtonIdRef.current, false);
        activePressedButtonIdRef.current = null;
      }
      setIsPanning(false);
      setIsMovingEntity(false);
      setIsDraggingWireEndpoint(false);
      setWirePledge(null);
      setHoveredPinInfo(null);
      setIsResizingNote(false);
      setIsSelecting(false);
      setIsSelectingShift(false);
      setCandidateSymbolIds([]);
      setCandidateNoteIds([]);
      setCandidateWireIds([]);
      initialSelectedSymbolIdsRef.current = [];
      initialSelectedNoteIdsRef.current = [];
      initialSelectedWireIdsRef.current = [];
      panDragRef.current = null;
      entityDragRef.current = null;
      wireEndpointDragRef.current = null;
      noteResizeRef.current = null;
      setSelectionBox(null);
      setCursor(null);
    },
    [setButtonState, setCursor],
  );

  // Drag-and-Drop aus der Komponenten-Palette (mit Ghost-Vorschau) oder Projektdateien (.lcweb / .CircuitProject)
  const handleDragOver = React.useCallback(
    (event: React.DragEvent<SVGSVGElement>) => {
      event.preventDefault();

      const hasFiles =
        Array.from(event.dataTransfer?.types ?? []).includes("Files") ||
        (event.dataTransfer?.files?.length ?? 0) > 0;
      if (hasFiles) {
        event.dataTransfer.dropEffect = isSimulating ? "none" : "copy";
        setDragGhost(null);
        return;
      }

      // Subschaltungen, die einen Kreisbezug erzeugen würden, dürfen nicht abgelegt werden
      if (
        activePaletteDrag?.type === "subCircuit" &&
        activePaletteDrag.subCircuitId &&
        wouldCreateCircuitCycle(currentCircuit.logicalCircuitId, activePaletteDrag.subCircuitId, project)
      ) {
        event.dataTransfer.dropEffect = "none";
        setDragGhost(null);
        return;
      }

      event.dataTransfer.dropEffect = "copy";

      const container = containerRef.current;
      if (!container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const screenPoint: CanvasPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      const canvasPoint = screenToCanvas(screenPoint, viewport);
      const gridPoint = canvasToGrid(canvasPoint);

      if (activePaletteDrag) {
        setDragGhost({
          selection: activePaletteDrag,
          grid: gridPoint,
        });
      }
    },
    [
      activePaletteDrag,
      currentCircuit.logicalCircuitId,
      isSimulating,
      project,
      viewport,
    ],
  );

  const handleDragLeave = React.useCallback(
    () => {
      setDragGhost(null);
    },
    [],
  );

  const importDroppedFile = React.useCallback(
    async (file: File) => {
      if (!isSupportedProjectFile(file.name)) {
        setFileDropError(t("canvas.drop.invalidFileType"));
        return;
      }
      try {
        const rawText = await readProjectFileText(file);
        importProjectFromText(rawText, { fileName: file.name });
        setFileDropError(null);
      } catch (err) {
        setFileDropError(
          err instanceof Error
            ? err.message
            : t("canvas.drop.importFailed"),
        );
      }
    },
    [importProjectFromText, t],
  );

  const handleDrop = React.useCallback(
    (event: React.DragEvent<SVGSVGElement>) => {
      event.preventDefault();
      setDragGhost(null);

      if (isSimulating) {
        return;
      }

      if (floatingPasteRef.current !== null) {
        commitFloatingPaste();
      }

      const droppedFile = event.dataTransfer?.files?.[0];
      if (droppedFile) {
        if (!isSupportedProjectFile(droppedFile.name)) {
          setFileDropError(t("canvas.drop.invalidFileType"));
          return;
        }
        if (hasUnsavedChanges) {
          setPendingDroppedFile(droppedFile);
          return;
        }
        void importDroppedFile(droppedFile);
        return;
      }

      const container = containerRef.current;
      if (!container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const screenPoint: CanvasPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      const canvasPoint = screenToCanvas(screenPoint, viewport);
      const gridPoint = canvasToGrid(canvasPoint);

      try {
        const rawData = event.dataTransfer.getData("application/json");
        const selection: PaletteSelection | null = rawData ? JSON.parse(rawData) : activePaletteDrag;
        if (selection) {
          if (
            selection.type === "subCircuit" &&
            selection.subCircuitId &&
            wouldCreateCircuitCycle(currentCircuit.logicalCircuitId, selection.subCircuitId, project)
          ) {
            return;
          }

          if (selection.type === "textNote") {
            const newNote = addTextNote(t("palette.components.textNote"), gridPoint);
            selectEntities([], [newNote.textNoteId], false, []);
          } else {
            const newSymbol = addSymbol(selection, gridPoint);
            selectEntities([newSymbol.circuitSymbolId], [], false, []);
          }
        }
      } catch (err) {
        console.error("Drop-Fehler:", err);
      }
    },
    [
      activePaletteDrag,
      addSymbol,
      addTextNote,
      currentCircuit.logicalCircuitId,
      hasUnsavedChanges,
      importDroppedFile,
      isSimulating,
      project,
      selectEntities,
      t,
      viewport,
    ],
  );

  const openCanvasContextMenu = React.useCallback(
    (
      event: React.MouseEvent<Element>,
      buildTarget: (gridPoint: GridPoint) => CanvasContextTarget,
    ) => {
      event.preventDefault();
      event.stopPropagation();

      if (isSimulating || floatingPasteRef.current !== null || wirePledge !== null) {
        return;
      }

      const container = containerRef.current;
      let gridPoint: GridPoint = { x: 0, y: 0 };
      if (container) {
        const rect = container.getBoundingClientRect();
        const canvasPoint = screenToCanvas(
          { x: event.clientX - rect.left, y: event.clientY - rect.top },
          viewport,
        );
        gridPoint = canvasToGrid(canvasPoint);
      }

      const target = buildTarget(gridPoint);
      if (target.kind === "symbol" && !selectedSymbolIds.includes(target.symbol.circuitSymbolId)) {
        selectEntities([target.symbol.circuitSymbolId], [], false, []);
      } else if (target.kind === "textNote" && !selectedTextNoteIds.includes(target.textNote.textNoteId)) {
        selectEntities([], [target.textNote.textNoteId], false, []);
      } else if (target.kind === "wire" && !selectedWireIds.includes(target.wire.wireId)) {
        selectEntities([], [], false, [target.wire.wireId]);
      }

      setContextTarget(target);
    },
    [
      isSimulating,
      selectEntities,
      selectedSymbolIds,
      selectedTextNoteIds,
      selectedWireIds,
      viewport,
      wirePledge,
    ],
  );

  // Dynamischen Cursor festlegen
  const cursorStyle = React.useMemo(
    () => {
      if (wirePledge !== null || isDraggingWireEndpoint) {
        return "crosshair";
      }
      if (isResizingNote || isResizingSymbol) {
        return "crosshair";
      }
      if (isPanning) {
        return "grabbing";
      }
      if (isSpacePressed) {
        return "grab";
      }
      if (isMovingEntity) {
        return "move";
      }
      if (isSelecting) {
        return "crosshair";
      }
      if (hoveredPinInfo !== null) {
        return "crosshair";
      }
      return "default";
    },
    [
      hoveredPinInfo,
      isDraggingWireEndpoint,
      isMovingEntity,
      isPanning,
      isResizingNote,
      isResizingSymbol,
      isSelecting,
      isSpacePressed,
      wirePledge,
    ],
  );

  const ghostLayout = React.useMemo(
    () => {
      if (!dragGhost) {
        return null;
      }
      if (dragGhost.selection.type === "textNote") {
        return { gridWidth: 4, gridHeight: 1 };
      }
      const type = dragGhost.selection.type === "subCircuit" ? "and" : dragGhost.selection.type;
      return getComponentLayout(type, {
        inputCount: dragGhost.selection.inputCount ?? 2,
        rows: dragGhost.selection.rows,
        columns: dragGhost.selection.columns,
        matrixType: dragGhost.selection.matrixType,
        cellShape: dragGhost.selection.cellShape,
        bitWidth: dragGhost.selection.bitWidth,
        pinSide: dragGhost.selection.pinSide,
        color: dragGhost.selection.color,
        addressBitWidth: dragGhost.selection.addressBitWidth,
        dataBitWidth: dragGhost.selection.dataBitWidth,
        writeOn1: dragGhost.selection.writeOn1,
        dualPort: dragGhost.selection.dualPort,
      });
    },
    [dragGhost],
  );

  const handleStartFloatingDrag = React.useCallback(
    (event: React.PointerEvent<SVGElement>) => {
      if (event.button !== 0 || isSpacePressed || !floatingPasteRef.current) {
        return;
      }
      event.stopPropagation();
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const canvasPt = screenToCanvas(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        viewport,
      );
      floatingDragRef.current = {
        initialState: floatingPasteRef.current,
        startPointerGrid: canvasToGrid(canvasPt),
        hasMoved: false,
      };
      container.setPointerCapture(event.pointerId);
    },
    [isSpacePressed, viewport],
  );

  // Im Schwebemodus beim Pfeiltasten-Verschieben werden die betroffenen Original-Elemente (und Rubberband-Drähte) im Basis-Canvas ausgeblendet
  const hiddenMoveEntityIds = React.useMemo(
    () => {
      if (floatingPaste?.mode !== "move" || !floatingPaste.moveMeta) {
        return null;
      }
      const wireIds = new Set(floatingPaste.moveMeta.wireIds);
      if (floatingPaste.moveMeta.withWires) {
        for (const rb of floatingPaste.moveMeta.rubberbandPreviewWires) {
          wireIds.add(rb.wire.wireId);
        }
      }
      return {
        symbolIds: new Set(floatingPaste.moveMeta.symbolIds),
        noteIds: new Set(floatingPaste.moveMeta.textNoteIds),
        wireIds,
      };
    },
    [floatingPaste],
  );

  const visibleCanvasWires = React.useMemo(
    () => (
      hiddenMoveEntityIds
        ? wireValidation.wires.filter((w) => !hiddenMoveEntityIds.wireIds.has(w.wireId))
        : wireValidation.wires
    ),
    [hiddenMoveEntityIds, wireValidation.wires],
  );

  const visibleCanvasNotes = React.useMemo(
    () => (
      hiddenMoveEntityIds
        ? currentCircuit.textNotes.filter((n) => !hiddenMoveEntityIds.noteIds.has(n.textNoteId))
        : currentCircuit.textNotes
    ),
    [currentCircuit.textNotes, hiddenMoveEntityIds],
  );

  const visibleCanvasSymbols = React.useMemo(
    () => (
      hiddenMoveEntityIds
        ? currentCircuit.circuitSymbols.filter((s) => !hiddenMoveEntityIds.symbolIds.has(s.circuitSymbolId))
        : currentCircuit.circuitSymbols
    ),
    [currentCircuit.circuitSymbols, hiddenMoveEntityIds],
  );

  return (
    <main {...other} data-component="CircuitCanvas">
      <svg
        ref={containerRef}
        className="schematic-viewport"
        style={{ cursor: cursorStyle }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onContextMenu={(event) =>
          openCanvasContextMenu(event, (gridPoint) => ({
            kind: "canvas",
            gridPoint,
            screenX: event.clientX,
            screenY: event.clientY,
          }))
        }
      >
        <CanvasGrid panX={viewport.panX} panY={viewport.panY} zoom={viewport.zoom} />

        {/* Schaltungsinhalt im transformierten Koordinatensystem */}
        <g transform={`translate(${viewport.panX}, ${viewport.panY}) scale(${viewport.zoom})`}>
          {/* Dynamisch platzierte Leitungen (Wires) und Lötpunkte (Junctions) */}
          <g className="circuit-wires">
            {visibleCanvasWires.map((wire) => {
              let isSelected = false;
              let isCandidate = false;
              if (isSelecting) {
                if (isSelectingShift) {
                  isSelected = initialSelectedWireIdsRef.current.includes(wire.wireId);
                  isCandidate = candidateWireIds.includes(wire.wireId) && !isSelected;
                } else {
                  isSelected = false;
                  isCandidate = candidateWireIds.includes(wire.wireId);
                }
              } else {
                isSelected = selectedWireIds.includes(wire.wireId);
                isCandidate = false;
              }

              const isBad = Boolean(wire.markedBad);
              const isAiHighlighted = aiHighlightedIds?.wireIds.includes(wire.wireId) ?? false;
              const wireCleanUp = scopedCleanUpReport?.wireInfoById.get(wire.wireId);
              const isCleanUpUnused = Boolean(wireCleanUp && !wireCleanUp.isUsed);
              const isCleanUpPartial = Boolean(wireCleanUp?.isPartiallyUsed);
              let strokeColor = isBad
                ? "var(--color-logic-error)"
                : isSelected || isCandidate
                  ? "var(--color-accent-primary)"
                  : "var(--color-text-primary)";

              if (!isBad && !isSelected && !isCandidate && isSimulating) {
                const wireState = wireStateMap.get(wire.wireId);
                if (wireState === STATE_ON1) {
                  strokeColor = "var(--color-logic-high)";
                } else if (wireState === STATE_ON0) {
                  strokeColor = "var(--color-logic-low)";
                } else if (wireState === STATE_OFF) {
                  strokeColor = "var(--color-logic-undefined)";
                }
              }

              return (
                <g
                  key={wire.wireId}
                  className={`circuit-wire-group${isBad ? " wire-bad" : ""}${isSelected ? " wire-selected" : ""}`}
                  data-testid={`circuit-wire-${wire.wireId}`}
                  data-marked-bad={isBad ? "true" : "false"}
                  data-ai-highlighted={isAiHighlighted ? "true" : undefined}
                  data-cleanup-unused={isCleanUpUnused ? "true" : undefined}
                  data-cleanup-partial={isCleanUpPartial ? "true" : undefined}
                  data-cleanup-used-bits={isCleanUpPartial ? String(wireCleanUp?.usedBits ?? 0) : undefined}
                  data-cleanup-bit-width={isCleanUpPartial ? String(wireCleanUp?.bitWidth ?? 1) : undefined}
                >
                  {/* Dezente, zeitlich begrenzte Hervorhebung für von der KI verlegte oder angepasste Leitungen */}
                  {isAiHighlighted && (
                    <line
                      x1={wire.x1 * GRID_SIZE}
                      y1={wire.y1 * GRID_SIZE}
                      x2={wire.x2 * GRID_SIZE}
                      y2={wire.y2 * GRID_SIZE}
                      stroke="var(--color-ai-highlight)"
                      strokeWidth={5}
                      strokeLinecap="round"
                      opacity={0.42}
                      pointerEvents="none"
                      className="wire-ai-highlight"
                    />
                  )}
                  {/* Breiter unsichtbarer Klick-Korridor für komfortable Maus-Interaktion */}
                  <line
                    x1={wire.x1 * GRID_SIZE}
                    y1={wire.y1 * GRID_SIZE}
                    x2={wire.x2 * GRID_SIZE}
                    y2={wire.y2 * GRID_SIZE}
                    stroke="transparent"
                    strokeWidth={10}
                    strokeLinecap="round"
                    className="circuit-wire-hit"
                    onPointerDown={(e) => handleWirePointerDown(e, wire)}
                    onContextMenu={(event) =>
                      openCanvasContextMenu(event, (gridPoint) => ({
                        kind: "wire",
                        wire,
                        gridPoint,
                        screenX: event.clientX,
                        screenY: event.clientY,
                      }))
                    }
                  />
                  {/* Sichtbare Leitung */}
                  <line
                    x1={wire.x1 * GRID_SIZE}
                    y1={wire.y1 * GRID_SIZE}
                    x2={wire.x2 * GRID_SIZE}
                    y2={wire.y2 * GRID_SIZE}
                    stroke={strokeColor}
                    strokeWidth={isBad ? 2.2 : isSelected ? 2 : 1.5}
                    strokeLinecap="round"
                    opacity={isCleanUpUnused && !isSelected && !isCandidate ? CLEANUP_DIM_OPACITY : undefined}
                    pointerEvents="none"
                    className={`circuit-wire${isBad ? " circuit-wire-bad" : ""}`}
                  />
                  {/* Gestrichelte Auswahl-Markierung (WireMarker) bei ausgewählter oder vorausgewählter Leitung */}
                  {(isSelected || isCandidate) && (
                    <line
                      x1={wire.x1 * GRID_SIZE}
                      y1={wire.y1 * GRID_SIZE}
                      x2={wire.x2 * GRID_SIZE}
                      y2={wire.y2 * GRID_SIZE}
                      stroke="var(--color-accent-primary)"
                      strokeWidth={3.5}
                      strokeDasharray="3 3"
                      strokeLinecap="round"
                      opacity={isCandidate ? 0.55 : 0.85}
                      pointerEvents="none"
                      className="wire-selection-marker"
                    />
                  )}
                </g>
              );
            })}

            {/* Lötpunkte an T- und Kreuz-Abzweigungen mit mindestens 3 Segmenten (junctionPoints(3)) */}
            {wireValidation.conductorMap.junctionPoints.map((pt, idx) => {
              const isBadJunction = wireValidation.badPointKeys.has(gridPointKey(pt));
              const junctionConductor = wireValidation.conductorMap.byPointKey.get(gridPointKey(pt));
              let junctionFill = isBadJunction ? "var(--color-logic-error)" : "var(--color-text-primary)";

              if (isSimulating && !isBadJunction && junctionConductor && junctionConductor.wires.length > 0) {
                const wireState = wireStateMap.get(junctionConductor.wires[0].wireId);
                if (wireState === STATE_ON1) {
                  junctionFill = "var(--color-logic-high)";
                } else if (wireState === STATE_ON0) {
                  junctionFill = "var(--color-logic-low)";
                } else if (wireState === STATE_OFF) {
                  junctionFill = "var(--color-logic-undefined)";
                }
              }

              const isJunctionCleanUpUnused = Boolean(
                scopedCleanUpReport &&
                  junctionConductor &&
                  junctionConductor.wires.length > 0 &&
                  junctionConductor.wires.every((w) => {
                    const info = scopedCleanUpReport.wireInfoById.get(w.wireId);
                    return info ? !info.isUsed : false;
                  }),
              );

              return (
                <circle
                  key={`junction-${pt.x}-${pt.y}-${idx}`}
                  cx={pt.x * GRID_SIZE}
                  cy={pt.y * GRID_SIZE}
                  r={3.2}
                  fill={junctionFill}
                  opacity={isJunctionCleanUpUnused ? CLEANUP_DIM_OPACITY : undefined}
                  pointerEvents="none"
                  className={`circuit-wire-junction${isBadJunction ? " junction-bad" : ""}`}
                />
              );
            })}
          </g>

          {/* Dynamisch platzierte Textkommentare / Bereichsüberschriften */}
          {visibleCanvasNotes.map((note) => {
            let isSelected = false;
            let isCandidateSelected = false;

            if (isSelecting) {
              if (isSelectingShift) {
                isSelected = initialSelectedNoteIdsRef.current.includes(note.textNoteId);
                isCandidateSelected = candidateNoteIds.includes(note.textNoteId) && !isSelected;
              } else {
                isSelected = false;
                isCandidateSelected = candidateNoteIds.includes(note.textNoteId);
              }
            } else {
              isSelected = selectedTextNoteIds.includes(note.textNoteId);
              isCandidateSelected = false;
            }

            const isOnlySelected =
              isSelected &&
              selectedTextNoteIds.length === 1 &&
              selectedSymbolIds.length === 0 &&
              selectedWireIds.length === 0;

            return (
              <TextNoteView
                key={note.textNoteId}
                textNote={note}
                isSelected={isSelected}
                isCandidateSelected={isCandidateSelected}
                isOnlySelected={isOnlySelected}
                isAiHighlighted={aiHighlightedIds?.textNoteIds.includes(note.textNoteId) ?? false}
                onTextNotePointerDown={handleTextNotePointerDown}
                onTextNoteDoubleClick={() => handleOpenTextNoteEditor(note)}
                onResizeHandlePointerDown={handleResizeHandlePointerDown}
                onContextMenu={(event) =>
                  openCanvasContextMenu(event, (gridPoint) => ({
                    kind: "textNote",
                    textNote: note,
                    gridPoint,
                    screenX: event.clientX,
                    screenY: event.clientY,
                  }))
                }
              />
            );
          })}

          {/* Dynamisch platzierte Schaltungs-Bausteine */}
          {visibleCanvasSymbols.map((symbol) => {
            let isSelected = false;
            let isCandidateSelected = false;

            if (isSelecting) {
              if (isSelectingShift) {
                isSelected = initialSelectedSymbolIdsRef.current.includes(symbol.circuitSymbolId);
                isCandidateSelected = candidateSymbolIds.includes(symbol.circuitSymbolId) && !isSelected;
              } else {
                isSelected = false;
                isCandidateSelected = candidateSymbolIds.includes(symbol.circuitSymbolId);
              }
            } else {
              isSelected = selectedSymbolIds.includes(symbol.circuitSymbolId);
              isCandidateSelected = false;
            }

            const isOnlySelected =
              selectedSymbolIds.length === 1 &&
              selectedTextNoteIds.length === 0 &&
              selectedWireIds.length === 0;

            return (
              <CircuitSymbolView
                key={symbol.circuitSymbolId}
                symbol={symbol}
                isSelected={isSelected}
                isCandidateSelected={isCandidateSelected}
                isOnlySelected={isOnlySelected}
                isAiHighlighted={aiHighlightedIds?.symbolIds.includes(symbol.circuitSymbolId) ?? false}
                isCleanUpDimmed={scopedCleanUpReport?.unusedSymbolIds.has(symbol.circuitSymbolId) ?? false}
                onSymbolPointerDown={handleSymbolPointerDown}
                onSymbolDoubleClick={(event, sym) => {
                  if (isSimulating) {
                    dispatchSimulationSymbolDoubleClick({
                      symbol: sym,
                      target: event.target,
                      activeSimulationMap,
                      selectCircuitMap,
                      onOpenMemoryInspector: handleOpenMemoryInspector,
                    });
                    return;
                  }
                  if (sym.circuit.kind !== "logicalCircuit") {
                    handleOpenSymbolProperties(sym);
                  }
                }}
                onResizeHandlePointerDown={handleSymbolResizeHandlePointerDown}
                onContextMenu={(event) =>
                  openCanvasContextMenu(event, (gridPoint) => ({
                    kind: "symbol",
                    symbol,
                    gridPoint,
                    screenX: event.clientX,
                    screenY: event.clientY,
                  }))
                }
              />
            );
          })}

          {/* Endpunkt-Griffe (WirePointMarker) für alle aktuell ausgewählten Leitungen */}
          {!isSelecting && selectedWireIds.length > 0 && (
            <g className="wire-endpoint-markers">
              {visibleCanvasWires
                .filter((w) => selectedWireIds.includes(w.wireId))
                .map((wire) => (
                  <React.Fragment key={`markers-${wire.wireId}`}>
                    <circle
                      cx={wire.x1 * GRID_SIZE}
                      cy={wire.y1 * GRID_SIZE}
                      r={4.5}
                      className="wire-endpoint-handle"
                      data-testid={`wire-handle-${wire.wireId}-1`}
                      onPointerDown={(e) => handleWireEndpointPointerDown(e, wire, 1)}
                    />
                    <circle
                      cx={wire.x2 * GRID_SIZE}
                      cy={wire.y2 * GRID_SIZE}
                      r={4.5}
                      className="wire-endpoint-handle"
                      data-testid={`wire-handle-${wire.wireId}-2`}
                      onPointerDown={(e) => handleWireEndpointPointerDown(e, wire, 2)}
                    />
                  </React.Fragment>
                ))}
            </g>
          )}

          {/* Rote Fehler-Indikatorkreise direkt an den Fehlerstellen (Pins mit Bitbreiten-Konflikt) */}
          {wireValidation.errorIndicators.length > 0 && (
            <g className="wire-error-indicators">
              {wireValidation.errorIndicators.map((indicator) => (
                <g
                  key={`err-${indicator.symbolId}-${indicator.pinId}`}
                  className="wire-error-indicator"
                  data-testid={`wire-error-indicator-${indicator.symbolId}-${indicator.pinId}`}
                  pointerEvents="none"
                >
                  <title>{indicator.tooltip}</title>
                  <circle
                    cx={indicator.point.x * GRID_SIZE}
                    cy={indicator.point.y * GRID_SIZE}
                    r={7}
                    fill="rgba(248, 81, 73, 0.22)"
                    stroke="var(--color-logic-error)"
                    strokeWidth={1.8}
                    className="wire-error-ring"
                  />
                  <circle
                    cx={indicator.point.x * GRID_SIZE}
                    cy={indicator.point.y * GRID_SIZE}
                    r={2.8}
                    fill="var(--color-logic-error)"
                    className="wire-error-dot"
                  />
                </g>
              ))}
            </g>
          )}

          {/* Visueller Fang-Indikator beim Hovern über einen gültigen Pin (Jam) */}
          {hoveredPinInfo !== null && wirePledge === null && (
            <circle
              cx={hoveredPinInfo.point.x * GRID_SIZE}
              cy={hoveredPinInfo.point.y * GRID_SIZE}
              r={5.5}
              fill={hoveredPinInfo.isError ? "rgba(248, 81, 73, 0.25)" : "rgba(56, 139, 253, 0.22)"}
              stroke={hoveredPinInfo.isError ? "var(--color-logic-error)" : "var(--color-accent-primary)"}
              strokeWidth={1.5}
              pointerEvents="none"
              className="pin-hover-ring"
            />
          )}

          {/* Live-Vorschau beim Ziehen einer neuen Leitung (WirePledge) */}
          {wirePledge !== null && (
            <g className="wire-pledge-preview" pointerEvents="none">
              <line
                x1={wirePledge.startGrid.x * GRID_SIZE}
                y1={wirePledge.startGrid.y * GRID_SIZE}
                x2={wirePledge.currentGrid.x * GRID_SIZE}
                y2={wirePledge.currentGrid.y * GRID_SIZE}
                stroke="var(--color-accent-primary)"
                strokeWidth={2}
                strokeDasharray="4 2"
                strokeLinecap="round"
              />
              <circle
                cx={wirePledge.startGrid.x * GRID_SIZE}
                cy={wirePledge.startGrid.y * GRID_SIZE}
                r={3.5}
                fill="var(--color-accent-primary)"
              />
              <circle
                cx={wirePledge.currentGrid.x * GRID_SIZE}
                cy={wirePledge.currentGrid.y * GRID_SIZE}
                r={4}
                fill="rgba(56, 139, 253, 0.28)"
                stroke="var(--color-accent-primary)"
                strokeWidth={1.5}
              />
            </g>
          )}

          {/* Ghost-Vorschau beim Hineinziehen aus der Komponenten-Palette */}
          {dragGhost && ghostLayout && (
            <g
              transform={`translate(${dragGhost.grid.x * GRID_SIZE}, ${dragGhost.grid.y * GRID_SIZE})`}
              opacity={0.65}
              pointerEvents="none"
            >
              <rect
                x={-2}
                y={-2}
                width={(ghostLayout.gridWidth * GRID_SIZE) + 4}
                height={(ghostLayout.gridHeight * GRID_SIZE) + 4}
                rx={2}
                fill="rgba(56, 139, 253, 0.15)"
                stroke="var(--color-accent-primary)"
                strokeWidth={1.5}
                strokeDasharray="4 2"
              />
              {dragGhost.selection.type === "subCircuit" ? (
                <SubCircuitGlyph name={dragGhost.selection.name} />
              ) : dragGhost.selection.type === "textNote" ? (
                <text
                  x={8}
                  y={13}
                  fill="var(--color-text-primary)"
                  fontSize={12}
                  fontFamily="monospace"
                >
                  Text-Notiz
                </text>
              ) : (
                <SymbolRenderer
                  type={dragGhost.selection.type}
                  inputCount={dragGhost.selection.inputCount}
                  showPins={true}
                  name={dragGhost.selection.name}
                  notation={dragGhost.selection.notation}
                  isToggle={dragGhost.selection.isToggle}
                  pinSide={dragGhost.selection.pinSide}
                  color={dragGhost.selection.color}
                  rows={dragGhost.selection.rows}
                  columns={dragGhost.selection.columns}
                  matrixType={dragGhost.selection.matrixType}
                  cellShape={dragGhost.selection.cellShape}
                  addressBitWidth={dragGhost.selection.addressBitWidth}
                  dataBitWidth={dragGhost.selection.dataBitWidth}
                  writeOn1={dragGhost.selection.writeOn1}
                  dualPort={dragGhost.selection.dualPort}
                />
              )}
            </g>
          )}

          {/* Isolierte Overlay-Vorschau für den schwebenden Paste-Zustand (Floating Paste) */}
          <FloatingPasteLayer
            floatingPaste={floatingPaste}
            onStartFloatingDrag={handleStartFloatingDrag}
          />
        </g>

        {/* Auswahlrahmen auf Bildschirm-Ebene */}
        <SelectionBox box={selectionBox} />
      </svg>

      {/* Schwebender Pin- und Fehler-Tooltip beim Hovern über einen Jam / Fehlerpunkt */}
      {hoveredPinInfo !== null && (
        <div
          className={`pin-hover-tooltip${hoveredPinInfo.isError ? " is-error" : ""}`}
          data-testid="pin-hover-tooltip"
          style={{
            left: `${hoveredPinInfo.screenX + 12}px`,
            top: `${Math.max(8, hoveredPinInfo.screenY - 32)}px`,
          }}
        >
          {hoveredPinInfo.tooltip}
        </div>
      )}

      {/* Bearbeitungs-Modal für Text-Notizen */}
      <TextNoteModal
        isOpen={editingTextNote !== null}
        textNote={editingTextNote}
        onSave={(payload) => {
          if (editingTextNote) {
            updateTextNote(editingTextNote.textNoteId, {
              note: payload.note,
              fontFamily: payload.fontFamily,
              lineHeight: payload.lineHeight,
              lineHeights: payload.lineHeights,
            });
          }
        }}
        onClose={() => setEditingTextNote(null)}
      />

      {/* Fehlermeldung beim Datei-Import per Drag-and-Drop */}
      {fileDropError && (
        <div className="import-error-banner" role="alert">
          <span className="import-error-text">{fileDropError}</span>
          <button
            type="button"
            className="import-error-close"
            aria-label={t("canvas.drop.closeErrorAriaLabel")}
            onClick={() => setFileDropError(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* Hinweisbanner beim Einfügen von Nicht-XML-Text mit Konvertierungsoption zur Text-Notiz */}
      {clipboardNotice && (
        <div
          className="clipboard-notice-banner"
          role="status"
          data-testid="clipboard-notice-banner"
        >
          <span className="notice-text">{clipboardNotice.message}</span>
          {clipboardNotice.plainText && clipboardNotice.plainText.trim() !== "" && (
            <button
              type="button"
              className="notice-action-button"
              data-testid="paste-as-textnote-button"
              onClick={handleInsertPlainTextAsNote}
            >
              {t("canvas.clipboard.insertAsTextNote")}
            </button>
          )}
          <button
            type="button"
            className="notice-close-button"
            aria-label={t("canvas.clipboard.closeNoticeAriaLabel")}
            onClick={() => setClipboardNotice(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* Steuerungs- und Kollisionshinweis während des schwebenden Einfügens oder Verschiebens */}
      {floatingPaste && (
        <div
          className={`floating-paste-banner${floatingPaste.hasOverlapWarning ? " has-warning" : ""}`}
          role="status"
          data-testid="floating-paste-banner"
        >
          <span className="floating-info">
            {floatingPaste.hasOverlapWarning
              ? t("canvas.floating.overlapWarning")
              : floatingPaste.mode === "move"
                ? t("canvas.floating.moveInfo")
                : t("canvas.floating.pasteInfo")}
          </span>
          <div className="floating-actions">
            <button
              type="button"
              className="floating-btn"
              onClick={() => rotateFloatingPaste("clockwise")}
            >
              {t("canvas.floating.rotateButton")}
            </button>
            <button
              type="button"
              className="floating-btn primary"
              onClick={() => commitFloatingPaste()}
            >
              {t("canvas.floating.commitButton")}
            </button>
            <button
              type="button"
              className="floating-btn"
              onClick={cancelFloatingPaste}
            >
              {t("canvas.floating.cancelButton")}
            </button>
          </div>
        </div>
      )}

      {/* Zentraler Eigenschaftendialog für Bauteile und Schaltungs-Metadaten */}
      <PropertyDialog
        isOpen={editingSymbol !== null || editingCircuit !== null}
        symbol={editingSymbol}
        circuit={editingCircuit}
        onSaveSymbol={(symbolId, updates) => {
          updateCircuitSymbolProperties(symbolId, updates);
        }}
        onSaveCircuit={(circuitId, updates) => {
          updateCircuitProperties(circuitId, updates);
        }}
        onClose={() => {
          setEditingSymbol(null);
          setEditingCircuit(null);
        }}
      />

      {/* Live-Speicherinspektor beim Doppelklick auf RAM/ROM im Simulationsmodus */}
      <MemoryInspectorDialog
        isOpen={inspectingMemory !== null}
        symbol={inspectingMemory?.symbol ?? null}
        memoryInstanceId={inspectingMemory?.memoryInstanceId ?? null}
        circuitPath={inspectingMemory?.circuitPath}
        onClose={() => setInspectingMemory(null)}
      />

      {/* Sicherheitsabfrage beim Ablegen einer Projektdatei trotz ungespeicherter Änderungen */}
      <ConfirmDialog
        isOpen={pendingDroppedFile !== null}
        title={t("canvas.drop.confirmOpenTitle")}
        message={t("canvas.drop.confirmOpenMessage")}
        confirmLabel={t("header.confirmDiscardAndContinue")}
        isDanger={false}
        onConfirm={() => {
          const file = pendingDroppedFile;
          setPendingDroppedFile(null);
          if (file) {
            void importDroppedFile(file);
          }
        }}
        onCancel={() => setPendingDroppedFile(null)}
      />

      {/* Schwebende VS-Code-artige Projekt- und Schaltungssuche (Strg+F) */}
      <FindBar
        isOpen={isFindBarOpen && !isSimulating}
        focusSignal={findBarFocusSignal}
        project={project}
        currentCircuitId={currentCircuit.logicalCircuitId}
        onNavigateToResult={handleNavigateToFindResult}
        onClose={() => setIsFindBarOpen(false)}
      />

      {/* Kontextmenü für Canvas, Symbole, SubCircuits, Textnotizen und Leitungen */}
      <CanvasContextMenu
        target={contextTarget}
        selectedCount={selectedSymbolIds.length + selectedTextNoteIds.length + selectedWireIds.length}
        canPaste={hasClipboardContent}
        hasCircuitElements={
          currentCircuit.circuitSymbols.length > 0 ||
          currentCircuit.wires.length > 0 ||
          currentCircuit.textNotes.length > 0
        }
        canRotateSelection={selectedSymbolIds.length > 0 || selectedTextNoteIds.length > 0}
        onClose={() => setContextTarget(null)}
        onCut={() => {
          void cutSelectionToClipboard();
        }}
        onCopy={() => {
          void copySelectionToClipboard();
        }}
        onCopyForDesktop={() => {
          void copySelectionForDesktopToClipboard();
        }}
        onPasteAt={(gridPoint) => {
          void pasteFromClipboard(gridPoint);
        }}
        onDeleteSelected={() => {
          removeEntities(selectedSymbolIds, selectedTextNoteIds, selectedWireIds);
        }}
        onSelectAll={selectAllElements}
        onRotateRight={() => {
          rotateSelectedSymbols("clockwise", { withWires: true });
        }}
        onRotateLeft={() => {
          rotateSelectedSymbols("counterClockwise", { withWires: true });
        }}
        onOpenSubCircuit={(circuitId) => {
          setCurrentCircuitId(circuitId);
        }}
        onEditSymbol={handleOpenSymbolProperties}
        onEditTextNote={handleOpenTextNoteEditor}
        onEditCurrentCircuit={() => handleOpenCircuitProperties(currentCircuit)}
        onSelectConductor={(wireId) => selectConductor(wireId, "replace")}
        onSplitWire={(wireId, splitPoint) => splitWire(wireId, splitPoint)}
      />
    </main>
  );
})({
  flex: 1,
  position: "relative",
  overflow: "hidden",
  backgroundColor: "var(--color-grid-canvas)",

  "& > .schematic-viewport": {
    width: "100%",
    height: "100%",
    display: "block",
    touchAction: "none",
  },

  "& .circuit-wire-hit": {
    cursor: "pointer",
  },

  "& .circuit-wire": {
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
    strokeLinecap: "round",
  },

  "& .circuit-wire.circuit-wire-bad": {
    stroke: "var(--color-logic-error)",
    strokeWidth: 2.2,
  },

  "& .circuit-wire-junction": {
    fill: "var(--color-text-primary)",
  },

  "& .circuit-wire-junction.junction-bad": {
    fill: "var(--color-logic-error)",
  },

  "& .wire-endpoint-handle": {
    fill: "var(--color-bg-elevated)",
    stroke: "var(--color-accent-primary)",
    strokeWidth: 1.8,
    cursor: "grab",
    "&:hover": {
      fill: "var(--color-accent-primary)",
    },
  },

  "& .pin-hover-tooltip": {
    position: "absolute",
    zIndex: 30,
    pointerEvents: "none",
    backgroundColor: "var(--color-bg-elevated)",
    color: "var(--color-text-primary)",
    border: "1px solid var(--color-border-strong)",
    borderRadius: "0.25rem",
    padding: "0.25rem 0.5rem",
    fontSize: "0.75rem",
    fontFamily: "var(--font-family-base)",
    whiteSpace: "pre-line",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.35)",
  },

  "& .pin-hover-tooltip.is-error": {
    borderColor: "var(--color-logic-error)",
    backgroundColor: "var(--color-tooltip-error-bg)",
    color: "var(--color-error-text)",
  },

  "& > .import-error-banner": {
    position: "absolute",
    top: "0.75rem",
    right: "1rem",
    zIndex: 40,
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    maxWidth: "28rem",
    padding: "0.5rem 0.75rem",
    borderRadius: "0.375rem",
    backgroundColor: "var(--color-bg-elevated)",
    border: "1px solid var(--color-logic-error)",
    color: "var(--color-error-text)",
    fontSize: "0.8125rem",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.35)",

    "& > .import-error-text": {
      flex: 1,
      lineHeight: 1.4,
    },

    "& > .import-error-close": {
      background: "transparent",
      border: "none",
      color: "inherit",
      fontSize: "1rem",
      lineHeight: 1,
      cursor: "pointer",
      padding: "0 0.25rem",
    },
  },

  "& > .clipboard-notice-banner": {
    position: "absolute",
    top: "0.75rem",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 42,
    display: "flex",
    alignItems: "center",
    gap: "0.625rem",
    maxWidth: "38rem",
    padding: "0.5rem 0.75rem",
    borderRadius: "0.375rem",
    backgroundColor: "var(--color-bg-elevated)",
    border: "1px solid var(--color-accent-primary)",
    color: "var(--color-text-primary)",
    fontSize: "0.8125rem",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.35)",

    "& > .notice-text": {
      lineHeight: 1.4,
    },

    "& > .notice-action-button": {
      padding: "0.25rem 0.6rem",
      borderRadius: "0.25rem",
      border: "1px solid var(--color-accent-primary)",
      backgroundColor: "var(--color-accent-tint)",
      color: "var(--color-text-primary)",
      fontSize: "0.75rem",
      fontWeight: 600,
      cursor: "pointer",
      whiteSpace: "nowrap",

      "&:hover": {
        backgroundColor: "var(--color-accent-tint-strong)",
      },
    },

    "& > .notice-close-button": {
      background: "transparent",
      border: "none",
      color: "var(--color-text-secondary)",
      fontSize: "1rem",
      lineHeight: 1,
      cursor: "pointer",
      padding: "0 0.25rem",
    },
  },

  "& > .floating-paste-banner": {
    position: "absolute",
    bottom: "0.75rem",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 42,
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    maxWidth: "calc(100% - 2rem)",
    padding: "0.45rem 0.75rem",
    borderRadius: "0.375rem",
    backgroundColor: "var(--color-bg-elevated)",
    border: "1px solid var(--color-accent-primary)",
    color: "var(--color-text-primary)",
    fontSize: "0.78rem",
    boxShadow: "0 4px 14px rgba(0, 0, 0, 0.4)",

    "&.has-warning": {
      borderColor: "var(--color-logic-error)",
      color: "var(--color-error-text)",
    },

    "& > .floating-info": {
      lineHeight: 1.35,
    },

    "& > .floating-actions": {
      display: "flex",
      alignItems: "center",
      gap: "0.35rem",

      "& > .floating-btn": {
        padding: "0.2rem 0.5rem",
        borderRadius: "0.25rem",
        border: "1px solid var(--color-border-strong)",
        backgroundColor: "var(--color-bg-surface)",
        color: "var(--color-text-primary)",
        fontSize: "0.75rem",
        cursor: "pointer",
        whiteSpace: "nowrap",

        "&.primary": {
          borderColor: "var(--color-accent-primary)",
          backgroundColor: "var(--color-accent-tint)",
          fontWeight: 600,
        },

        "&:hover": {
          filter: "brightness(1.12)",
        },
      },
    },
  },
});

export default CircuitCanvas;
