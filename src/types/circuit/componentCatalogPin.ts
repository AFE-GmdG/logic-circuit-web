import type PinSide from "./pinSide";
import type PinType from "./pinType";
import type GridPoint from "../canvas/gridPoint";

// Pin-Layout-Eintrag eines Bausteins im Komponenten-Katalog
type ComponentCatalogPin = {
  name: string;
  pinType: PinType;
  pinSide: PinSide;
  bitWidth: number;
  inverted: boolean;
  gridPoint: GridPoint;
};

export default ComponentCatalogPin;
