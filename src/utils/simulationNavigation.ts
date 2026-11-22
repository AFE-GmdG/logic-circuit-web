import type AiHighlightState from "../types/canvas/aiHighlightState";
import type GridPoint from "../types/canvas/gridPoint";
import type SimulationErrorLocation from "../types/simulation/simulationErrorLocation";

type SimulationNavigationParams = {
  location: SimulationErrorLocation;
  isSimulating: boolean;
  currentCircuitId?: string;
  stopSimulation?: () => void | Promise<void>;
  clearSimulationError?: () => void;
  setCurrentCircuitId?: (circuitId: string) => void;
  selectEntities?: (symbolIds: string[], textNoteIds: string[], additive?: boolean, wireIds?: string[]) => void;
  highlightAiElements?: (elements: Partial<AiHighlightState>, durationMs?: number) => void;
  focusGridPoint?: (point: GridPoint, circuitId?: string) => void;
};

// Beendet ggf. die Simulation und navigiert im Editor direkt zum fehlerauslösenden Bauteil
export function navigateToSimulationErrorLocation({
  location,
  isSimulating,
  currentCircuitId,
  stopSimulation,
  clearSimulationError,
  setCurrentCircuitId,
  selectEntities,
  highlightAiElements,
  focusGridPoint,
}: SimulationNavigationParams): void {
  if (isSimulating) {
    void stopSimulation?.();
  }
  clearSimulationError?.();

  if (location.circuitId && location.circuitId !== currentCircuitId) {
    setCurrentCircuitId?.(location.circuitId);
  }

  if (location.symbolId) {
    selectEntities?.([location.symbolId], [], false, []);
    highlightAiElements?.({ symbolIds: [location.symbolId] });
  }

  if (typeof location.x === "number" && typeof location.y === "number") {
    focusGridPoint?.({ x: location.x, y: location.y }, location.circuitId);
  }
}
