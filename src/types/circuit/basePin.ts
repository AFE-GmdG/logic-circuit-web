import type PinSide from "./pinSide";
import type PinType from "./pinType";
import type GridPoint from "../canvas/gridPoint";

// Abstrakte Pin-Basisbeschreibung analog zu BasePin.cs
type BasePin = {
  pinId: string;
  circuitId: string;
  bitWidth: number;
  pinType: PinType;
  pinSide: PinSide;
  inverted: boolean;
  name: string;
  note: string;
  jamNotation: string;
  gridPoint: GridPoint;
};

export default BasePin;
