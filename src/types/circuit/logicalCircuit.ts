import type Circuit from "./circuit";
import type CircuitShape from "./circuitShape";
import type CircuitSymbol from "./circuitSymbol";
import type ConductorMap from "./conductorMap";
import type DisplayMargin from "./displayMargin";
import type Pin from "./pin";
import type TextNote from "./textNote";
import type Wire from "./wire";

// Editierbarer Schaltplan und wiederverwendbarer Sub-Circuit-Baustein analog zu LogicalCircuit.cs
type LogicalCircuit = Circuit & {
  kind: "logicalCircuit";
  logicalCircuitId: string;
  circuitShape: CircuitShape;
  showLabelAbove?: boolean;
  displayMargin?: DisplayMargin;
  validators: string;
  exportToHDL: boolean;
  logicalPins: Pin[];
  circuitSymbols: CircuitSymbol[];
  wires: Wire[];
  textNotes: TextNote[];
  conductorMap?: ConductorMap;
};

export default LogicalCircuit;
