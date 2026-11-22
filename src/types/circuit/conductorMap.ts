import type Conductor from "./conductor";
import type GridPoint from "../canvas/gridPoint";

// Zuordnung von Rasterpunkten zu elektrischen Leitungsnetzen analog zu ConductorMap.cs
type ConductorMap = {
  conductors: Conductor[];
  byPointKey: Map<string, Conductor>;
  junctionPoints: GridPoint[];
};

export default ConductorMap;
