import type CircuitSymbol from "./circuitSymbol";
import type TextNote from "./textNote";
import type Wire from "./wire";

// Rückgabewert nach dem gebündelten Verschieben von Symbolen, Textnotizen und Leitungen
type MoveEntitiesResult = {
  symbols: CircuitSymbol[];
  textNotes: TextNote[];
  wires: Wire[];
  removedWireIds: string[];
};

export default MoveEntitiesResult;
