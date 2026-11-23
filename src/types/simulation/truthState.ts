import { stateToChar } from "../../simulation/state/stateConverters";

import type State from "./state";
import { STATE_OFF, STATE_ON1 } from "./state";

export type TruthTablePinInfo = {
  pinId: string;
  name: string;
  bitWidth: number;
  pinType: "input" | "output";
  inverted: boolean;
};

export type NonCombinationalReasonKind =
  | "feedbackLoop"
  | "ram"
  | "clock"
  | "sensor"
  | "button"
  | "graphicsArray";

export type NonCombinationalReason = {
  kind: NonCombinationalReasonKind;
  reportName: string;
  circuitId?: string;
  symbolId?: string;
  x?: number;
  y?: number;
};

export type CombinationalPurityAnalysis = {
  isPurelyCombinational: boolean;
  hasFeedbackLoops: boolean;
  hasStatefulComponents: boolean;
  reasons: NonCombinationalReason[];
};

export type TruthTableBuildOptions = {
  reportProgress?: (percent: number) => void;
  keepGoing?: () => boolean;
  include?: ((state: TruthState) => boolean) | null;
  maxCount?: number;
};

export type TruthTableBuildResult = {
  rows: TruthState[] | null;
  truncated: boolean;
  oscillation: boolean;
};

// Repräsentiert eine einzelne Zeile (Eingangs-/Ausgangs-Vektor) einer Wahrheitstabelle analog zu TruthState in C#
export class TruthState {
  readonly input: number[];
  readonly rawStates: State[][];
  output: number[] | null = null;
  bitWidths: number[] = [];

  constructor(inputCount: number, outputCount: number) {
    this.input = new Array<number>(inputCount).fill(0);
    this.rawStates = Array.from({ length: outputCount }, () => []);
  }

  // Entpackt die rohen Signalzustände in 32-Bit-Integer; gibt false zurück falls mindestens ein Ausgangs-Bit Off (Tri-State Z) ist
  unpack(bitWidthList?: number[]): boolean {
    const widths = bitWidthList ?? this.rawStates.map((bits) => bits.length);
    this.bitWidths = [...widths];
    const resolved = new Array<number>(this.rawStates.length);

    for (let i = 0; i < this.rawStates.length; i++) {
      const states = this.rawStates[i] ?? [];
      const width = widths[i] ?? states.length;
      let numeric = 0;
      for (let b = 0; b < width; b++) {
        const s = states[b] ?? STATE_OFF;
        if (s === STATE_OFF) {
          this.output = null;
          return false;
        }
        if (s === STATE_ON1) {
          numeric |= 1 << b;
        }
      }
      resolved[i] = numeric | 0;
    }

    this.output = resolved;
    return true;
  }

  // Initialisiert output mit Nullwerten, wenn die kompakte Darstellung für fehlerhafte/verkürzte Pfade benötigt wird
  shortcut(): void {
    if (this.output === null) {
      this.output = new Array<number>(this.rawStates.length).fill(0);
    }
  }

  formatInput(index: number): string {
    return ((this.input[index] ?? 0) >>> 0).toString(16).toUpperCase();
  }

  formatOutput(index: number): string {
    if (this.output !== null && this.output[index] !== undefined) {
      return (this.output[index] >>> 0).toString(16).toUpperCase();
    }

    const states = this.rawStates[index] ?? [];
    const width = this.bitWidths[index] ?? states.length;
    let hasOffBit = false;
    let numeric = 0;

    for (let b = 0; b < width; b++) {
      const s = states[b] ?? STATE_OFF;
      if (s === STATE_OFF) {
        hasOffBit = true;
        break;
      }
      if (s === STATE_ON1) {
        numeric |= 1 << b;
      }
    }

    if (!hasOffBit) {
      return (numeric >>> 0).toString(16).toUpperCase();
    }

    return states
      .slice(0, width)
      .reverse()
      .map(stateToChar)
      .join("");
  }

  equals(other: TruthState): boolean {
    if (this.output === null || other.output === null) {
      return false;
    }
    if (this.input.length !== other.input.length || this.output.length !== other.output.length) {
      return false;
    }
    for (let i = 0; i < this.input.length; i++) {
      if (this.input[i] !== other.input[i]) {
        return false;
      }
    }
    for (let i = 0; i < this.output.length; i++) {
      if (this.output[i] !== other.output[i]) {
        return false;
      }
    }
    return true;
  }

  static areEqual(a: readonly TruthState[], b: readonly TruthState[]): boolean {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!a[i]!.equals(b[i]!)) {
        return false;
      }
    }
    return true;
  }
}

export default TruthState;
