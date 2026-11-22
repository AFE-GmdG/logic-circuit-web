import type GridPoint from "../canvas/gridPoint";

// Leitungssegment zwischen zwei Rasterpunkten auf einem LogicalCircuit analog zu Wire.cs
type Wire = {
  wireId: string;
  logicalCircuitId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  point1: GridPoint;
  point2: GridPoint;
  markedBad?: boolean;
};

export default Wire;
