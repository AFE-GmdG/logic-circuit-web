import type Circuit from "./circuit";
import type PinSide from "./pinSide";

// Interaktiver Taster- oder Schalter-Baustein analog zu CircuitButton.cs
type CircuitButton = Circuit & {
  kind: "circuitButton";
  circuitButtonId: string;
  modifiers: number;
  keyCode: number;
  isToggle: boolean;
  isOn?: boolean;
  pinSide: PinSide;
  inverted: boolean;
  width: number;
  height: number;
};

export default CircuitButton;
