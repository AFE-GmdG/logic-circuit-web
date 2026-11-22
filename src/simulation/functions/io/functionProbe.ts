import type ProbeFormat from "../../../types/circuit/probeFormat";

import Probe from "./probe";
import type CircuitState from "../../state/circuitState";

// Messfühler-Funktion (Probe) analog zu FunctionProbe.cs
export class FunctionProbe extends Probe {
  readonly label: string;
  readonly probeId?: string;
  readonly displayFormat: ProbeFormat;

  constructor(
    circuitState: CircuitState,
    parameter: number[],
    label = "Probe",
    probeId?: string,
    displayFormat: ProbeFormat = "hex",
  ) {
    super(circuitState, parameter);
    this.label = label;
    this.probeId = probeId;
    this.displayFormat = displayFormat;
  }

  get reportName(): string {
    return `Probe (${this.label}, ${this.bitWidth}-bit)`;
  }

  evaluate(): boolean {
    this.updateState();
    // Probes sind reine Senken und verändern niemals Ausgangssignale
    return false;
  }
}

export default FunctionProbe;
