// Betriebsmodus eines Sensor-Bausteins analog zu SensorType.cs
type SensorType =
  | "random"
  | "manual"
  | "series"
  | "loop"
  | "ascii"
  | "keyCode"
  | "sequence"
  | "clock";

export default SensorType;
