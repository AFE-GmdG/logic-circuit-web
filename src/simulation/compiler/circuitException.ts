import type SimulationErrorLocation from "../../types/simulation/simulationErrorLocation";

// Schaltungs- und Kompilierungsausnahme analog zu CircuitException.cs
export type CircuitExceptionCause = "userError" | "internalError";

export class CircuitException extends Error {
  readonly causeType: CircuitExceptionCause;
  readonly location?: SimulationErrorLocation;

  constructor(
    message: string,
    causeType: CircuitExceptionCause = "userError",
    location?: SimulationErrorLocation,
  ) {
    super(message);
    this.name = "CircuitException";
    this.causeType = causeType;
    this.location = location;
  }
}

export default CircuitException;
