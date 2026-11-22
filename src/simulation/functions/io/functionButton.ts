import { STATE_ON0, STATE_ON1 } from "../../../types/simulation/state";

import OneBitConst from "./oneBitConst";
import type CircuitState from "../../state/circuitState";
import CircuitFunction from "../circuitFunction";

// Taster- und Schalterfunktion analog zu FunctionButton.cs
export class FunctionButton extends OneBitConst {
  readonly isToggle: boolean;
  readonly inverted: boolean;
  readonly buttonId?: string;
  readonly rawButtonId?: string;

  constructor(
    circuitState: CircuitState,
    result: number,
    options: {
      isToggle?: boolean;
      inverted?: boolean;
      buttonId?: string;
      rawButtonId?: string;
    } = {},
  ) {
    const isToggle = options.isToggle ?? false;
    const inverted = options.inverted ?? false;
    const initial = inverted ? STATE_ON1 : STATE_ON0;
    super(circuitState, initial, result);
    this.isToggle = isToggle;
    this.inverted = inverted;
    this.buttonId = options.buttonId;
    this.rawButtonId = options.rawButtonId ?? options.buttonId;
  }

  get reportName(): string {
    return this.isToggle ? "ToggleSwitch" : "PushButton";
  }

  get isOn(): boolean {
    return this.inverted ? this.state === STATE_ON0 : this.state === STATE_ON1;
  }

  // Interaktive Betätigung des Tasters / Schalters analog zu C# StateChangedAction
  press(isPressed: boolean): void {
    if (isPressed) {
      if (this.isToggle) {
        this.setState(CircuitFunction.not(this.state));
      } else {
        this.setState(this.inverted ? STATE_ON0 : STATE_ON1);
      }
    } else if (!this.isToggle) {
      this.setState(this.inverted ? STATE_ON1 : STATE_ON0);
    }
  }

  // Schaltet einen Wechselschalter (Toggle) um
  toggle(): void {
    if (this.isToggle) {
      this.setState(CircuitFunction.not(this.state));
    }
  }
}

export default FunctionButton;
