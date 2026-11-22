import type McpCircuitActions from "./mcpCircuitActions";
import type McpSimulationActions from "./mcpSimulationActions";
import type CircuitProject from "../circuit/circuitProject";
import type LogicalCircuit from "../circuit/logicalCircuit";

// Momentaufnahme des Editor-Zustands (inkl. optionaler Context-Aktionen) für MCP-Werkzeuge
type McpCircuitSnapshot = {
  project: CircuitProject;
  currentCircuit: LogicalCircuit;
  selectedSymbolIds: string[];
  selectedTextNoteIds: string[];
  selectedWireIds?: string[];
  isSimulating?: boolean;
  actions?: McpCircuitActions;
  simulation?: McpSimulationActions;
};

export default McpCircuitSnapshot;
