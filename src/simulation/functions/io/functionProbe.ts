import type ProbeFormat from "../../../types/circuit/probeFormat";
import type {
  OscilloscopeBusSample,
  OscilloscopeChannelSnapshot,
  ProbeHistoryEntry,
  ProbeHistorySnapshot,
} from "../../../types/simulation/oscilloscope";
import type State from "../../../types/simulation/state";
import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../../../types/simulation/state";

import Probe, { formatProbeStateArray } from "./probe";
import type CircuitState from "../../state/circuitState";

export type FunctionProbeOptions = {
  rawProbeId?: string;
  path?: string;
  capacity?: number;
};

type ValueHistoryItem =
  | { kind: "mark" }
  | { kind: "value"; packed: bigint; states: State[] };

// Fester Ringpuffer analog zu FunctionProbe.History<T> in C#
class RingBuffer<T> {
  readonly #items: (T | undefined)[];
  #head = 0;
  #full = false;

  constructor(capacity: number) {
    const normalized = Math.max(1, Math.trunc(capacity));
    this.#items = new Array<T | undefined>(normalized);
  }

  get capacity(): number {
    return this.#items.length;
  }

  get size(): number {
    return this.#full ? this.#items.length : this.#head;
  }

  add(item: T): void {
    this.#items[this.#head++] = item;
    if (this.#head >= this.#items.length) {
      this.#full = true;
      this.#head = 0;
    }
  }

  readChronological(): T[] {
    if (!this.#full) {
      const result: T[] = [];
      for (let i = 0; i < this.#head; i++) {
        result.push(this.#items[i] as T);
      }
      return result;
    }
    const len = this.#items.length;
    const result = new Array<T>(len);
    const tailCount = len - this.#head;
    for (let i = 0; i < tailCount; i++) {
      result[i] = this.#items[this.#head + i] as T;
    }
    for (let i = 0; i < this.#head; i++) {
      result[tailCount + i] = this.#items[i] as T;
    }
    return result;
  }

  clear(): void {
    this.#items.fill(undefined);
    this.#head = 0;
    this.#full = false;
  }
}

function buildBusSample(states: readonly State[]): OscilloscopeBusSample {
  const hexFormatted = formatProbeStateArray(states, "hex", true);
  const decFormatted = formatProbeStateArray(states, "dec", true);
  const binFormatted = formatProbeStateArray(states, "bin", true);
  return {
    states: [...states],
    numericValue: hexFormatted.numericValue,
    hasTriState: hexFormatted.hasTriState,
    textHex: hexFormatted.text,
    textDec: decFormatted.text,
    textBin: binFormatted.text,
  };
}

// Messfühler-Funktion (Probe) mit Verlaufs- und Oszilloskop-Ringpuffern analog zu FunctionProbe.cs
export class FunctionProbe extends Probe {
  readonly label: string;
  readonly probeId?: string;
  readonly rawProbeId: string;
  readonly path: string;
  readonly displayFormat: ProbeFormat;
  readonly capacity: number;
  readonly #tickHistory: RingBuffer<State>[];
  readonly #valueHistory: RingBuffer<ValueHistoryItem>;
  #lastAddedIsMark = false;

  constructor(
    circuitState: CircuitState,
    parameter: number[],
    label = "Probe",
    probeId?: string,
    displayFormat: ProbeFormat = "hex",
    options: FunctionProbeOptions = {},
  ) {
    super(circuitState, parameter);
    this.label = label;
    this.probeId = probeId;
    this.rawProbeId = options.rawProbeId ?? probeId ?? label;
    this.path = options.path ?? label;
    this.displayFormat = displayFormat;
    this.capacity = Math.max(1, Math.trunc(options.capacity ?? 100));

    this.#tickHistory = Array.from(
      { length: this.bitWidth },
      () => new RingBuffer<State>(this.capacity),
    );
    this.#valueHistory = new RingBuffer<ValueHistoryItem>(this.capacity);
    this.#recordCurrentValue();
  }

  get reportName(): string {
    return `Probe (${this.label}, ${this.bitWidth}-bit)`;
  }

  get markAllowed(): boolean {
    return !this.#lastAddedIsMark;
  }

  // Überschreibt updateState, damit jede Zustandsänderung automatisch in valueHistory protokolliert wird
  override updateState(): boolean {
    const changed = super.updateState();
    if (changed) {
      this.#recordCurrentValue();
    }
    return changed;
  }

  evaluate(): boolean {
    this.updateState();
    // Probes sind reine Senken und verändern niemals Ausgangssignale
    return false;
  }

  // Zeichnet die aktuellen Bit-Pegel als einen zeitlichen Oszilloskop-Abtastwert auf
  tick(): void {
    this.updateState();
    for (let i = 0; i < this.#tickHistory.length; i++) {
      this.#tickHistory[i].add(this.get(i));
    }
  }

  // Liest die aufgezeichneten Oszilloskop-Pegel eines einzelnen Bits in chronologischer Reihenfolge
  readBitHistory(bitNumber: number): State[] {
    const buffer = this.#tickHistory[bitNumber];
    return buffer ? buffer.readChronological() : [];
  }

  // Fügt eine visuelle Trennmarkierung in valueHistory ein, falls der letzte Eintrag keine Markierung ist
  mark(): boolean {
    if (!this.markAllowed) {
      return false;
    }
    this.#valueHistory.add({ kind: "mark" });
    this.#lastAddedIsMark = true;
    return true;
  }

  // Leert die Oszilloskop-Spuren aller Bits dieser Sonde
  clearTickHistory(): void {
    for (const buffer of this.#tickHistory) {
      buffer.clear();
    }
  }

  // Leert den Wertänderungsverlauf und erfasst den aktuellen Pegel als neuen Startwert
  clearValueHistory(): void {
    this.#valueHistory.clear();
    this.#recordCurrentValue();
  }

  // Kodiert alle Bits verlustfrei mit 2 Bits pro Leitung (BigInt unterstützt bis zu 32+ Bit)
  pack(): bigint {
    let packed = 0n;
    for (let i = 0; i < this.bitWidth; i++) {
      packed |= BigInt(this.get(i) & 0x03) << BigInt(2 * i);
    }
    return packed;
  }

  // Dekodiert ein einzelnes Bit aus einem gepackten Zustandswert
  unpack(packed: bigint, bitNumber: number): State {
    if (bitNumber < 0 || bitNumber >= this.bitWidth) {
      return STATE_OFF;
    }
    const raw = Number((packed >> BigInt(2 * bitNumber)) & 0x03n);
    if (raw === STATE_ON0 || raw === STATE_ON1) {
      return raw;
    }
    return STATE_OFF;
  }

  // Rekonstruiert einen vorzeichenlosen Integer aus dem gepackten Zustand (null bei Tri-State)
  static toNumericFromPacked(packed: bigint, bitWidth: number): number | null {
    let result = 0;
    for (let i = 0; i < bitWidth; i++) {
      const bit = Number((packed >> BigInt(2 * i)) & 0x03n);
      if (bit === STATE_OFF) {
        return null;
      }
      if (bit === STATE_ON1) {
        result |= 1 << i;
      }
    }
    return result >>> 0;
  }

  // Liefert den Verlaufs-Snapshot mit dem neuesten Eintrag an erster Stelle analog zu DialogProbeHistory.cs
  toHistorySnapshot(): ProbeHistorySnapshot {
    const chronological = this.#valueHistory.readChronological();
    const entries: ProbeHistoryEntry[] = [];
    for (let i = chronological.length - 1; i >= 0; i--) {
      const item = chronological[i];
      if (item.kind === "mark") {
        entries.push({ kind: "mark" });
      } else {
        const sample = buildBusSample(item.states);
        entries.push({
          kind: "value",
          packed: item.packed.toString(),
          states: sample.states,
          numericValue: sample.numericValue,
          textHex: sample.textHex,
          textDec: sample.textDec,
          textBin: sample.textBin,
        });
      }
    }

    return {
      probeId: this.probeId ?? this.rawProbeId,
      rawProbeId: this.rawProbeId,
      label: this.label,
      path: this.path,
      bitWidth: this.bitWidth,
      displayFormat: this.displayFormat,
      markAllowed: this.markAllowed,
      entries,
    };
  }

  // Liefert alle aufgezeichneten Oszilloskop-Samples als Einzelbit-Spuren und Bus-Blöcke
  toOscilloscopeChannel(): OscilloscopeChannelSnapshot {
    const bitTraces = this.#tickHistory.map((buf) => buf.readChronological());
    const sampleCount = bitTraces.length > 0 ? bitTraces[0].length : 0;
    const busSamples: OscilloscopeBusSample[] = new Array<OscilloscopeBusSample>(sampleCount);

    for (let s = 0; s < sampleCount; s++) {
      const states = new Array<State>(this.bitWidth);
      for (let b = 0; b < this.bitWidth; b++) {
        states[b] = bitTraces[b][s] ?? STATE_OFF;
      }
      busSamples[s] = buildBusSample(states);
    }

    return {
      probeId: this.probeId ?? this.rawProbeId,
      rawProbeId: this.rawProbeId,
      label: this.label,
      path: this.path,
      bitWidth: this.bitWidth,
      displayFormat: this.displayFormat,
      sampleCount,
      bitTraces,
      busSamples,
    };
  }

  #recordCurrentValue(): void {
    this.#valueHistory.add({
      kind: "value",
      packed: this.pack(),
      states: [...this.probeState],
    });
    this.#lastAddedIsMark = false;
  }
}

export default FunctionProbe;
