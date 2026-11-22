import type BasePin from "./basePin";
import type PinType from "./pinType";
import type GridPoint from "../canvas/gridPoint";

// Konkreter Anschlusspunkt eines platzierten CircuitSymbol auf dem Raster analog zu Jam.cs
type Jam = {
  pin: BasePin;
  circuitSymbolId: string;
  x: number;
  y: number;
  z: number;
  effectivePinType: PinType;
  absolutePoint: GridPoint;
  innerJam?: Jam;
};

export default Jam;
