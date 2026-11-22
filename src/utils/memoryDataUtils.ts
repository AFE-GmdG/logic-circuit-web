import type MemoryTextFormat from "../types/circuit/memoryTextFormat";

export const MEMORY_MIN_ADDRESS_BIT_WIDTH = 1;
export const MEMORY_MAX_ADDRESS_BIT_WIDTH = 16;
export const MEMORY_MIN_DATA_BIT_WIDTH = 1;
export const MEMORY_MAX_DATA_BIT_WIDTH = 32;

const BASE64_CHUNK_SIZE = 8192;

// Begrenzt die Adressbitbreite auf 1..16 Bit analog zu Memory.CheckAddressBitWidth
export function clampAddressBitWidth(value: number): number {
  const normalized = Number.isFinite(value) ? Math.trunc(value) : MEMORY_MIN_ADDRESS_BIT_WIDTH;
  return Math.max(MEMORY_MIN_ADDRESS_BIT_WIDTH, Math.min(MEMORY_MAX_ADDRESS_BIT_WIDTH, normalized));
}

// Begrenzt die Datenbitbreite auf 1..32 Bit analog zu Pin.MaxBitWidth
export function clampDataBitWidth(value: number): number {
  const normalized = Number.isFinite(value) ? Math.trunc(value) : MEMORY_MIN_DATA_BIT_WIDTH;
  return Math.max(MEMORY_MIN_DATA_BIT_WIDTH, Math.min(MEMORY_MAX_DATA_BIT_WIDTH, normalized));
}

// Berechnet die Byte-Anzahl je Speicherzelle analog zu Memory.BytesPerCellFor
export function bytesPerCellFor(dataBitWidth: number): number {
  const safeDataBits = clampDataBitWidth(dataBitWidth);
  return Math.ceil(safeDataBits / 8);
}

// Berechnet die Gesamtanzahl der Speicherzellen für eine Adressbitbreite analog zu Memory.NumberCellsFor
export function numberCellsFor(addressBitWidth: number): number {
  const normalized = Number.isFinite(addressBitWidth) ? Math.trunc(addressBitWidth) : MEMORY_MIN_ADDRESS_BIT_WIDTH;
  const safeBits = Math.max(MEMORY_MIN_ADDRESS_BIT_WIDTH, Math.min(22, normalized));
  return 1 << safeBits;
}

// Berechnet die gesamte Puffergröße in Bytes für RAM/ROM
export function totalBytesFor(addressBitWidth: number, dataBitWidth: number): number {
  return bytesPerCellFor(dataBitWidth) * numberCellsFor(addressBitWidth);
}

// Berechnet den vorzeichenlosen Maximalwert für eine Datenbitbreite (ohne 32-Bit-Sign-Overflow)
export function maxCellValueFor(dataBitWidth: number): number {
  const safeDataBits = clampDataBitWidth(dataBitWidth);
  return (0xffffffff >>> (32 - safeDataBits)) >>> 0;
}

// Maskiert einen Wert vorzeichenlos auf die konfigurierte Datenbitbreite (analog zu Constant.Normalize)
export function normalizeMemoryCellValue(value: number, dataBitWidth: number): number {
  return ((value >>> 0) & maxCellValueFor(dataBitWidth)) >>> 0;
}

// Liest einen vorzeichenlosen Zellenwert im Little-Endian-Format analog zu Memory.CellValue
export function getCellValue(data: Uint8Array, dataBitWidth: number, index: number): number {
  const cellSize = bytesPerCellFor(dataBitWidth);
  const cellStart = index * cellSize;
  if (cellStart < 0 || cellStart >= data.length) {
    return 0;
  }
  let value = 0;
  const available = Math.min(cellSize, data.length - cellStart);
  for (let i = 0; i < available; i++) {
    value = (value | ((data[cellStart + i] & 0xff) << (i * 8))) >>> 0;
  }
  return normalizeMemoryCellValue(value, dataBitWidth);
}

// Schreibt einen vorzeichenlosen Zellenwert im Little-Endian-Format analog zu Memory.SetCellValue
export function setCellValue(
  data: Uint8Array,
  dataBitWidth: number,
  index: number,
  value: number,
): void {
  const cellSize = bytesPerCellFor(dataBitWidth);
  const cellStart = index * cellSize;
  if (cellStart < 0 || cellStart + cellSize > data.length) {
    return;
  }
  const normalized = normalizeMemoryCellValue(value, dataBitWidth);
  for (let i = 0; i < cellSize; i++) {
    data[cellStart + i] = (normalized >>> (i * 8)) & 0xff;
  }
}

// Reallokiert bestehende Speicherdaten bei geänderter Adress- oder Datenbitbreite analog zu Memory.Reallocate
export function reallocateMemoryData(
  oldData: Uint8Array,
  oldAddressBitWidth: number,
  oldDataBitWidth: number,
  newAddressBitWidth: number,
  newDataBitWidth: number,
): Uint8Array {
  const safeOldAddr = clampAddressBitWidth(oldAddressBitWidth);
  const safeOldData = clampDataBitWidth(oldDataBitWidth);
  const safeNewAddr = clampAddressBitWidth(newAddressBitWidth);
  const safeNewData = clampDataBitWidth(newDataBitWidth);

  const expectedOldSize = totalBytesFor(safeOldAddr, safeOldData);
  const normalizedOld = new Uint8Array(expectedOldSize);
  normalizedOld.set(oldData.subarray(0, expectedOldSize));

  const nextBytes = new Uint8Array(totalBytesFor(safeNewAddr, safeNewData));
  const copyCount = Math.min(numberCellsFor(safeOldAddr), numberCellsFor(safeNewAddr));
  for (let i = 0; i < copyCount; i++) {
    setCellValue(nextBytes, safeNewData, i, getCellValue(normalizedOld, safeOldData, i));
  }
  return nextBytes;
}

// Dekodiert einen Base64-Speicherstring (inkl. Desktop-Zeilenumbrüchen) in ein exakt bemessenes Byte-Array
export function decodeMemoryData(
  base64: string,
  addressBitWidth: number,
  dataBitWidth: number,
): Uint8Array {
  const safeAddr = clampAddressBitWidth(addressBitWidth);
  const safeData = clampDataBitWidth(dataBitWidth);
  const target = new Uint8Array(totalBytesFor(safeAddr, safeData));
  const compact = base64.replace(/\s+/g, "");
  if (!compact) {
    return target;
  }

  try {
    const binary = atob(compact);
    const copyLen = Math.min(binary.length, target.length);
    for (let i = 0; i < copyLen; i++) {
      target[i] = binary.charCodeAt(i) & 0xff;
    }
  } catch {
    return target;
  }
  return target;
}

// Kodiert ein Byte-Array mit Trailing-Zero-Trimming als Base64 analog zu Memory.SetMemoryValue
export function encodeMemoryData(
  data: Uint8Array,
  addressBitWidth?: number,
  dataBitWidth?: number,
): string {
  const limit =
    addressBitWidth !== undefined && dataBitWidth !== undefined
      ? Math.min(data.length, totalBytesFor(addressBitWidth, dataBitWidth))
      : data.length;

  let lastNonZero = limit - 1;
  while (lastNonZero >= 0 && data[lastNonZero] === 0) {
    lastNonZero--;
  }
  if (lastNonZero < 0) {
    return "";
  }

  const parts: string[] = [];
  const length = lastNonZero + 1;
  for (let offset = 0; offset < length; offset += BASE64_CHUNK_SIZE) {
    const end = Math.min(length, offset + BASE64_CHUNK_SIZE);
    const slice = data.subarray(offset, end);
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(""));
}

// Vergleicht zwei Byte-Puffer exakt auf Inhaltsgleichheit
export function areByteArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

// Anzahl der Hexadezimalziffern zur Darstellung einer Bitbreite
export function hexDigitsFor(bitWidth: number): number {
  return Math.ceil(clampDataBitWidth(bitWidth) / 4);
}

// Anzahl der Binärziffern zur Darstellung einer Bitbreite
export function binDigitsFor(bitWidth: number): number {
  return clampDataBitWidth(bitWidth);
}

// Formatiert einen vorzeichenlosen Zellenwert für den Speicher-Editor und Text-Export
export function formatCellValue(
  value: number,
  dataBitWidth: number,
  format: MemoryTextFormat,
): string {
  const normalized = normalizeMemoryCellValue(value, dataBitWidth);
  if (format === "hex") {
    return normalized.toString(16).toUpperCase().padStart(hexDigitsFor(dataBitWidth), "0");
  }
  if (format === "bin") {
    return normalized.toString(2).padStart(binDigitsFor(dataBitWidth), "0");
  }
  return normalized.toString(10);
}

export type CellParseResult =
  | { ok: true; value: number }
  | { ok: false; errorKey: string; errorParams?: Record<string, string | number> };

// Validiert und parst die Benutzereingabe einer einzelnen Speicherzelle
export function parseCellInput(
  raw: string,
  dataBitWidth: number,
  format: MemoryTextFormat,
): CellParseResult {
  const safeBits = clampDataBitWidth(dataBitWidth);
  let clean = raw.trim();
  if (format === "hex" && (clean.startsWith("0x") || clean.startsWith("0X"))) {
    clean = clean.slice(2);
  } else if (format === "bin" && (clean.startsWith("0b") || clean.startsWith("0B"))) {
    clean = clean.slice(2);
  }

  const digitPattern =
    format === "hex"
      ? /^[0-9a-fA-F]+$/
      : format === "bin"
        ? /^[01]+$/
        : /^[0-9]+$/;

  if (!clean || !digitPattern.test(clean)) {
    return { ok: false, errorKey: "dialog.property.memoryErrorInvalidNumber" };
  }

  const radix = format === "hex" ? 16 : format === "bin" ? 2 : 10;
  const parsed = Number.parseInt(clean, radix);
  const maxValue = maxCellValueFor(safeBits);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > maxValue) {
    return {
      ok: false,
      errorKey: "dialog.property.memoryErrorOutOfRange",
      errorParams: {
        min: formatCellValue(0, safeBits, format),
        max: formatCellValue(maxValue, safeBits, format),
      },
    };
  }

  return { ok: true, value: parsed >>> 0 };
}

// Importiert beliebige Binärdaten zellenweise analog zu DialogMemoryEditor.ButtonLoadClick
export function importBinaryIntoMemory(
  bytes: Uint8Array,
  addressBitWidth: number,
  dataBitWidth: number,
): Uint8Array {
  const safeAddr = clampAddressBitWidth(addressBitWidth);
  const safeData = clampDataBitWidth(dataBitWidth);
  const cellSize = bytesPerCellFor(safeData);
  const cellCount = numberCellsFor(safeAddr);
  const result = new Uint8Array(cellSize * cellCount);

  for (let i = 0; i < cellCount; i++) {
    const start = i * cellSize;
    if (start >= bytes.length) {
      break;
    }
    const readCount = Math.min(cellSize, bytes.length - start);
    let value = 0;
    for (let b = 0; b < readCount; b++) {
      value = (value | ((bytes[start + b] & 0xff) << (b * 8))) >>> 0;
    }
    const effectiveBits = Math.min(8 * readCount, safeData);
    setCellValue(result, safeData, i, normalizeMemoryCellValue(value, effectiveBits));
  }

  return result;
}

// Exportiert die Speicherdaten als exakt bemessene Binärkopie
export function exportMemoryToBinary(
  data: Uint8Array,
  addressBitWidth: number,
  dataBitWidth: number,
  totalCells?: number,
): Uint8Array {
  const safeData = clampDataBitWidth(dataBitWidth);
  const cellCount = totalCells !== undefined
    ? Math.max(1, Math.trunc(totalCells))
    : numberCellsFor(addressBitWidth);
  const expectedSize = bytesPerCellFor(safeData) * cellCount;
  const out = new Uint8Array(expectedSize);
  out.set(data.subarray(0, expectedSize));
  return out;
}

export type TextMemoryImportResult =
  | { ok: true; data: Uint8Array; importedCells: number }
  | { ok: false; errorKey: string; errorParams: { line: number; position: number } };

function isWhitespaceOrSeparator(ch: string, skipSeparators: boolean): boolean {
  if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\v" || ch === "\f") {
    return true;
  }
  return skipSeparators && (ch === "," || ch === ";");
}

function isDigitForFormat(ch: string, format: MemoryTextFormat): boolean {
  if (format === "dec") {
    return ch >= "0" && ch <= "9";
  }
  if (format === "bin") {
    return ch === "0" || ch === "1";
  }
  return (
    (ch >= "0" && ch <= "9") ||
    (ch >= "a" && ch <= "f") ||
    (ch >= "A" && ch <= "F")
  );
}

// Importiert Zahlen aus einer Textdatei (Hex/Dec/Bin) analog zu DialogMemoryEditor.TextNumberReader
export function importTextIntoMemory(
  text: string,
  format: MemoryTextFormat,
  addressBitWidth: number,
  dataBitWidth: number,
): TextMemoryImportResult {
  const safeAddr = clampAddressBitWidth(addressBitWidth);
  const safeData = clampDataBitWidth(dataBitWidth);
  const cellCount = numberCellsFor(safeAddr);
  const result = new Uint8Array(totalBytesFor(safeAddr, safeData));

  let index = 0;
  let line = 1;
  let position = 0;

  const peek = (): string => (index < text.length ? text[index] : "");
  const advance = (): string => {
    if (index >= text.length) {
      return "";
    }
    const ch = text[index++];
    if (ch === "\n") {
      line++;
      position = 0;
    } else if (ch !== "\r") {
      position++;
    }
    return ch;
  };

  let importedCells = 0;

  while (importedCells < cellCount) {
    while (peek() !== "" && isWhitespaceOrSeparator(peek(), true)) {
      advance();
    }
    if (peek() === "") {
      break;
    }

    let sign = 1;
    if (peek() === "-") {
      sign = -1;
      advance();
      while (peek() !== "" && isWhitespaceOrSeparator(peek(), false)) {
        advance();
      }
    } else if (peek() === "+") {
      advance();
      while (peek() !== "" && isWhitespaceOrSeparator(peek(), false)) {
        advance();
      }
    }

    // Optionales 0x/0b-Präfix unterstützen, wenn dahinter eine gültige Ziffer folgt
    if (
      peek() === "0" &&
      index + 2 < text.length &&
      ((format === "hex" && (text[index + 1] === "x" || text[index + 1] === "X")) ||
        (format === "bin" && (text[index + 1] === "b" || text[index + 1] === "B"))) &&
      isDigitForFormat(text[index + 2], format)
    ) {
      advance();
      advance();
    }

    const base = format === "hex" ? 16 : format === "bin" ? 2 : 10;
    let magnitude = 0;
    let anyDigits = false;

    while (peek() !== "" && isDigitForFormat(peek(), format)) {
      anyDigits = true;
      const ch = advance();
      const digit = Number.parseInt(ch, base);
      magnitude = magnitude * base + digit;
      if (magnitude > 0xffffffff) {
        return {
          ok: false,
          errorKey: "dialog.property.memoryErrorTextBigNumber",
          errorParams: { line, position },
        };
      }
    }

    if (!anyDigits) {
      advance();
      return {
        ok: false,
        errorKey: "dialog.property.memoryErrorTextChar",
        errorParams: { line, position },
      };
    }

    if (peek() !== "" && !isWhitespaceOrSeparator(peek(), true)) {
      advance();
      return {
        ok: false,
        errorKey: "dialog.property.memoryErrorTextChar",
        errorParams: { line, position },
      };
    }

    const rawUnsigned = sign < 0 ? ((-magnitude) >>> 0) : (magnitude >>> 0);
    setCellValue(result, safeData, importedCells, rawUnsigned);
    importedCells++;
  }

  return { ok: true, data: result, importedCells };
}

// Formatiert Speicherdaten als zeilenweise getrennte Textausgabe (Hex, Dec oder Bin)
export function exportMemoryToText(
  data: Uint8Array,
  format: MemoryTextFormat,
  addressBitWidth: number,
  dataBitWidth: number,
  totalCells?: number,
): string {
  const safeAddr = clampAddressBitWidth(addressBitWidth);
  const safeData = clampDataBitWidth(dataBitWidth);
  const cellCount = totalCells !== undefined
    ? Math.max(1, Math.trunc(totalCells))
    : numberCellsFor(safeAddr);
  const cols = Math.min(16, cellCount);
  const lines: string[] = [];

  for (let rowStart = 0; rowStart < cellCount; rowStart += cols) {
    const rowValues: string[] = [];
    const rowEnd = Math.min(cellCount, rowStart + cols);
    for (let addr = rowStart; addr < rowEnd; addr++) {
      rowValues.push(formatCellValue(getCellValue(data, safeData, addr), safeData, format));
    }
    lines.push(rowValues.join(" "));
  }

  return lines.join("\n");
}
