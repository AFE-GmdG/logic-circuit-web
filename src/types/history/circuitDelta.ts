import type PropertyChange from "./propertyChange";
import type GridPoint from "../canvas/gridPoint";
import type Circuit from "../circuit/circuit";
import type CircuitShape from "../circuit/circuitShape";
import type CircuitSymbol from "../circuit/circuitSymbol";
import type DisplayMargin from "../circuit/displayMargin";
import type Pin from "../circuit/pin";
import type Rotation from "../circuit/rotation";
import type RotationDirection from "../circuit/rotationDirection";
import type TextNote from "../circuit/textNote";
import type Wire from "../circuit/wire";
import type WireEndpointUpdate from "../circuit/wireEndpointUpdate";

// Umkehrbare Delta-Aktion für den Undo-/Redo-Stack
type CircuitDelta =
  | {
    type: "move";
    logicalCircuitId: string;
    symbolIds: string[];
    textNoteIds: string[];
    wireIds?: string[];
    dx: number;
    dy: number;
    symbolPositions?: { symbolId: string; before: GridPoint; after: GridPoint }[];
    textNotePositions?: { textNoteId: string; before: GridPoint; after: GridPoint }[];
    wireChanges?: WireEndpointUpdate[];
    removedWires?: Wire[];
  }
  | {
    type: "rotate";
    logicalCircuitId: string;
    direction: RotationDirection;
    symbols: {
      symbolId: string;
      before: { x: number; y: number; rotation: Rotation };
      after: { x: number; y: number; rotation: Rotation };
    }[];
    textNotes: {
      textNoteId: string;
      before: { x: number; y: number; rotation: Rotation };
      after: { x: number; y: number; rotation: Rotation };
    }[];
    wireChanges?: WireEndpointUpdate[];
    removedWires?: Wire[];
  }
  | {
    type: "add";
    logicalCircuitId: string;
    symbols: { symbol: CircuitSymbol; circuit: Circuit; pin?: Pin }[];
    textNotes: TextNote[];
    wires?: Wire[];
  }
  | {
    type: "remove";
    logicalCircuitId: string;
    symbols: { symbol: CircuitSymbol; circuit: Circuit; pin?: Pin }[];
    textNotes: TextNote[];
    wires?: Wire[];
  }
  | {
    type: "updateProperty";
    logicalCircuitId: string;
    targetType: "symbol" | "textNote" | "logicalCircuit";
    targetId: string;
    changes: Record<string, PropertyChange>;
    beforeSymbol?: { symbol: CircuitSymbol; circuit: Circuit; pin?: Pin };
    afterSymbol?: { symbol: CircuitSymbol; circuit: Circuit; pin?: Pin };
    beforeTextNote?: TextNote;
    afterTextNote?: TextNote;
    beforeLogicalCircuit?: {
      name: string;
      notation: string;
      category: string;
      note: string;
      circuitShape?: CircuitShape;
      showLabelAbove?: boolean;
      displayMargin?: DisplayMargin;
      exportToHDL?: boolean;
      validators?: string;
      pinOrder?: { pinId: string; index: number }[];
    };
    afterLogicalCircuit?: {
      name: string;
      notation: string;
      category: string;
      note: string;
      circuitShape?: CircuitShape;
      showLabelAbove?: boolean;
      displayMargin?: DisplayMargin;
      exportToHDL?: boolean;
      validators?: string;
      pinOrder?: { pinId: string; index: number }[];
    };
    wireChanges?: WireEndpointUpdate[];
    removedWires?: Wire[];
  }
  | {
    type: "wireBatch";
    logicalCircuitId: string;
    addedWires: Wire[];
    removedWires: Wire[];
    updatedWires: WireEndpointUpdate[];
  };

export default CircuitDelta;
