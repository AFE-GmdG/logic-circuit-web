import type GraphicsArray from "../../../types/circuit/graphicsArray";
import type State from "../../../types/simulation/state";
import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../../../types/simulation/state";

import {
  clampGraphicsArrayBitsPerPixel,
  clampGraphicsArrayDataBitWidth,
  clampGraphicsArrayHeight,
  clampGraphicsArrayWidth,
  getGraphicsArrayStrides,
  normalizeGraphicsArrayOnStart,
  readGraphicsArrayCell,
  writeGraphicsArrayCell,
} from "../../../utils/graphicsArrayUtils";
import {
  bytesPerCellFor,
  normalizeMemoryCellValue,
  setCellValue,
} from "../../../utils/memoryDataUtils";

import type CircuitState from "../../state/circuitState";
import type { MemorySliceData } from "../../worker/workerMessages";
import CircuitFunction from "../circuitFunction";

// Simulationsfunktion für speicherabgebildete Grafikdisplays (GraphicsArray) analog zu FunctionGraphicsArray.cs
export class FunctionGraphicsArray extends CircuitFunction {
  readonly graphicsInstanceId: string;
  readonly graphicsArrayId: string;
  readonly graphicsArray: GraphicsArray;

  readonly #address: number[];
  readonly #inputData: number[];
  readonly #outputData: number[];
  readonly #write: number;
  readonly #writeOn: State;
  readonly #width: number;
  readonly #height: number;
  readonly #bitsPerPixel: number;
  readonly #dataBitWidth: number;
  readonly #addressBitWidth: number;
  readonly #memoryStride: number;
  readonly #bitmapStride: number;
  readonly #totalCells: number;
  readonly #data: Uint8Array;

  #oldWriteState: State = STATE_OFF;
  #revision = 1;

  constructor(
    circuitState: CircuitState,
    address: number[],
    inputData: number[],
    outputData: number[],
    write: number,
    graphicsArray: GraphicsArray,
    graphicsInstanceId: string,
  ) {
    super(
      circuitState,
      [...address, ...inputData, write],
      [...outputData],
    );
    this.#address = [...address];
    this.#inputData = [...inputData];
    this.#outputData = [...outputData];
    this.#write = write;
    this.graphicsArray = graphicsArray;
    this.graphicsArrayId = graphicsArray.graphicsArrayId ?? graphicsArray.circuitId;
    this.graphicsInstanceId = graphicsInstanceId;

    this.#width = clampGraphicsArrayWidth(graphicsArray.width);
    this.#height = clampGraphicsArrayHeight(graphicsArray.height);
    this.#bitsPerPixel = clampGraphicsArrayBitsPerPixel(graphicsArray.bitsPerPixel);
    this.#dataBitWidth = clampGraphicsArrayDataBitWidth(graphicsArray.dataBitWidth);
    this.#writeOn = graphicsArray.writeOn1 ? STATE_ON1 : STATE_ON0;

    const strides = getGraphicsArrayStrides(
      this.#dataBitWidth,
      this.#bitsPerPixel,
      this.#width,
      this.#height,
    );
    this.#memoryStride = strides.memoryStride;
    this.#bitmapStride = strides.bitmapStride;
    this.#totalCells = strides.totalCells;
    this.#addressBitWidth = strides.addressBitWidth;

    const vram = new Uint8Array(strides.totalBytes);
    const onStartMode = normalizeGraphicsArrayOnStart(graphicsArray.onStart);
    if (onStartMode === "ones") {
      vram.fill(0xff);
    } else if (onStartMode === "random") {
      for (let i = 0; i < vram.length; i++) {
        vram[i] = Math.floor(Math.random() * 256) & 0xff;
      }
    }
    this.#data = vram;
  }

  get width(): number {
    return this.#width;
  }

  get height(): number {
    return this.#height;
  }

  get bitsPerPixel(): number {
    return this.#bitsPerPixel;
  }

  get dataBitWidth(): number {
    return this.#dataBitWidth;
  }

  get addressBitWidth(): number {
    return this.#addressBitWidth;
  }

  get memoryStride(): number {
    return this.#memoryStride;
  }

  get bitmapStride(): number {
    return this.#bitmapStride;
  }

  get totalCells(): number {
    return this.#totalCells;
  }

  get writable(): boolean {
    return true;
  }

  get revision(): number {
    return this.#revision;
  }

  get reportName(): string {
    return `GraphicsArray ${this.#width}x${this.#height}`;
  }

  // Prüft flankengetriggert auf die konfigurierte Schreibflanke; STATE_OFF beim Einschalten verhindert Fehlschreiben
  #isWriteAllowed(): boolean {
    const state = this.circuitState.get(this.#write);
    const allowed = state === this.#writeOn && CircuitFunction.not(state) === this.#oldWriteState;
    this.#oldWriteState = state;
    return allowed;
  }

  evaluate(): boolean {
    const addr = this.readNumericState(this.#address) >>> 0;
    if (this.#isWriteAllowed()) {
      const value = this.readNumericState(this.#inputData) >>> 0;
      const changed = writeGraphicsArrayCell(
        this.#data,
        addr,
        value,
        this.#dataBitWidth,
        this.#memoryStride,
        this.#bitmapStride,
        this.#height,
      );
      if (changed) {
        this.#revision++;
      }
    }

    if (this.#outputData.length === 0) {
      return false;
    }

    const outVal = this.getCell(addr);
    return this.setResultValue(outVal);
  }

  getCell(address: number): number {
    if (!Number.isFinite(address)) {
      return 0;
    }
    const addr = Math.trunc(address);
    if (addr < 0 || addr >= this.#totalCells) {
      return 0;
    }
    return readGraphicsArrayCell(
      this.#data,
      addr,
      this.#dataBitWidth,
      this.#memoryStride,
      this.#bitmapStride,
      this.#height,
    );
  }

  // Aktualisiert eine VRAM-Zelle gezielt während pausierter Simulation und erhöht bei Änderung die Revision
  setCell(address: number, value: number): boolean {
    if (!Number.isFinite(address)) {
      return false;
    }
    const normalizedAddr = Math.trunc(address);
    if (normalizedAddr < 0 || normalizedAddr >= this.#totalCells) {
      return false;
    }
    const normalizedValue = normalizeMemoryCellValue(value, this.#dataBitWidth);
    const changed = writeGraphicsArrayCell(
      this.#data,
      normalizedAddr,
      normalizedValue,
      this.#dataBitWidth,
      this.#memoryStride,
      this.#bitmapStride,
      this.#height,
    );
    if (changed) {
      this.#revision++;
    }
    this.circuitState.markUpdated(this);
    return true;
  }

  // Konvertiert angeforderte VRAM-Zellen in ein Little-Endian-Slice für MemoryDataGrid und Dateiexport
  readSlice(startAddress: number, count: number): MemorySliceData {
    const safeStart = Number.isFinite(startAddress)
      ? Math.max(0, Math.min(this.#totalCells, Math.trunc(startAddress)))
      : 0;
    const rawCount = Number.isFinite(count) ? Math.trunc(count) : 0;
    const safeCount = Math.max(0, Math.min(this.#totalCells - safeStart, rawCount));
    const cellSize = bytesPerCellFor(this.#dataBitWidth);
    const bytes = new Uint8Array(safeCount * cellSize);

    for (let i = 0; i < safeCount; i++) {
      setCellValue(bytes, this.#dataBitWidth, i, this.getCell(safeStart + i));
    }

    return {
      memoryInstanceId: this.graphicsInstanceId,
      memoryId: this.graphicsArrayId,
      startAddress: safeStart,
      count: safeCount,
      totalCells: this.#totalCells,
      addressBitWidth: this.#addressBitWidth,
      dataBitWidth: this.#dataBitWidth,
      writable: true,
      revision: this.#revision,
      bytes,
    };
  }

  // Erstellt eine isolierte Kopie des VRAM-Puffers für Zero-Copy-Transferables zum Hauptthread
  copyVramBytes(): Uint8Array {
    return new Uint8Array(this.#data);
  }
}

export default FunctionGraphicsArray;
