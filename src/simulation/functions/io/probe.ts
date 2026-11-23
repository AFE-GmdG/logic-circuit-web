import type ProbeFormat from "../../../types/circuit/probeFormat";
import type State from "../../../types/simulation/state";
import { STATE_OFF, STATE_ON1 } from "../../../types/simulation/state";

import type CircuitState from "../../state/circuitState";
import { stateToChar } from "../../state/stateConverters";
import CircuitFunction from "../circuitFunction";

export type FormattedProbeValue = {
  numericValue: number | null;
  hasTriState: boolean;
  text: string;
};

// Berechnet den vorzeichenlosen numerischen Wert eines Bitvektors (null bei Tri-State)
export function statesToNumeric(states: readonly State[]): number | null {
  let value = 0;
  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    if (s === STATE_OFF) {
      return null;
    }
    if (s === STATE_ON1) {
      value |= 1 << i;
    }
  }
  return value >>> 0;
}

// Formatiert ein Bit-Array konsistent als Binär-, Dezimal- oder Hexadezimalwert (MSB links)
export function formatProbeStateArray(
  states: readonly State[],
  format: ProbeFormat = "hex",
  showHexPrefix = true,
): FormattedProbeValue {
  const binaryText = states
    .slice()
    .reverse()
    .map(stateToChar)
    .join("");
  const numericValue = statesToNumeric(states);
  const hasTriState = numericValue === null;

  if (format === "bin" || numericValue === null) {
    return {
      numericValue,
      hasTriState,
      text: binaryText,
    };
  }

  if (format === "dec") {
    return {
      numericValue,
      hasTriState: false,
      text: String(numericValue),
    };
  }

  const hex = numericValue.toString(16).toUpperCase();
  return {
    numericValue,
    hasTriState: false,
    text: showHexPrefix && states.length > 1 ? `0x${hex}` : hex,
  };
}

// Abstrakte Basisklasse für Mess- und Anzeige-Elemente analog zu Probe.cs
export abstract class Probe extends CircuitFunction {
  protected readonly probeState: State[];

  constructor(circuitState: CircuitState, parameter: number[]) {
    super(circuitState, parameter, null);
    this.probeState = new Array(parameter.length).fill(STATE_OFF);
  }

  get bitWidth(): number {
    return this.probeState.length;
  }

  get(index: number): State {
    return this.probeState[index] ?? STATE_OFF;
  }

  // Liest die aktuellen Zustände der Eingangsparameter in den internen Cache
  updateState(): boolean {
    let changed = false;
    for (let i = 0; i < this.parameter.length; i++) {
      const current = this.circuitState.get(this.parameter[i]);
      if (this.probeState[i] !== current) {
        this.probeState[i] = current;
        changed = true;
      }
    }
    return changed;
  }

  // Liefert den numerischen Wert (falls keine Tri-State-Signale anliegen)
  toNumeric(): number | null {
    return statesToNumeric(this.probeState);
  }

  // Textuelle Repräsentation (z. B. "0x1F", "31" oder "00011111")
  toText(showHexPrefix = true, format: ProbeFormat = "hex"): string {
    return formatProbeStateArray(this.probeState, format, showHexPrefix).text;
  }
}

export default Probe;
