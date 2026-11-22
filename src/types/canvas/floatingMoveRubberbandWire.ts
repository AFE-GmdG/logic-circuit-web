import type Wire from "../circuit/wire";

type FloatingMoveRubberbandWire = {
  wire: Wire;
  movePoint1: boolean;
  movePoint2: boolean;
  point1OriginKey: string | null;
  point2OriginKey: string | null;
};

export default FloatingMoveRubberbandWire;
