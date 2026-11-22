import type Circuit from "./circuit";
import type CircuitButton from "./circuitButton";
import type CircuitProbe from "./circuitProbe";
import type CircuitSymbol from "./circuitSymbol";
import type Constant from "./constant";
import type Gate from "./gate";
import type GraphicsArray from "./graphicsArray";
import type LedMatrix from "./ledMatrix";
import type LogicalCircuit from "./logicalCircuit";
import type Memory from "./memory";
import type Pin from "./pin";
import type Sensor from "./sensor";
import type Sound from "./sound";
import type Splitter from "./splitter";
import type Synthesizer from "./synthesizer";
import type TextNote from "./textNote";
import type Wire from "./wire";

// Vorbereiteter, ID-bereinigter Zwischenablage-Block inklusive fehlender Subschaltungen
type PreparedPastePayload = {
  targetCircuitId: string;
  symbols: { symbol: CircuitSymbol; circuit: Circuit; pin?: Pin }[];
  textNotes: TextNote[];
  wires: Wire[];
  importedSubCircuits: LogicalCircuit[];
  importedGates: Gate[];
  importedPins: Pin[];
  importedButtons: CircuitButton[];
  importedConstants: Constant[];
  importedProbes: CircuitProbe[];
  importedLedMatrices: LedMatrix[];
  importedSplitters: Splitter[];
  importedMemories: Memory[];
  importedSensors: Sensor[];
  importedSounds: Sound[];
  importedSynthesizers: Synthesizer[];
  importedGraphicsArrays: GraphicsArray[];
};

export default PreparedPastePayload;
