import type CircuitMap from "../../simulation/compiler/circuitMap";
import type { SimulationSnapshot } from "../../simulation/worker/workerMessages";
import type FrameRateLimit from "../simulation/frameRateLimit";
import type SimulationError from "../simulation/simulationError";

// Synchron abfragbarer Momentzustand der laufenden Simulation für MCP-Werkzeuge
type McpSimulationStateSnapshot = {
  isSimulating: boolean;
  isPaused: boolean;
  isRunning: boolean;
  isOscillating: boolean;
  simulationError?: SimulationError | null;
  actualFrequency: number;
  frameRateLimit: FrameRateLimit;
  snapshot: SimulationSnapshot | null;
  rootCircuitMap: CircuitMap | null;
  selectedCircuitMap: CircuitMap | null;
};

export default McpSimulationStateSnapshot;
