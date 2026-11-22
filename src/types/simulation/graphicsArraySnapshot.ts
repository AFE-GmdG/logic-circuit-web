// Live-Snapshot eines simulierten Grafischen Displays (VRAM optional bei unveränderter Revision)
type GraphicsArraySnapshot = {
  instanceId: string;
  graphicsArrayId: string;
  width: number;
  height: number;
  bitsPerPixel: number;
  bitmapStride: number;
  revision: number;
  vram?: Uint8Array;
};

export default GraphicsArraySnapshot;
