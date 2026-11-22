import { STATE_ON0, STATE_ON1 } from "../../../types/simulation/state";

import type CircuitState from "../../state/circuitState";
import CircuitFunction from "../circuitFunction";

// AND-Gatterfunktion analog zu FunctionAnd.cs
export class FunctionAnd extends CircuitFunction {
  static create(circuitState: CircuitState, parameter: number[], result: number): FunctionAnd {
    switch (parameter.length) {
      case 1:
        return new FunctionAnd1(circuitState, parameter, result);
      case 2:
        return new FunctionAnd2(circuitState, parameter, result);
      case 3:
        return new FunctionAnd3(circuitState, parameter, result);
      case 4:
        return new FunctionAnd4(circuitState, parameter, result);
      default:
        return new FunctionAndCommon(circuitState, parameter, result);
    }
  }

  constructor(circuitState: CircuitState, parameter: number[], result: number) {
    super(circuitState, parameter, [result]);
  }

  get reportName(): string {
    return `AND (${this.parameterCount})`;
  }

  evaluate(): boolean {
    return this.setResult0(this.and());
  }
}

class FunctionAndCommon extends FunctionAnd {}

class FunctionAnd1 extends FunctionAnd {
  readonly #p0: number;

  constructor(circuitState: CircuitState, parameter: number[], result: number) {
    super(circuitState, parameter, result);
    this.#p0 = parameter[0];
  }

  evaluate(): boolean {
    return this.setResult0(
      this.circuitState.get(this.#p0) === STATE_ON0 ? STATE_ON0 : STATE_ON1,
    );
  }
}

class FunctionAnd2 extends FunctionAnd {
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
        ? STATE_ON0
        : STATE_ON1,
    );
  }
}

class FunctionAnd3 extends FunctionAnd {
  readonly #p0: number;
  readonly #p1: number;
  readonly #p2: number;

  constructor(circuitState: CircuitState, parameter: number[], result: number) {
    super(circuitState, parameter, result);
    this.#p0 = parameter[0];
    this.#p1 = parameter[1];
    this.#p2 = parameter[2];
  }

  evaluate(): boolean {
    return this.setResult0(
      this.circuitState.get(this.#p0) === STATE_ON0 ||
        this.circuitState.get(this.#p1) === STATE_ON0 ||
        this.circuitState.get(this.#p2) === STATE_ON0
        ? STATE_ON0
        : STATE_ON1,
    );
  }
}

class FunctionAnd4 extends FunctionAnd {
  readonly #p0: number;
  readonly #p1: number;
  readonly #p2: number;
  readonly #p3: number;

  constructor(circuitState: CircuitState, parameter: number[], result: number) {
    super(circuitState, parameter, result);
    this.#p0 = parameter[0];
    this.#p1 = parameter[1];
    this.#p2 = parameter[2];
    this.#p3 = parameter[3];
  }

  evaluate(): boolean {
    return this.setResult0(
      this.circuitState.get(this.#p0) === STATE_ON0 ||
        this.circuitState.get(this.#p1) === STATE_ON0 ||
        this.circuitState.get(this.#p2) === STATE_ON0 ||
        this.circuitState.get(this.#p3) === STATE_ON0
        ? STATE_ON0
        : STATE_ON1,
    );
  }
}

export default FunctionAnd;
