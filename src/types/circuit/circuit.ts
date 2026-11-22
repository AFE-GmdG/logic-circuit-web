import type BasePin from "./basePin";

// Basis-Eigenschaften aller platzierbaren Bauteile analog zu Circuit.cs
type Circuit = {
  kind?: string;
  circuitId: string;
  name: string;
  notation: string;
  note: string;
  category: string;
  isDisplay: boolean;
  symbolWidth: number;
  symbolHeight: number;
  pins: BasePin[];
};

export default Circuit;
