import { STATE_ON1 } from "../../../types/simulation/state";

import type CircuitState from "../../state/circuitState";
import CircuitFunction from "../circuitFunction";

// XOR-Gatterfunktion analog zu FunctionXor.cs (Parität ungerade -> High)
export class FunctionXor extends CircuitFunction {
  static create(circuitState: CircuitState, parameter: number[], result: number): FunctionXor {
    return new FunctionXor(circuitState, parameter, [result]);
  }

  get reportName(): string {
    return `XOR (${this.parameterCount})`;
  }

  evaluate(): boolean {
    return this.setResult0(CircuitFunction.fromBool((this.count(STATE_ON1) & 1) === 1));
  }
}

export default FunctionXor;
