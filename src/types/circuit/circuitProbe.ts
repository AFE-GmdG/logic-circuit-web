import type Circuit from "./circuit";
import type PinSide from "./pinSide";
import type ProbeFormat from "./probeFormat";

// Signal-Messsonde (Probe) analog zu CircuitProbe.cs
type CircuitProbe = Circuit & {
  kind: "circuitProbe";
  circuitProbeId: string;
  pinSide: PinSide;
  isHex?: boolean;
  displayFormat?: ProbeFormat;
};

export default CircuitProbe;
