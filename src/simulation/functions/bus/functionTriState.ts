import { STATE_ON1 } from "../../../types/simulation/state";

import type CircuitState from "../../state/circuitState";
import CircuitFunction from "../circuitFunction";

// Tri-State-Pufferfunktion analog zu FunctionTriState.cs
// Schaltet das Eingangssignal durch, wenn Enable = High (On1); sonst hochohmig (Off)
export class FunctionTriState extends CircuitFunction {
  constructor(
    circuitState: CircuitState,
    parameter: number,
    enable: number,
    result: number,
  ) {
    super(circuitState, [parameter, enable], [result]);
  }

  get reportName(): string {
    return "TriState";
  }

  evaluate(): boolean {
    return this.setResult0(this.controlledState(STATE_ON1));
  }
}

export default FunctionTriState;
