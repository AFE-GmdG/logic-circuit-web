import type Memory from "../../../types/circuit/memory";
import type State from "../../../types/simulation/state";
import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../../../types/simulation/state";

import {
  bytesPerCellFor,
  decodeMemoryData,
  encodeMemoryData,
  getCellValue,
  normalizeMemoryCellValue,
  numberCellsFor,
  setCellValue,
  totalBytesFor,
} from "../../../utils/memoryDataUtils";

import type CircuitState from "../../state/circuitState";
import CircuitFunction from "../circuitFunction";

export type MemorySliceReadResult = {
  memoryInstanceId: string;
  memoryId: string;
  startAddress: number;
  count: number;
  totalCells: number;
  addressBitWidth: number;
  dataBitWidth: number;
  writable: boolean;
  revision: number;
  bytes: Uint8Array;
};

// Abstrakte Basisklasse für RAM- und ROM-Simulationsfunktionen analog zu FunctionMemory.cs
export abstract class FunctionMemory extends CircuitFunction {
  readonly memoryInstanceId: string;
  readonly memoryId: string;
  readonly memory: Memory;

  readonly #address: number[];
  readonly #address2: number[] | null;
  readonly #inputData: number[] | null;
  readonly #outputData: number[];
  readonly #outputData2: number[] | null;
  readonly #write: number;
  readonly #writeOn: State;
  readonly #data: Uint8Array;

  #oldWriteState: State = STATE_OFF;
  #revision = 0;

  static buildInput(
    address: number[],
    address2: number[] | null,
    inputData: number[] | null,
    write: number,
  ): number[] {
    if (address2 === null && inputData === null) {
      return [...address];
    }
    return [
      ...address,
      ...(address2 ?? []),
      ...(inputData !== null ? [...inputData, write] : []),
    ];
  }

  static buildOutput(outputData: number[], outputData2: number[] | null): number[] {
    if (outputData2 === null) {
      return [...outputData];
    }
    return [...outputData, ...outputData2];
  }

  constructor(
    circuitState: CircuitState,
    address: number[],
    inputData: number[] | null,
    outputData: number[],
    address2: number[] | null,
    outputData2: number[] | null,
    write: number,
    memory: Memory,
    memoryInstanceId: string,
  ) {
    super(
      circuitState,
      FunctionMemory.buildInput(address, address2, inputData, write),
      FunctionMemory.buildOutput(outputData, outputData2),
    );
    this.#address = address;
    this.#address2 = address2;
    this.#inputData = inputData;
    this.#outputData = outputData;
    this.#outputData2 = outputData2;
    this.memory = memory;
    this.memoryId = memory.memoryId;
    this.memoryInstanceId = memoryInstanceId;

    if (this.#inputData !== null) {
      this.#write = write;
      this.#writeOn = this.memory.writeOn1 ? STATE_ON1 : STATE_ON0;
      const byteLength = totalBytesFor(this.#address.length, this.#outputData.length);
      switch (this.memory.onStart) {
        case "random": {
          const randomBytes = new Uint8Array(byteLength);
          for (let i = 0; i < randomBytes.length; i++) {
            randomBytes[i] = Math.floor(Math.random() * 256) & 0xff;
          }
          this.#data = randomBytes;
          break;
        }
        case "zeros":
          this.#data = new Uint8Array(byteLength);
          break;
        case "ones":
          this.#data = new Uint8Array(byteLength).fill(0xff);
          break;
        case "data":
          this.#data = decodeMemoryData(
            this.memory.data,
            this.#address.length,
            this.#outputData.length,
          );
          break;
        default:
          this.#data = new Uint8Array(byteLength);
          break;
      }
    } else {
      this.#write = -1;
      this.#writeOn = STATE_OFF;
      this.#data = decodeMemoryData(
        this.memory.data,
        this.#address.length,
        this.#outputData.length,
      );
    }
  }

  get addressBitWidth(): number {
    return this.#address.length;
  }

  get dataBitWidth(): number {
    return this.#outputData.length;
  }

  get totalCells(): number {
    return numberCellsFor(this.addressBitWidth);
  }

  get writable(): boolean {
    return this.memory.writable;
  }

  get isPersistent(): boolean {
    return this.memory.writable && this.memory.onStart === "data";
  }

  get revision(): number {
    return this.#revision;
  }

  protected readUnsignedState(parameters: number[]): number {
    return this.readNumericState(parameters) >>> 0;
  }

  protected write(): void {
    if (!this.#inputData) {
      return;
    }
    const addr = this.readUnsignedState(this.#address);
    const value = normalizeMemoryCellValue(
      this.readUnsignedState(this.#inputData),
      this.dataBitWidth,
    );
    const prev = getCellValue(this.#data, this.dataBitWidth, addr);
    setCellValue(this.#data, this.dataBitWidth, addr, value);
    if (prev !== value) {
      this.#revision++;
    }
  }

  protected read(): boolean {
    const val1 = getCellValue(
      this.#data,
      this.dataBitWidth,
      this.readUnsignedState(this.#address),
    );
    if (this.#address2 === null || this.#outputData2 === null) {
      return this.setResultValue(val1);
    }

    let changed = false;
    for (let i = 0; i < this.#outputData.length; i++) {
      const bitState = ((val1 >>> i) & 1) !== 0 ? STATE_ON1 : STATE_ON0;
      if (this.setResult(i, bitState)) {
        changed = true;
      }
    }

    const val2 = getCellValue(
      this.#data,
      this.dataBitWidth,
      this.readUnsignedState(this.#address2),
    );
    for (let i = 0; i < this.#outputData2.length; i++) {
      const bitState = ((val2 >>> i) & 1) !== 0 ? STATE_ON1 : STATE_ON0;
      if (this.setResult(i + this.#outputData.length, bitState)) {
        changed = true;
      }
    }
    return changed;
  }

  // Prüft flankengetriggert auf die konfigurierte Schreibflanke; STATE_OFF beim Einschalten verhindert Fehlschreiben
  protected isWriteAllowed(): boolean {
    const state = this.circuitState.get(this.#write);
    const allowed = state === this.#writeOn && CircuitFunction.not(state) === this.#oldWriteState;
    this.#oldWriteState = state;
    return allowed;
  }

  getCell(address: number): number {
    return getCellValue(this.#data, this.dataBitWidth, address);
  }

  // Aktualisiert eine RAM-Zelle gezielt während pausierter Simulation und markiert die Funktion zur Auswertung
  setCell(address: number, value: number): boolean {
    if (!this.writable || address < 0 || address >= this.totalCells) {
      return false;
    }
    const next = normalizeMemoryCellValue(value, this.dataBitWidth);
    const prev = getCellValue(this.#data, this.dataBitWidth, address);
    setCellValue(this.#data, this.dataBitWidth, address, next);
    if (prev !== next) {
      this.#revision++;
    }
    this.circuitState.markUpdated(this);
    return true;
  }

  // Liefert eine isolierte Byte-Kopie des angeforderten Adressbereichs für den Transfer zum UI-Thread
  readSlice(startAddress: number, count: number): MemorySliceReadResult {
    const safeStart = Math.max(0, Math.min(this.totalCells, Math.trunc(startAddress)));
    const safeCount = Math.max(0, Math.min(this.totalCells - safeStart, Math.trunc(count)));
    const cellSize = bytesPerCellFor(this.dataBitWidth);
    const byteStart = safeStart * cellSize;
    const byteEnd = (safeStart + safeCount) * cellSize;
    const bytes = this.#data.slice(byteStart, byteEnd);
    return {
      memoryInstanceId: this.memoryInstanceId,
      memoryId: this.memoryId,
      startAddress: safeStart,
      count: safeCount,
      totalCells: this.totalCells,
      addressBitWidth: this.addressBitWidth,
      dataBitWidth: this.dataBitWidth,
      writable: this.writable,
      revision: this.#revision,
      bytes,
    };
  }

  exportEncodedData(): string {
    return encodeMemoryData(this.#data, this.addressBitWidth, this.dataBitWidth);
  }
}

export default FunctionMemory;
