import type CircuitSymbol from "./circuitSymbol";
import type PaletteSelection from "./paletteSelection";
import type Rotation from "./rotation";
import type TextNoteFontFamily from "./textNoteFontFamily";
import type TextNoteLineHeight from "./textNoteLineHeight";
import type GridPoint from "../canvas/gridPoint";

// Eingabeparameter zum gebündelten, atomaren Hinzufügen von Symbolen, Textnotizen und Leitungen
type AddEntitiesParams = {
  symbols?: { selection: PaletteSelection; gridPoint: GridPoint; ref?: string }[];
  textNotes?: {
    note: string;
    gridPoint: GridPoint;
    options?: {
      width?: number;
      height?: number;
      rotation?: Rotation;
      lineHeight?: TextNoteLineHeight;
      fontFamily?: TextNoteFontFamily;
      lineHeights?: TextNoteLineHeight[];
    };
  }[];
  wireSegments?: { point1: GridPoint; point2: GridPoint }[];
  resolveWires?: (
    placedSymbols: { ref?: string; symbol: CircuitSymbol }[],
  ) => { point1: GridPoint; point2: GridPoint }[];
};

export default AddEntitiesParams;
