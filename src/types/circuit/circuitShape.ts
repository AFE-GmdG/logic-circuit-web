// Darstellungsform einer LogicalCircuit als Sub-Circuit-Baustein analog zu CircuitShape.cs
type CircuitShape =
  | "rectangular"
  | "display"
  | "mux"
  | "demux"
  | "alu"
  | "flipFlop";

export default CircuitShape;
