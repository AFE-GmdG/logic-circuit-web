import type FloatingMoveRubberbandWire from "./floatingMoveRubberbandWire";
import type CircuitSymbol from "../circuit/circuitSymbol";
import type RotationDirection from "../circuit/rotationDirection";
import type TextNote from "../circuit/textNote";
import type Wire from "../circuit/wire";

type FloatingMoveMeta = {
  symbolIds: string[];
  textNoteIds: string[];
  wireIds: string[];
  dx: number;
  dy: number;
  withWires: boolean;
  rotationSteps: number;
  lastRotationDirection?: RotationDirection;
  initialSymbols: CircuitSymbol[];
  initialNotes: TextNote[];
  initialWires: Wire[];
  rubberbandPreviewWires: FloatingMoveRubberbandWire[];
};

export default FloatingMoveMeta;
