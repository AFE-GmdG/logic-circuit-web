import type CircuitDelta from "./circuitDelta";

// Zeigerbasierter Undo-/Redo-Stack
type HistoryState = {
  entries: CircuitDelta[];
  pointer: number;
};

export default HistoryState;
