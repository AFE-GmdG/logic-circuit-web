import type CircuitState from "../../state/circuitState";
import CircuitFunction from "../circuitFunction";

// NOT-Inverterfunktion analog zu FunctionNot.cs
export class FunctionNot extends CircuitFunction {
  readonly #param0: number;

  constructor(circuitState: CircuitState, parameter: number, result: number) {
    super(circuitState, [parameter], [result]);
    this.#param0 = parameter;
  }

  get reportName(): string {
    return "NOT";
  }

  evaluate(): boolean {
    return this.setResult0(CircuitFunction.not(this.circuitState.get(this.#param0)));
  }
}

export default FunctionNot;
