import type CircuitShape from "./circuitShape";
import type DisplayMargin from "./displayMargin";

// Eingabe zur Erstellung einer neuen logischen Schaltung
type CreateCircuitInput = {
  name: string;
  notation?: string;
  category?: string;
  note?: string;
  circuitShape?: CircuitShape;
  showLabelAbove?: boolean;
  displayMargin?: DisplayMargin;
  exportToHDL?: boolean;
};

export default CreateCircuitInput;
