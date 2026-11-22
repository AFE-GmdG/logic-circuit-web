// Numerischer dreiwertiger Signalzustand für State[] (Uint8Array) analog zu State.cs:
// Off = 0 (z / Tri-State / hochohmig)
// On0 = 1 (Low / 0)
// On1 = 2 (High / 1)
type State = 0 | 1 | 2;

export const STATE_OFF: State = 0;
export const STATE_ON0: State = 1;
export const STATE_ON1: State = 2;

export default State;
