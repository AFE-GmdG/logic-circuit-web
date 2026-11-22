import type CircuitState from "../../state/circuitState";
import CircuitFunction from "../circuitFunction";

// Konstanten-Funktion für statische 1..32 Bit Werte analog zu FunctionConstant.cs
export class FunctionConstant extends CircuitFunction {
  #constantValue: number;
  readonly bitWidth: number;

  constructor(
    circuitState: CircuitState,
    result: number[],
    initialValue = 0,
  ) {
    super(circuitState, null, result);
    this.bitWidth = result.length;
    this.#constantValue = this.#normalize(initialValue);
  }

  get value(): number {
    return this.#constantValue;
  }

  set value(val: number) {
    const normalized = this.#normalize(val);
    if (this.#constantValue !== normalized) {
      this.#constantValue = normalized;
      this.circuitState.markUpdated(this);
    }
  }

  get reportName(): string {
    return `Constant (${this.bitWidth}-bit: 0x${this.#constantValue.toString(16)})`;
  }

  evaluate(): boolean {
    return this.setResultValue(this.#constantValue);
  }

  #normalize(val: number): number {
    if (this.bitWidth >= 32) {
      return val >>> 0;
    }
    const mask = (1 << this.bitWidth) - 1;
    return (val & mask) >>> 0;
  }
}

export default FunctionConstant;
