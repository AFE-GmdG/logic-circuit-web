import type CanvasPoint from "./canvasPoint";
import type GridPoint from "./gridPoint";

type CursorPosition = {
  grid: GridPoint;
  canvas: CanvasPoint;
};

export default CursorPosition;
