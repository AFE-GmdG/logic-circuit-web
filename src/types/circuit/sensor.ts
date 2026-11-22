import type Circuit from "./circuit";
import type PinSide from "./pinSide";
import type SensorType from "./sensorType";

// Sensor-Eingangsbaustein (Zufall, Sequenz, Tastatur, Takt) analog zu Sensor.cs
type Sensor = Circuit & {
  kind: "sensor";
  sensorId: string;
  sensorType: SensorType;
  bitWidth: number;
  pinSide: PinSide;
  data: string;
};

export default Sensor;
