import type Rotation from "./rotation";
import type TextNoteFontFamily from "./textNoteFontFamily";
import type TextNoteLineHeight from "./textNoteLineHeight";

// Textkommentar auf einem LogicalCircuit analog zu TextNote.cs
type TextNote = {
  textNoteId: string;
  logicalCircuitId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  note: string;
  rotation: Rotation;
  lineHeight?: TextNoteLineHeight;
  fontFamily?: TextNoteFontFamily;
  lineHeights?: TextNoteLineHeight[];
};

export default TextNote;
