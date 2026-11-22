import type AiHighlightState from "../canvas/aiHighlightState";
import type AddEntitiesParams from "../circuit/addEntitiesParams";
import type AddEntitiesResult from "../circuit/addEntitiesResult";
import type CircuitProject from "../circuit/circuitProject";
import type CircuitPropertiesUpdate from "../circuit/circuitPropertiesUpdate";
import type CircuitSymbol from "../circuit/circuitSymbol";
import type CircuitSymbolPropertiesUpdate from "../circuit/circuitSymbolPropertiesUpdate";
import type CreateCircuitInput from "../circuit/createCircuitInput";
import type DeleteCircuitsResult from "../circuit/deleteCircuitsResult";
import type LogicalCircuit from "../circuit/logicalCircuit";
import type MoveEntitiesParams from "../circuit/moveEntitiesParams";
import type MoveEntitiesResult from "../circuit/moveEntitiesResult";
import type RotationDirection from "../circuit/rotationDirection";
import type TextNote from "../circuit/textNote";

// Schreibende Editor-Aktionen aus CircuitContext und CanvasContext für MCP-Werkzeuge
type McpCircuitActions = {
  addEntities: (params: AddEntitiesParams) => AddEntitiesResult;
  moveEntities: (params: MoveEntitiesParams) => MoveEntitiesResult;
  rotateSymbols: (
    symbolIds: string[],
    direction?: RotationDirection,
    textNoteIds?: string[],
    options?: { withWires?: boolean; wireIds?: string[] },
  ) => void;
  removeEntities: (symbolIds: string[], textNoteIds: string[], wireIds?: string[]) => void;
  setCurrentCircuitId: (circuitId: string) => void;
  updateCircuitProperties: (circuitId: string, updates: CircuitPropertiesUpdate) => LogicalCircuit | null;
  updateCircuitSymbolProperties: (
    symbolId: string,
    updates: CircuitSymbolPropertiesUpdate,
    options?: { x?: number; y?: number; withWires?: boolean },
  ) => CircuitSymbol | null;
  resizeCircuitSymbol: (
    symbolId: string,
    params: { x: number; y: number; width: number; height: number },
    options?: { recordHistory?: boolean; withWires?: boolean },
  ) => CircuitSymbol | null;
  updateTextNote: (
    textNoteId: string,
    updates: Partial<TextNote>,
    options?: { recordHistory?: boolean },
  ) => void;
  createCircuits: (circuits: CreateCircuitInput[]) => LogicalCircuit[];
  deleteCircuits: (circuitIds: string[]) => DeleteCircuitsResult;
  getCurrentCircuit?: () => LogicalCircuit;
  getProject?: () => CircuitProject;
  highlightAiElements?: (elements: Partial<AiHighlightState>, durationMs?: number) => void;
};

export default McpCircuitActions;
