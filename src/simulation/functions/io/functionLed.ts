import type State from "../../../types/simulation/state";
import { STATE_ON1 } from "../../../types/simulation/state";

import Probe from "./probe";
import type CircuitState from "../../state/circuitState";

// LED- und Display-Funktion für optische Signalanzeige analog zu FunctionLed.cs
export class FunctionLed extends Probe {
  readonly displayType: "single" | "sevenSegment";

  constructor(
    circuitState: CircuitState,
    parameter: number[],
    displayType: "single" | "sevenSegment" = "single",
  ) {
    super(circuitState, parameter);
    this.displayType = displayType;
  }

  get isOn(): boolean {
    return this.get(0) === STATE_ON1;
  }

  get segments(): readonly State[] {
    return this.probeState;
  }

  get reportName(): string {
    return this.displayType === "single" ? "LED" : "7-Segment Display";
  }

  evaluate(): boolean {
    this.updateState();
    return false;
  }
}

export default FunctionLed;
