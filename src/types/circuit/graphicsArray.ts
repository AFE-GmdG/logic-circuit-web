import type Circuit from "./circuit";
import type MemoryOnStart from "./memoryOnStart";

// Grafikspeicher-Anzeigebaustein analog zu GraphicsArray.cs
type GraphicsArray = Circuit & {
  kind: "graphicsArray";
  graphicsArrayId: string;
  writeOn1: boolean;
  onStart: MemoryOnStart;
  dataBitWidth: number;
  bitsPerPixel: number;
  width: number;
  height: number;
  zoom: number;
};

export default GraphicsArray;
