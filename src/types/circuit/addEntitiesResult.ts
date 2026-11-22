import type CircuitSymbol from "./circuitSymbol";
import type TextNote from "./textNote";
import type Wire from "./wire";

// Rückgabewert nach dem gebündelten Hinzufügen von Symbolen, Textnotizen und Leitungen
type AddEntitiesResult = {
  symbols: CircuitSymbol[];
  textNotes: TextNote[];
  wires: Wire[];
};

export default AddEntitiesResult;
