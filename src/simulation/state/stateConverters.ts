import type SignalState from "../../types/simulation/signalState";
import type State from "../../types/simulation/state";
import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../../types/simulation/state";

// Konvertiert den numerischen State (0, 1, 2) in den lesbaren SignalState ("off", "on0", "on1")
export function toSignalState(state: State | number): SignalState {
  switch (state) {
    case STATE_OFF:
      return "off";
    case STATE_ON0:
      return "on0";
    case STATE_ON1:
      return "on1";
    default:
      return "off";
  }
}

// Konvertiert den lesbaren SignalState ("off", "on0", "on1") in den numerischen State (0, 1, 2)
export function fromSignalState(signal: SignalState): State {
  switch (signal) {
    case "off":
      return STATE_OFF;
    case "on0":
      return STATE_ON0;
    case "on1":
      return STATE_ON1;
  }
}

// Konvertiert einen booleschen Wert in einen State (false -> on0, true -> on1)
export function stateFromBool(value: boolean): State {
  return value ? STATE_ON1 : STATE_ON0;
}

// Zeichen-Repräsentation analog zu CircuitFunction.ToChar in C# (z, 0, 1)
export function stateToChar(state: State | number): "z" | "0" | "1" {
  switch (state) {
    case STATE_OFF:
      return "z";
    case STATE_ON0:
      return "0";
    case STATE_ON1:
      return "1";
    default:
      return "z";
  }
}
