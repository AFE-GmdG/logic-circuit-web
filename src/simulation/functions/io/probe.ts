import type ProbeFormat from "../../../types/circuit/probeFormat";
import type State from "../../../types/simulation/state";
import { STATE_OFF, STATE_ON1 } from "../../../types/simulation/state";

import type CircuitState from "../../state/circuitState";
import { stateToChar } from "../../state/stateConverters";
import CircuitFunction from "../circuitFunction";

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
    let value = 0;
    for (let i = 0; i < this.probeState.length; i++) {
      const s = this.probeState[i];
      if (s === STATE_OFF) {
        return null; // Mindestens ein Bit ist hochohmig
      }
      if (s === STATE_ON1) {
        value |= 1 << i;
      }
    }
    return value >>> 0;
  }

  // Textuelle Repräsentation (z. B. "0x1F", "31" oder "00011111")
  toText(showHexPrefix = true, format: ProbeFormat = "hex"): string {
    if (format === "bin") {
      return this.probeState
        .slice()
        .reverse()
        .map(stateToChar)
        .join("");
    }
    const num = this.toNumeric();
    if (num !== null) {
      if (format === "dec") {
        return String(num);
      }
      const hex = num.toString(16).toUpperCase();
      return showHexPrefix && this.bitWidth > 1 ? `0x${hex}` : hex;
    }
    // Bei hochohmigen Bits binäre Zeichenkette ausgeben (höherwertige Bits links)
    return this.probeState
      .slice()
      .reverse()
      .map(stateToChar)
      .join("");
  }
}

export default Probe;
