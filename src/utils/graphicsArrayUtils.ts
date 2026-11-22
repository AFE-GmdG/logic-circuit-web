import type MemoryOnStart from "../types/circuit/memoryOnStart";

export const GRAPHICS_ARRAY_DATA_BIT_WIDTHS = [1, 2, 4, 8, 16, 32] as const;
export const GRAPHICS_ARRAY_BITS_PER_PIXEL = [1, 2, 4, 8] as const;
export const GRAPHICS_ARRAY_ON_START_MODES: readonly ("random" | "zeros" | "ones")[] = [
  "random",
  "zeros",
  "ones",
];

export const GRAPHICS_ARRAY_MIN_WIDTH = 1;
export const GRAPHICS_ARRAY_MAX_WIDTH = 640;
export const GRAPHICS_ARRAY_DEFAULT_WIDTH = 160;

export const GRAPHICS_ARRAY_MIN_HEIGHT = 1;
export const GRAPHICS_ARRAY_MAX_HEIGHT = 480;
export const GRAPHICS_ARRAY_DEFAULT_HEIGHT = 120;

export const GRAPHICS_ARRAY_MIN_ZOOM = 1;
export const GRAPHICS_ARRAY_MAX_ZOOM = 4;
export const GRAPHICS_ARRAY_DEFAULT_ZOOM = 1;

export const GRAPHICS_ARRAY_DEFAULT_DATA_BIT_WIDTH = 8;
export const GRAPHICS_ARRAY_DEFAULT_BITS_PER_PIXEL = 1;

// Kompakte Vorschau-Auflösung für die Komponenten-Palette analog zu GraphicsArrayDescriptor.cs
export const GRAPHICS_ARRAY_PREVIEW_WIDTH = 85;
export const GRAPHICS_ARRAY_PREVIEW_HEIGHT = 64;

export type GraphicsArrayStrides = {
  memoryStride: number;
  bitmapStride: number;
  totalCells: number;
  totalBytes: number;
  addressBitWidth: number;
};

// Rundet auf die nächste gültige Zweierpotenz bis 2^maxPower analog zu GraphicsArray.CheckPower2
export function clampPowerOfTwo(maxPower: number, value: number): number {
  let current = 1;
  for (let power = 0; power < maxPower; power++) {
    if (value <= current) {
      return current;
    }
    current <<= 1;
  }
  return current;
}

// Normalisiert die Datenbusbreite auf 1, 2, 4, 8, 16 oder 32 Bit analog zu GraphicsArray.CheckBitWidth
export function clampGraphicsArrayDataBitWidth(value: number): number {
  const truncated = Number.isFinite(value) ? Math.trunc(value) : GRAPHICS_ARRAY_DEFAULT_DATA_BIT_WIDTH;
  return clampPowerOfTwo(5, Math.max(1, truncated));
}

// Normalisiert die Farbtiefe auf 1, 2, 4 oder 8 Bit pro Pixel analog zu GraphicsArray.CheckBitsPerPixel
export function clampGraphicsArrayBitsPerPixel(value: number): number {
  const truncated = Number.isFinite(value) ? Math.trunc(value) : GRAPHICS_ARRAY_DEFAULT_BITS_PER_PIXEL;
  return clampPowerOfTwo(3, Math.max(1, truncated));
}

// Begrenzt die Pixel-Breite auf 1..640 analog zu GraphicsArray.CheckWidth
export function clampGraphicsArrayWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return GRAPHICS_ARRAY_DEFAULT_WIDTH;
  }
  return Math.max(GRAPHICS_ARRAY_MIN_WIDTH, Math.min(GRAPHICS_ARRAY_MAX_WIDTH, Math.trunc(value)));
}

// Begrenzt die Pixel-Höhe auf 1..480 analog zu GraphicsArray.CheckHeight
export function clampGraphicsArrayHeight(value: number): number {
  if (!Number.isFinite(value)) {
    return GRAPHICS_ARRAY_DEFAULT_HEIGHT;
  }
  return Math.max(GRAPHICS_ARRAY_MIN_HEIGHT, Math.min(GRAPHICS_ARRAY_MAX_HEIGHT, Math.trunc(value)));
}

// Begrenzt den Pixel-Zoom auf 1..4 analog zu GraphicsArray.CheckZoom
export function clampGraphicsArrayZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return GRAPHICS_ARRAY_DEFAULT_ZOOM;
  }
  return Math.max(GRAPHICS_ARRAY_MIN_ZOOM, Math.min(GRAPHICS_ARRAY_MAX_ZOOM, Math.trunc(value)));
}

// Normalisiert den Startmodus auf random, zeros oder ones analog zu GraphicsArray.CheckOnStart
export function normalizeGraphicsArrayOnStart(
  value: MemoryOnStart | undefined,
): "random" | "zeros" | "ones" {
  if (value === "random" || value === "ones") {
    return value;
  }
  return "zeros";
}

// Berechnet Speicher-Stride, Bitmap-Byte-Stride, Gesamtzellen und Adressbitbreite analog zu FunctionGraphicsArray.cs
export function getGraphicsArrayStrides(
  dataBitWidth: number,
  bitsPerPixel: number,
  width: number,
  height: number,
): GraphicsArrayStrides {
  const safeDataBits = clampGraphicsArrayDataBitWidth(dataBitWidth);
  const safeBpp = clampGraphicsArrayBitsPerPixel(bitsPerPixel);
  const safeW = clampGraphicsArrayWidth(width);
  const safeH = clampGraphicsArrayHeight(height);

  const rowBits = safeW * safeBpp;
  const memoryStride = Math.floor(rowBits / safeDataBits) + (rowBits % safeDataBits === 0 ? 0 : 1);
  const byteStride = Math.floor(rowBits / 8) + (rowBits % 8 === 0 ? 0 : 1);
  const bitmapStride = Math.max(byteStride * 8, memoryStride * safeDataBits) / 8;
  const totalCells = memoryStride * safeH;
  const totalBytes = bitmapStride * safeH;

  let bits = 0;
  let max = totalCells - 1;
  while (max > 0) {
    bits++;
    max >>= 1;
  }

  return {
    memoryStride,
    bitmapStride,
    totalCells,
    totalBytes,
    addressBitWidth: Math.max(1, bits),
  };
}

// Erkennt die Host-Byte-Reihenfolge für direkte 32-Bit-ImageData-Schreibzugriffe
const IS_LITTLE_ENDIAN = (() => {
  const probe = new Uint32Array([0x01020304]);
  const bytes = new Uint8Array(probe.buffer);
  return bytes[0] === 0x04;
})();

function packRgbaUint32(r: number, g: number, b: number, a = 255): number {
  if (IS_LITTLE_ENDIAN) {
    return (((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)) >>> 0;
  }
  return (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)) >>> 0;
}

// WPF BitmapPalettes.BlackAndWhite (1 bpp)
const PALETTE_1BPP_RGB: readonly number[] = [
  0x000000,
  0xffffff,
];

// WPF BitmapPalettes.Gray4 (2 bpp)
const PALETTE_2BPP_RGB: readonly number[] = [
  0x000000,
  0x555555,
  0xaaaaaa,
  0xffffff,
];

// WPF BitmapPalettes.Halftone8 (4 bpp, 16 Standardfarben)
const PALETTE_4BPP_RGB: readonly number[] = [
  0x000000,
  0x0000ff,
  0x00ff00,
  0x00ffff,
  0xff0000,
  0xff00ff,
  0xffff00,
  0xffffff,
  0xc0c0c0,
  0x808080,
  0x800000,
  0x008000,
  0x000080,
  0x808000,
  0x800080,
  0x008080,
];

// WPF BitmapPalettes.Halftone256 (8 bpp, RGB332)
const HALFTONE_3BIT_LEVELS = [0x00, 0x24, 0x49, 0x6d, 0x92, 0xb6, 0xdb, 0xff] as const;
const HALFTONE_2BIT_LEVELS = [0x00, 0x55, 0xaa, 0xff] as const;

const PALETTE_8BPP_RGB: readonly number[] = (() => {
  const entries: number[] = new Array(256);
  for (let i = 0; i < 256; i++) {
    const r = HALFTONE_3BIT_LEVELS[(i >>> 5) & 0x07];
    const g = HALFTONE_3BIT_LEVELS[(i >>> 2) & 0x07];
    const b = HALFTONE_2BIT_LEVELS[i & 0x03];
    entries[i] = ((r << 16) | (g << 8) | b) >>> 0;
  }
  return entries;
})();

function buildUint32Palette(rgbList: readonly number[]): Uint32Array {
  const lut = new Uint32Array(rgbList.length);
  for (let i = 0; i < rgbList.length; i++) {
    const rgb = rgbList[i];
    const r = (rgb >>> 16) & 0xff;
    const g = (rgb >>> 8) & 0xff;
    const b = rgb & 0xff;
    lut[i] = packRgbaUint32(r, g, b, 255);
  }
  return lut;
}

const PALETTE_1BPP_UINT32 = buildUint32Palette(PALETTE_1BPP_RGB);
const PALETTE_2BPP_UINT32 = buildUint32Palette(PALETTE_2BPP_RGB);
const PALETTE_4BPP_UINT32 = buildUint32Palette(PALETTE_4BPP_RGB);
const PALETTE_8BPP_UINT32 = buildUint32Palette(PALETTE_8BPP_RGB);

// Liefert die WPF-kompatible 24-Bit-RGB-Farbtabelle (0xRRGGBB) für 1, 2, 4 oder 8 Bit pro Pixel
export function getGraphicsArrayPaletteRgb(bitsPerPixel: number): readonly number[] {
  switch (clampGraphicsArrayBitsPerPixel(bitsPerPixel)) {
    case 1:
      return PALETTE_1BPP_RGB;
    case 2:
      return PALETTE_2BPP_RGB;
    case 4:
      return PALETTE_4BPP_RGB;
    case 8:
    default:
      return PALETTE_8BPP_RGB;
  }
}

// Liefert die vorkompilierte Endian-sichere 32-Bit-RGBA-Lookup-Tabelle für ImageData-Blitting
export function getGraphicsArrayPaletteUint32(bitsPerPixel: number): Uint32Array {
  switch (clampGraphicsArrayBitsPerPixel(bitsPerPixel)) {
    case 1:
      return PALETTE_1BPP_UINT32;
    case 2:
      return PALETTE_2BPP_UINT32;
    case 4:
      return PALETTE_4BPP_UINT32;
    case 8:
    default:
      return PALETTE_8BPP_UINT32;
  }
}

// Dekodiert einen VRAM-Bytepuffer (WPF Indexed1/2/4/8 MSB-first) per LUT in einen RGBA-Uint32Array-Bildpuffer
export function renderGraphicsVramToRgba(
  vram: Uint8Array,
  targetPixels32: Uint32Array,
  width: number,
  height: number,
  bitsPerPixel: number,
  bitmapStride: number,
): void {
  const safeBpp = clampGraphicsArrayBitsPerPixel(bitsPerPixel);
  const palette = getGraphicsArrayPaletteUint32(safeBpp);
  const pixelCount = Math.min(targetPixels32.length, width * height);
  if (pixelCount <= 0 || bitmapStride <= 0) {
    return;
  }

  for (let y = 0; y < height; y++) {
    const rowByteOffset = y * bitmapStride;
    const rowPixelOffset = y * width;

    if (safeBpp === 8) {
      for (let x = 0; x < width; x++) {
        const idx = vram[rowByteOffset + x] ?? 0;
        targetPixels32[rowPixelOffset + x] = palette[idx];
      }
    } else if (safeBpp === 4) {
      for (let x = 0; x < width; x++) {
        const byte = vram[rowByteOffset + (x >> 1)] ?? 0;
        const idx = (x & 1) === 0 ? (byte >>> 4) & 0x0f : byte & 0x0f;
        targetPixels32[rowPixelOffset + x] = palette[idx];
      }
    } else if (safeBpp === 2) {
      for (let x = 0; x < width; x++) {
        const byte = vram[rowByteOffset + (x >> 2)] ?? 0;
        const idx = (byte >>> (6 - (x & 3) * 2)) & 0x03;
        targetPixels32[rowPixelOffset + x] = palette[idx];
      }
    } else {
      for (let x = 0; x < width; x++) {
        const byte = vram[rowByteOffset + (x >> 3)] ?? 0;
        const idx = (byte >>> (7 - (x & 7))) & 0x01;
        targetPixels32[rowPixelOffset + x] = palette[idx];
      }
    }
  }
}

// Schreibt eine Daten-Zelle in den VRAM exakt nach FunctionGraphicsArray.Write (Big-Endian-Bitfolge innerhalb Scanline)
export function writeGraphicsArrayCell(
  vram: Uint8Array,
  address: number,
  value: number,
  dataBitWidth: number,
  memoryStride: number,
  bitmapStride: number,
  height: number,
): boolean {
  if (address < 0 || !Number.isFinite(address) || memoryStride <= 0 || bitmapStride <= 0) {
    return false;
  }
  const addr = Math.trunc(address);
  const row = Math.floor(addr / memoryStride);
  if (row >= height) {
    return false;
  }

  const safeDataBits = clampGraphicsArrayDataBitWidth(dataBitWidth);
  const cell = addr % memoryStride;
  let firstByte = row * bitmapStride + Math.floor((cell * safeDataBits) / 8);

  if (safeDataBits < 8) {
    if (firstByte >= vram.length) {
      return false;
    }
    const shift = (cell * safeDataBits) % 8;
    const bitOffset = 8 - shift - safeDataBits;
    const mask = ((1 << safeDataBits) - 1) << bitOffset;
    const prevByte = vram[firstByte];
    const nextByte = (((value << bitOffset) & mask) | (prevByte & ~mask)) & 0xff;
    vram[firstByte] = nextByte;
    return prevByte !== nextByte;
  }

  const count = safeDataBits / 8;
  firstByte += count - 1;
  if (firstByte >= vram.length || firstByte - (count - 1) < 0) {
    return false;
  }
  const unsignedVal = value >>> 0;
  let changed = false;
  for (let i = 0; i < count; i++) {
    const idx = firstByte - i;
    const nextByte = (unsignedVal >>> (i * 8)) & 0xff;
    if (vram[idx] !== nextByte) {
      changed = true;
    }
    vram[idx] = nextByte;
  }
  return changed;
}

// Liest eine Daten-Zelle aus dem VRAM exakt nach FunctionGraphicsArray.Read (vorzeichenlos)
export function readGraphicsArrayCell(
  vram: Uint8Array,
  address: number,
  dataBitWidth: number,
  memoryStride: number,
  bitmapStride: number,
  height: number,
): number {
  if (address < 0 || !Number.isFinite(address) || memoryStride <= 0 || bitmapStride <= 0) {
    return 0;
  }
  const addr = Math.trunc(address);
  const row = Math.floor(addr / memoryStride);
  if (row >= height) {
    return 0;
  }

  const safeDataBits = clampGraphicsArrayDataBitWidth(dataBitWidth);
  const cell = addr % memoryStride;
  let firstByte = row * bitmapStride + Math.floor((cell * safeDataBits) / 8);

  if (safeDataBits < 8) {
    if (firstByte >= vram.length) {
      return 0;
    }
    const shift = (cell * safeDataBits) % 8;
    const bitOffset = 8 - shift - safeDataBits;
    const mask = ((1 << safeDataBits) - 1) << bitOffset;
    return ((vram[firstByte] & mask) >>> bitOffset) >>> 0;
  }

  const count = safeDataBits / 8;
  firstByte += count - 1;
  if (firstByte >= vram.length || firstByte - (count - 1) < 0) {
    return 0;
  }
  let value = 0;
  for (let i = 0; i < count; i++) {
    value = (value | ((vram[firstByte - i] ?? 0) << (i * 8))) >>> 0;
  }
  return value >>> 0;
}
