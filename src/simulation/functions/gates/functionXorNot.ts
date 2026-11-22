import { STATE_ON1 } from "../../../types/simulation/state";

import type CircuitState from "../../state/circuitState";
import CircuitFunction from "../circuitFunction";

// XNOR-Gatterfunktion analog zu FunctionXorNot.cs (Parität gerade -> High)
export class FunctionXorNot extends CircuitFunction {
  static create(circuitState: CircuitState, parameter: number[], result: number): FunctionXorNot {
    return new FunctionXorNot(circuitState, parameter, [result]);
  }

  get reportName(): string {
    return `XNOR (${this.parameterCount})`;
  }

  evaluate(): boolean {
    return this.setResult0(CircuitFunction.fromBool((this.count(STATE_ON1) & 1) !== 1));
  }
}

export default FunctionXorNot;
