import type BasePin from "./basePin";

// Interner Bauteil-Anschlusspin analog zu DevicePin.cs (nicht in XML gespeichert)
type DevicePin = BasePin & {
  kind: "devicePin";
  order: number;
};

export default DevicePin;
