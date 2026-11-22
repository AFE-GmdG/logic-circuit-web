import type GridPoint from "../canvas/gridPoint";

// Beschreibt einen Fehler-Indikatorkreis an einem Pin mit Leitungs-Konflikt (Bitbreiten-Konflikt oder Mehrfach-Ausgang)
type WireErrorIndicator = {
  point: GridPoint;
  symbolId: string;
  pinId: string;
  pinName: string;
  pinBitWidth: number;
  conflictingBitWidths: number[];
  errorKind?: "bitWidthMismatch" | "multipleOutputs" | "both";
  tooltip: string;
};

export default WireErrorIndicator;
