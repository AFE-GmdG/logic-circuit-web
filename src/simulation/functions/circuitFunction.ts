import type State from "../../types/simulation/state";
import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../../types/simulation/state";

import type CircuitState from "../state/circuitState";
import { stateFromBool } from "../state/stateConverters";

export const INT_MAX_VALUE = 2147483647;

// Abstrakte Basisklasse aller Simulationsfunktionen analog zu CircuitFunction.cs
export abstract class CircuitFunction {
  readonly parameter: number[];
  readonly result: number[];
  readonly result0: number;
  readonly circuitState: CircuitState;

  iteration = 0;
  dependent: CircuitFunction[] | null = null;

  constructor(
    circuitState: CircuitState,
    parameter: number[] | null,
    result: number[] | null,
  ) {
    this.circuitState = circuitState;
    this.parameter = parameter ?? [];
    this.result = result ?? [];
    this.result0 = this.result.length > 0 ? this.result[0] : -1;
    this.circuitState.defineFunction(this);
  }

  // Führt die Berechnungslogik der Funktion aus. Gibt true zurück, wenn sich mindestens ein Ausgangssignal geändert hat.
  abstract evaluate(): boolean;

  abstract get reportName(): string;

  get name(): string {
    return this.constructor.name;
  }

  get parameterCount(): number {
    return this.parameter.length;
  }

  get resultCount(): number {
    return this.result.length;
  }

  // Setzt das primäre Ausgangssignal (result0). Gibt true zurück, wenn sich der Wert geändert hat.
  protected setResult0(state: State): boolean {
    if (this.circuitState.get(this.result0) !== state) {
      this.circuitState.set(this.result0, state);
      return true;
    }
    return false;
  }

  // Setzt ein bestimmtes Ausgangssignal über den Ergebnisindex. Gibt true zurück, wenn sich der Wert geändert hat.
  protected setResult(index: number, state: State): boolean {
    const resIndex = this.result[index];
    if (this.circuitState.get(resIndex) !== state) {
      this.circuitState.set(resIndex, state);
      return true;
    }
    return false;
  }

  // Setzt ein Multi-Bit-Ergebnis anhand eines 32-Bit-Integerwertes (bitweises Maskieren).
  protected setResultValue(value: number): boolean {
    let changed = false;
    for (let i = 0; i < this.result.length; i++) {
      const bitState = (value & (1 << i)) !== 0 ? STATE_ON1 : STATE_ON0;
      if (this.setResult(i, bitState)) {
        changed = true;
      }
    }
    return changed;
  }

  // AND-Verknüpfung aller Parameter: Sobald ein Eingang Low (On0) ist -> Low; sonst High (On1).
  protected and(): State {
    for (let i = 0; i < this.parameter.length; i++) {
      if (this.circuitState.get(this.parameter[i]) === STATE_ON0) {
        return STATE_ON0;
      }
    }
    return STATE_ON1;
  }

  // OR-Verknüpfung aller Parameter: Sobald ein Eingang High (On1) ist -> High; sonst Low (On0).
  protected or(): State {
    for (let i = 0; i < this.parameter.length; i++) {
      if (this.circuitState.get(this.parameter[i]) === STATE_ON1) {
        return STATE_ON1;
      }
    }
    return STATE_ON0;
  }

  // Invertierung eines Signals: Off -> On0, On0 -> On1, On1 -> On0 (analog zu CircuitFunction.Not).
  static not(state: State): State {
    switch (state) {
      case STATE_OFF:
        return STATE_ON0;
      case STATE_ON0:
        return STATE_ON1;
      case STATE_ON1:
        return STATE_ON0;
      default:
        return STATE_ON0;
    }
  }

  // Zählt, wie viele Eingangsparameter den angegebenen State aufweisen.
  protected count(state: State): number {
    let matches = 0;
    for (let i = 0; i < this.parameter.length; i++) {
      if (this.circuitState.get(this.parameter[i]) === state) {
        matches++;
      }
    }
    return matches;
  }

  // Liefert den gesteuerten Zustand eines Tri-State-Treibers (parameter[0] = Daten, parameter[1] = Enable).
  protected controlledState(enable: State): State {
    return this.circuitState.get(this.parameter[1]) === enable
      ? this.circuitState.get(this.parameter[0])
      : STATE_OFF;
  }

  // Löst konkurrierende Tri-State-Signale auf (Priorität: On0 überstimmt On1, sonst On1, sonst Off).
  protected triStateGroup(): State {
    let resolvedState: State = STATE_OFF;
    for (let i = 0; i < this.parameter.length; i++) {
      const s = this.circuitState.get(this.parameter[i]);
      if (s === STATE_ON0) {
        return STATE_ON0;
      }
      if (s === STATE_ON1) {
        resolvedState = STATE_ON1;
      }
    }
    return resolvedState;
  }

  // Liest einen Multi-Bit-Bus als Zahl (bis zu 32 Bit).
  protected readNumericState(parameters: number[]): number {
    let numeric = 0;
    const len = Math.min(32, parameters.length);
    for (let i = 0; i < len; i++) {
      if (this.circuitState.get(parameters[i]) === STATE_ON1) {
        numeric |= 1 << i;
      }
    }
    return numeric;
  }

  static fromBool(value: boolean): State {
    return stateFromBool(value);
  }
}

export default CircuitFunction;
