import type BasePin from "./basePin";

// Berechnetes Raster-Layout (Abmessungen und Pin-Koordinaten) eines Bauteils
type ComponentLayout = {
  gridWidth: number;
  gridHeight: number;
  pins: BasePin[];
};

export default ComponentLayout;
