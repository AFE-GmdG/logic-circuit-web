import type CircuitMap from "../../simulation/compiler/circuitMap";
import type {
  MemorySliceData,
  ScheduledButtonEvent,
  SimulationSnapshot,
} from "../../simulation/worker/workerMessages";
import type FrameRateLimit from "../simulation/frameRateLimit";

import type McpSimulationStateSnapshot from "./mcpSimulationStateSnapshot";
import type LogicalCircuit from "../circuit/logicalCircuit";

// Simulationssteuerungs-Aktionen aus SimulationContext für MCP-Werkzeuge
type McpSimulationActions = {
  getState: () => McpSimulationStateSnapshot;
  startSimulation: (targetCircuit?: LogicalCircuit) => Promise<SimulationSnapshot | null>;
  pauseSimulation: () => void;
  stopSimulation: () => Promise<void> | void;
  reset: () => Promise<void> | void;
  flushPersistentMemories?: () => Promise<boolean>;
  readMemorySlice?: (
    memoryInstanceId: string,
    startAddress: number,
    count: number,
  ) => Promise<MemorySliceData | null>;
  writeMemoryCell?: (memoryInstanceId: string, address: number, value: number) => Promise<boolean>;
  step: (
    steps?: number,
    targetCircuit?: LogicalCircuit,
    events?: ScheduledButtonEvent[],
  ) => Promise<{
    stepsCompleted: number;
    maxAppliedEventStep?: number;
    snapshot: SimulationSnapshot | null;
    rootCircuitMap: CircuitMap | null;
  } | null>;
  ensurePausedSimulation: (targetCircuit?: LogicalCircuit) => Promise<{
    snapshot: SimulationSnapshot;
    rootCircuitMap: CircuitMap;
  } | null>;
  setFrameRateLimit: (limit: FrameRateLimit) => void;
  selectCircuitMap: (map: CircuitMap) => void;
  setButtonState: (buttonId: string, pressed: boolean) => Promise<SimulationSnapshot | null>;
  toggleButton: (buttonId: string) => Promise<SimulationSnapshot | null>;
  pullSnapshot?: () => Promise<SimulationSnapshot | null>;
  waitForRender?: () => Promise<void>;
};

export default McpSimulationActions;
