import type CircuitState from "../../state/circuitState";
import CircuitFunction from "../circuitFunction";
import type IFunctionClock from "../iFunctionClock";

// Taktgeberfunktion analog zu FunctionClock.cs
export class FunctionClock extends CircuitFunction implements IFunctionClock {
  #clockState = false;

  constructor(circuitState: CircuitState, result: number) {
    super(circuitState, null, [result]);
  }

  // Schaltet die Taktflanke um (High -> Low bzw. Low -> High)
  flip(): boolean {
    this.#clockState = !this.#clockState;
    return true;
  }

  get state(): boolean {
    return this.#clockState;
  }

  set state(value: boolean) {
    if (this.#clockState !== value) {
      this.#clockState = value;
      this.circuitState.markUpdated(this);
    }
  }

  get reportName(): string {
    return "Clock";
  }

  evaluate(): boolean {
    return this.setResult0(CircuitFunction.fromBool(this.#clockState));
  }
}

export default FunctionClock;
