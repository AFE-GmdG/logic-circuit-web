import type { CircuitExceptionCause } from "../../simulation/compiler/circuitException";

import type SimulationErrorLocation from "./simulationErrorLocation";

// Strukturierter Simulationsfehler für die Fehleranzeige in der UI
type SimulationError = {
  title: string;
  message: string;
  causeType: CircuitExceptionCause;
  isOscillation?: boolean;
  location?: SimulationErrorLocation | null;
};

export default SimulationError;
