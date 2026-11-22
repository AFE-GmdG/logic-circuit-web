import type Circuit from "./circuit";
import type CircuitButton from "./circuitButton";
import type CircuitProbe from "./circuitProbe";
import type CircuitSymbol from "./circuitSymbol";
import type CollapsedCategory from "./collapsedCategory";
import type Constant from "./constant";
import type DevicePin from "./devicePin";
import type Gate from "./gate";
import type GraphicsArray from "./graphicsArray";
import type LedMatrix from "./ledMatrix";
import type LogicalCircuit from "./logicalCircuit";
import type Memory from "./memory";
import type Pin from "./pin";
import type Project from "./project";
import type Sensor from "./sensor";
import type Sound from "./sound";
import type Splitter from "./splitter";
import type Synthesizer from "./synthesizer";
import type TextNote from "./textNote";
import type Wire from "./wire";

// Zentraler Projekt-Container aller Schaltungsentitäten analog zu CircuitProject.cs
type CircuitProject = {
  project: Project;
  collapsedCategories: CollapsedCategory[];
  circuits: Map<string, Circuit>;
  logicalCircuits: LogicalCircuit[];
  gates: Map<string, Gate>;
  pins: Pin[];
  devicePins: DevicePin[];
  constants: Constant[];
  circuitButtons: CircuitButton[];
  circuitProbes: CircuitProbe[];
  splitters: Splitter[];
  memories: Memory[];
  ledMatrices: LedMatrix[];
  sensors: Sensor[];
  sounds: Sound[];
  synthesizers: Synthesizer[];
  graphicsArrays: GraphicsArray[];
  circuitSymbols: CircuitSymbol[];
  wires: Wire[];
  textNotes: TextNote[];
};

export default CircuitProject;
