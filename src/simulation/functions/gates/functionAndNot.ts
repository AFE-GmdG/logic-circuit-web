import { STATE_ON0, STATE_ON1 } from "../../../types/simulation/state";

import type CircuitState from "../../state/circuitState";
import CircuitFunction from "../circuitFunction";

// NAND-Gatterfunktion analog zu FunctionAndNot.cs
export class FunctionAndNot extends CircuitFunction {
  static create(circuitState: CircuitState, parameter: number[], result: number): FunctionAndNot {
    switch (parameter.length) {
      case 1:
        return new FunctionAndNot1(circuitState, parameter, result);
      case 2:
        return new FunctionAndNot2(circuitState, parameter, result);
      default:
        return new FunctionAndNotCommon(circuitState, parameter, result);
    }
  }

  constructor(circuitState: CircuitState, parameter: number[], result: number) {
    super(circuitState, parameter, [result]);
  }

  get reportName(): string {
    return `NAND (${this.parameterCount})`;
  }

  evaluate(): boolean {
    return this.setResult0(CircuitFunction.not(this.and()));
  }
}

class FunctionAndNotCommon extends FunctionAndNot {}

class FunctionAndNot1 extends FunctionAndNot {
  readonly #p0: number;

  constructor(circuitState: CircuitState, parameter: number[], result: number) {
    super(circuitState, parameter, result);
    this.#p0 = parameter[0];
  }

  evaluate(): boolean {
    return this.setResult0(
      this.circuitState.get(this.#p0) === STATE_ON0 ? STATE_ON1 : STATE_ON0,
    );
  }
}

class FunctionAndNot2 extends FunctionAndNot {
  readonly #p0: number;
  readonly #p1: number;

  constructor(circuitState: CircuitState, parameter: number[], result: number) {
    super(circuitState, parameter, result);
    this.#p0 = parameter[0];
    this.#p1 = parameter[1];
  }

  evaluate(): boolean {
    return this.setResult0(
      this.circuitState.get(this.#p0) === STATE_ON0 ||
        this.circuitState.get(this.#p1) === STATE_ON0
        ? STATE_ON1
        : STATE_ON0,
    );
  }
}

export default FunctionAndNot;
