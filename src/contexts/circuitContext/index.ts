import React from "react";

import type FloatingPasteState from "../../types/canvas/floatingPasteState";
import type GridPoint from "../../types/canvas/gridPoint";
import type AddEntitiesParams from "../../types/circuit/addEntitiesParams";
import type AddEntitiesResult from "../../types/circuit/addEntitiesResult";
import type CircuitProject from "../../types/circuit/circuitProject";
import type CircuitPropertiesUpdate from "../../types/circuit/circuitPropertiesUpdate";
import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type CircuitSymbolPropertiesUpdate from "../../types/circuit/circuitSymbolPropertiesUpdate";
import type CreateCircuitInput from "../../types/circuit/createCircuitInput";
import type DeleteCircuitsResult from "../../types/circuit/deleteCircuitsResult";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type MoveEntitiesParams from "../../types/circuit/moveEntitiesParams";
import type MoveEntitiesResult from "../../types/circuit/moveEntitiesResult";
import type PaletteSelection from "../../types/circuit/paletteSelection";
import type PreparedPastePayload from "../../types/circuit/preparedPastePayload";
import type ProjectPropertiesUpdate from "../../types/circuit/projectPropertiesUpdate";
import type RotationDirection from "../../types/circuit/rotationDirection";
import type TextNote from "../../types/circuit/textNote";
import type TextNoteFontFamily from "../../types/circuit/textNoteFontFamily";
import type TextNoteLineHeight from "../../types/circuit/textNoteLineHeight";
import type Wire from "../../types/circuit/wire";
import type { CollabSerializedMutation } from "../../types/collab/modelSyncMessage";
import type CircuitDelta from "../../types/history/circuitDelta";
import type HistoryState from "../../types/history/historyState";
import type AppSettings from "../../types/settings/appSettings";
import type { NativeLogicalCircuit } from "../../types/storage/nativeProjectFormat";

import type { FileSystemFileHandleLike } from "../../utils/fileSystemStorage";

export type CircuitProjectSnapshot = {
  project: CircuitProject;
  currentCircuitId: string;
  historiesByCircuit: Record<string, HistoryState>;
  hasUnsavedChanges: boolean;
  activeFileHandle: FileSystemFileHandleLike | null;
  activeFileName: string | null;
};

export type CircuitCollabSyncBridge = {
  canMutateProject: () => boolean;
  onLocalDeltaCommitted: (
    delta: CircuitDelta,
    projectAfterDelta: CircuitProject,
    options?: { importedSubCircuits?: readonly LogicalCircuit[] },
  ) => void;
  onLocalMutation: (mutation: CollabSerializedMutation) => void;
  onLocalProjectReplaced: (nextProject: CircuitProject) => void;
  isCollabUndoActive?: () => boolean;
  getCollabHistory?: (logicalCircuitId: string) => HistoryState;
  canCollabUndo?: (logicalCircuitId: string) => boolean;
  canCollabRedo?: (logicalCircuitId: string) => boolean;
  performCollabUndo?: (logicalCircuitId: string) => boolean;
  performCollabRedo?: (logicalCircuitId: string) => boolean;
  clearCollabHistory?: (logicalCircuitId: string) => void;
  subscribeUndoState?: (listener: () => void) => () => void;
};

type CircuitContextType = {
  project: CircuitProject;
  setProject: React.Dispatch<React.SetStateAction<CircuitProject>>;
  currentCircuit: LogicalCircuit;
  currentCircuitId: string;
  selectedSymbolIds: string[];
  selectedTextNoteIds: string[];
  selectedWireIds: string[];
  selectSymbol: (symbolId: string | null, multiSelect?: boolean) => void;
  selectTextNote: (textNoteId: string | null, multiSelect?: boolean) => void;
  selectWire: (wireId: string | null, multiSelect?: boolean) => void;
  selectSymbols: (symbolIds: string[], additive?: boolean) => void;
  selectTextNotes: (textNoteIds: string[], additive?: boolean) => void;
  selectWires: (wireIds: string[], additive?: boolean) => void;
  selectConductor: (wireId: string, mode?: "replace" | "add" | "toggle") => void;
  selectEntities: (
    symbolIds: string[],
    textNoteIds: string[],
    additive?: boolean,
    wireIds?: string[],
  ) => void;
  addSymbol: (selection: PaletteSelection, gridPoint: GridPoint) => CircuitSymbol;
  addTextNote: (
    note: string,
    gridPoint: GridPoint,
    options?: {
      lineHeight?: TextNoteLineHeight;
      fontFamily?: TextNoteFontFamily;
      lineHeights?: TextNoteLineHeight[];
    },
  ) => TextNote;
  addWire: (point1: GridPoint, point2: GridPoint) => Wire | null;
  addEntities: (params: AddEntitiesParams) => AddEntitiesResult;
  commitPastePayload: (payload: PreparedPastePayload) => AddEntitiesResult;
  splitWire: (wireId: string, splitPoint: GridPoint) => [Wire, Wire] | null;
  mergeWires: (wireId1: string, wireId2: string) => Wire | null;
  updateWiresLive: (
    updates: { wireId: string; x1: number; y1: number; x2: number; y2: number }[],
    removedWireIds?: string[],
  ) => void;
  updateTextNote: (
    textNoteId: string,
    updates: Partial<TextNote>,
    options?: { recordHistory?: boolean },
  ) => void;
  updateCircuitSymbolProperties: (
    symbolId: string,
    updates: CircuitSymbolPropertiesUpdate,
    options?: { x?: number; y?: number; withWires?: boolean },
  ) => CircuitSymbol | null;
  commitSimulatedMemoryData: (
    updates: ReadonlyArray<{ memoryId: string; data: string }>,
  ) => boolean;
  updateCircuitProperties: (
    circuitId: string,
    updates: CircuitPropertiesUpdate,
  ) => LogicalCircuit | null;
  resizeCircuitSymbol: (
    symbolId: string,
    params: { x: number; y: number; width: number; height: number },
    options?: { recordHistory?: boolean; withWires?: boolean },
  ) => CircuitSymbol | null;
  moveSymbol: (
    symbolId: string,
    gridPoint: GridPoint,
    options?: { recordHistory?: boolean; withWires?: boolean },
  ) => void;
  moveSymbols: (
    moves: { symbolId: string; gridPoint: GridPoint }[],
    options?: { recordHistory?: boolean; withWires?: boolean },
  ) => void;
  moveTextNotes: (
    moves: { textNoteId: string; gridPoint: GridPoint }[],
    options?: { recordHistory?: boolean },
  ) => void;
  moveEntities: (params: MoveEntitiesParams) => MoveEntitiesResult;
  commitFloatingMove?: (floatingState: FloatingPasteState) => void;
  rotateSymbol?: (symbolId: string, direction?: RotationDirection) => void;
  rotateSymbols: (
    symbolIds: string[],
    direction?: RotationDirection,
    textNoteIds?: string[],
    options?: { withWires?: boolean; wireIds?: string[] },
  ) => void;
  rotateSelectedSymbols: (
    direction?: RotationDirection,
    options?: { withWires?: boolean },
  ) => void;
  removeSymbol: (symbolId: string) => void;
  removeSymbols: (symbolIds: string[]) => void;
  removeTextNotes: (textNoteIds: string[]) => void;
  removeWires: (wireIds: string[]) => void;
  removeEntities: (symbolIds: string[], textNoteIds: string[], wireIds?: string[]) => void;
  history: HistoryState;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
  recordDelta: (
    delta: CircuitDelta,
    options?: { skipCollabSync?: boolean; importedSubCircuits?: readonly LogicalCircuit[] },
  ) => void;
  setCurrentCircuitId: (circuitId: string) => void;
  createCircuits: (circuits: CreateCircuitInput[]) => LogicalCircuit[];
  deleteCircuits: (circuitIds: string[]) => DeleteCircuitsResult;
  importLibraryCircuit?: (
    libraryCircuits: readonly NativeLogicalCircuit[],
    rootCircuitId: string,
    options?: {
      targetCircuitId?: string;
      gridPoint?: GridPoint;
      deduplicateRoot?: boolean;
    },
  ) => {
    rootCircuitId: string;
    addedCircuitIds: string[];
    reusedCircuitIds: string[];
    placedSymbol?: CircuitSymbol;
  };
  activePaletteDrag: PaletteSelection | null;
  setActivePaletteDrag: (selection: PaletteSelection | null) => void;
  loadProject: (
    nextProject: CircuitProject,
    fileMeta?: { handle?: FileSystemFileHandleLike | null; fileName?: string | null; suppressCollabSync?: boolean },
  ) => void;
  captureProjectSnapshot?: () => CircuitProjectSnapshot;
  restoreProjectSnapshot?: (
    snapshot: CircuitProjectSnapshot,
    options?: { suppressCollabSync?: boolean },
  ) => void;
  registerCollabSyncBridge?: (bridge: CircuitCollabSyncBridge | null) => void;
  applyRemoteProjectState?: (
    nextProject: CircuitProject,
    options?: { resetHistory?: boolean; preserveSelection?: boolean },
  ) => void;
  importProjectFromText: (
    rawText: string,
    fileMeta?: { handle?: FileSystemFileHandleLike | null; fileName?: string | null },
  ) => CircuitProject;
  importProjectFromXml: (
    xmlText: string,
    fileMeta?: { handle?: FileSystemFileHandleLike | null; fileName?: string | null },
  ) => CircuitProject;
  resetToDemoProject: () => void;
  resetToEmptyProject: () => void;
  updateProjectProperties: (updates: ProjectPropertiesUpdate) => void;
  hasUnsavedChanges: boolean;
  markProjectSaved: () => void;
  appSettings: AppSettings;
  updateAppSettings: (updates: Partial<AppSettings>) => AppSettings;
  isCleanUpVisualizationEnabled?: boolean;
  setCleanUpVisualizationEnabled?: (enabled: boolean) => void;
  toggleCleanUpVisualization?: () => void;
  activeFileHandle: FileSystemFileHandleLike | null;
  activeFileName: string | null;
  setActiveFileHandle: (handle: FileSystemFileHandleLike | null, fileName?: string | null) => void;
};

const CircuitContext = React.createContext<CircuitContextType>(undefined!);

export default CircuitContext;
