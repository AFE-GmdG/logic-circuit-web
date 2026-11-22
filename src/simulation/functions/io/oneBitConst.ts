import type State from "../../../types/simulation/state";

import type CircuitState from "../../state/circuitState";
import CircuitFunction from "../circuitFunction";

// Konstante Bit-Signalquelle mit externer Aktualisierbarkeit analog zu OneBitConst.cs
export class OneBitConst extends CircuitFunction {
  #currentState: State;

  constructor(circuitState: CircuitState, initialState: State, result: number) {
    super(circuitState, null, [result]);
    this.#currentState = initialState;
  }

  get state(): State {
    return this.#currentState;
  }

  setState(newState: State): void {
    if (this.#currentState !== newState) {
      this.#currentState = newState;
      this.circuitState.markUpdated(this);
    }
  }

  get reportName(): string {
    return "OneBitConst";
  }

  evaluate(): boolean {
    return this.setResult0(this.#currentState);
  }
}

export default OneBitConst;
