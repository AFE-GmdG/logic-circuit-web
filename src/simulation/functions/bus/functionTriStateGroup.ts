import type CircuitState from "../../state/circuitState";
import CircuitFunction from "../circuitFunction";

// Gruppe zusammengeschalteter Tri-State-Ausgänge analog zu FunctionTriStateGroup.cs
// Löst mehrere Treiber auf einer gemeinsamen Leitung kollisionsfrei auf.
export class FunctionTriStateGroup extends CircuitFunction {
  constructor(
    circuitState: CircuitState,
    parameter: number[],
    result: number,
  ) {
    super(circuitState, parameter, [result]);
  }

  get reportName(): string {
    return `TriStateGroup (${this.parameterCount} drivers)`;
  }

  evaluate(): boolean {
    return this.setResult0(this.triStateGroup());
  }
}

export default FunctionTriStateGroup;
