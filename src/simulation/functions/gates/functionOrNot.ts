import { STATE_ON0, STATE_ON1 } from "../../../types/simulation/state";

import type CircuitState from "../../state/circuitState";
import CircuitFunction from "../circuitFunction";

// NOR-Gatterfunktion analog zu FunctionOrNot.cs
export class FunctionOrNot extends CircuitFunction {
  static create(circuitState: CircuitState, parameter: number[], result: number): FunctionOrNot {
    switch (parameter.length) {
      case 1:
        return new FunctionOrNot1(circuitState, parameter, result);
      case 2:
        return new FunctionOrNot2(circuitState, parameter, result);
      default:
        return new FunctionOrNotCommon(circuitState, parameter, result);
    }
  }

  constructor(circuitState: CircuitState, parameter: number[], result: number) {
    super(circuitState, parameter, [result]);
  }

  get reportName(): string {
    return `NOR (${this.parameterCount})`;
  }

  evaluate(): boolean {
    return this.setResult0(CircuitFunction.not(this.or()));
  }
}

class FunctionOrNotCommon extends FunctionOrNot {}

class FunctionOrNot1 extends FunctionOrNot {
  readonly #p0: number;

  constructor(circuitState: CircuitState, parameter: number[], result: number) {
    super(circuitState, parameter, result);
    this.#p0 = parameter[0];
  }

  evaluate(): boolean {
    return this.setResult0(
      this.circuitState.get(this.#p0) === STATE_ON1 ? STATE_ON0 : STATE_ON1,
    );
  }
}

class FunctionOrNot2 extends FunctionOrNot {
  readonly #p0: number;
  readonly #p1: number;

  constructor(circuitState: CircuitState, parameter: number[], result: number) {
    super(circuitState, parameter, result);
    this.#p0 = parameter[0];
    this.#p1 = parameter[1];
  }

  evaluate(): boolean {
    return this.setResult0(
      this.circuitState.get(this.#p0) === STATE_ON1 ||
        this.circuitState.get(this.#p1) === STATE_ON1
        ? STATE_ON0
        : STATE_ON1,
    );
  }
}

export default FunctionOrNot;
