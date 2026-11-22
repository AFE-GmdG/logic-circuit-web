import type Circuit from "./circuit";
import type Jam from "./jam";
import type Rotation from "./rotation";

// Platzierte Instanz eines Bauteils (Circuit) auf einem LogicalCircuit analog zu CircuitSymbol.cs
type CircuitSymbol = {
  circuitSymbolId: string;
  circuitId: string;
  logicalCircuitId: string;
  x: number;
  y: number;
  rotation: Rotation;
  circuit: Circuit;
  jams: Jam[];
};

export default CircuitSymbol;
