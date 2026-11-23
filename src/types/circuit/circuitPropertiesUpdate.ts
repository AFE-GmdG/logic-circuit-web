import type CircuitShape from "./circuitShape";
import type DisplayMargin from "./displayMargin";

// Aktualisierungs-Payload für Schaltungs-Metadaten im Eigenschaftendialog
type CircuitPropertiesUpdate = {
  name?: string;
  notation?: string;
  category?: string;
  note?: string;
  description?: string;
  circuitShape?: CircuitShape;
  showLabelAbove?: boolean;
  displayMargin?: DisplayMargin;
  exportToHDL?: boolean;
  validators?: string;
  pinOrder?: { pinId: string; index: number }[];
};

export default CircuitPropertiesUpdate;
