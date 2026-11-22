import type Wire from "./wire";
import type GridPoint from "../canvas/gridPoint";

// Elektrisches Leitungsnetz verbundener Wire-Segmente analog zu Conductor.cs
type Conductor = {
  wires: Wire[];
  points: GridPoint[];
  pointCounts: Map<string, number>;
  junctionPoints: GridPoint[];
};

export default Conductor;
