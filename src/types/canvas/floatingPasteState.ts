import type FloatingMoveMeta from "./floatingMoveMeta";
import type GridPoint from "./gridPoint";
import type PreparedPastePayload from "../circuit/preparedPastePayload";

// Zustand des schwebenden Paste-/Verschiebe-Blocks vor endgültiger Platzierung auf dem Canvas
type FloatingPasteState = {
  mode?: "paste" | "move";
  payload: PreparedPastePayload;
  hasOverlapWarning: boolean;
  overlappingSymbolIds: string[];
  overlappingPoints: GridPoint[];
  moveMeta?: FloatingMoveMeta;
};

export default FloatingPasteState;
