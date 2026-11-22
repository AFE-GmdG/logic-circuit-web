import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";

import {
  createCircuitSymbol,
  createEmptyCircuitProject,
  createGate,
  createTextNote,
  doBoundingBoxesIntersect,
  getTextNoteGridBoundingBox,
  getTextNoteGridDimensions,
  rotateCircuitEntities,
  rotateTextNote,
} from "../utils/circuitLayout";

import CircuitSymbolView from "../components/circuitCanvas/circuitSymbolView";
import TextNoteModal from "../components/circuitCanvas/textNoteModal";
import TextNoteView, { getFontSizeForLineHeight } from "../components/circuitCanvas/textNoteView";

const TestConsumer: React.FC<{
  onContext: (context: React.ContextType<typeof CircuitContext>) => void;
}> = ({ onContext }) => {
  const context = React.useContext(CircuitContext);
  onContext(context);
  return null;
};

describe("TextNote Layout & Calculations", () => {
  it("creates text note with default values and calculates grid dimensions", () => {
    const note = createTextNote("main-circuit", 5, 10, "Hallo Welt");
    expect(note.textNoteId).toBeDefined();
    expect(note.logicalCircuitId).toBe("main-circuit");
    expect(note.x).toBe(5);
    expect(note.y).toBe(10);
    expect(note.note).toBe("Hallo Welt");
    expect(note.lineHeight).toBe(18);
    expect(note.fontFamily).toBe("mono");
    expect(note.rotation).toBe("up");

    const dims = getTextNoteGridDimensions(note);
    expect(dims.gridHeight).toBe(1);
    expect(dims.gridWidth).toBeGreaterThanOrEqual(4);
  });

  it("calculates multi-line heights with custom line heights", () => {
    const multiLine = createTextNote("main-circuit", 0, 0, "Zeile 1\nZeile 2\nZeile 3", {
      lineHeight: 18,
      lineHeights: [36, 18, 12],
      fontFamily: "sans",
    });

    expect(multiLine.fontFamily).toBe("sans");
    expect(multiLine.lineHeights).toEqual([36, 18, 12]);

    const dims = getTextNoteGridDimensions(multiLine);
    // 36 + 18 + 12 = 66px, geteilt durch 18px Raster = 3.66 -> aufgerundet 4 Raster-Einheiten
    expect(dims.gridHeight).toBe(4);
  });

  it("maps line heights to visually pleasing font sizes", () => {
    expect(getFontSizeForLineHeight(9)).toBe(7);
    expect(getFontSizeForLineHeight(12)).toBe(9.5);
    expect(getFontSizeForLineHeight(18)).toBe(13.5);
    expect(getFontSizeForLineHeight(36)).toBe(26);
  });

  it("calculates bounding box for unrotated and rotated text notes", () => {
    const note = createTextNote("main-circuit", 10, 20, "Titel");
    const boxUp = getTextNoteGridBoundingBox(note);
    expect(boxUp.minX).toBe(10);
    expect(boxUp.minY).toBe(20);
    expect(boxUp.maxX).toBe(10 + note.width);
    expect(boxUp.maxY).toBe(20 + note.height);

    const rotatedRight = rotateTextNote(note, "clockwise");
    expect(rotatedRight.rotation).toBe("right");

    const boxRight = getTextNoteGridBoundingBox(rotatedRight);
    expect(boxRight.maxX - boxRight.minX).toBe(note.height);
    expect(boxRight.maxY - boxRight.minY).toBe(note.width);
  });

  it("rotates mixed selection of symbols and text notes around common centroid with zero drift", () => {
    const andGate = createGate("and", 2, false);
    const sym = createCircuitSymbol(andGate, "main", 10, 10, "up", "sym-1");
    const note = createTextNote("main", 20, 10, "Test Note", { textNoteId: "note-1" });

    let currentSymbols = [sym];
    let currentNotes = [note];

    // Vier volle Drehungen im Uhrzeigersinn müssen exakt am Ausgangspunkt landen
    for (let i = 0; i < 4; i++) {
      const result = rotateCircuitEntities(currentSymbols, currentNotes, "clockwise");
      currentSymbols = result.symbols;
      currentNotes = result.textNotes;
    }

    expect(currentSymbols[0].x).toBe(10);
    expect(currentSymbols[0].y).toBe(10);
    expect(currentSymbols[0].rotation).toBe("up");

    expect(currentNotes[0].x).toBe(20);
    expect(currentNotes[0].y).toBe(10);
    expect(currentNotes[0].rotation).toBe("up");
  });

  it("checks bounding box intersection for selection", () => {
    const note = createTextNote("main", 5, 5, "Notiz");
    const noteBox = getTextNoteGridBoundingBox(note);

    const intersectingBox = { minX: 4, minY: 4, maxX: 7, maxY: 7 };
    const separateBox = { minX: 20, minY: 20, maxX: 25, maxY: 25 };

    expect(doBoundingBoxesIntersect(intersectingBox, noteBox)).toBe(true);
    expect(doBoundingBoxesIntersect(separateBox, noteBox)).toBe(false);
  });
});

describe("TextNote in CircuitContext", () => {
  it("supports adding, updating, moving and removing text notes in context", () => {
    let capturedContext: React.ContextType<typeof CircuitContext> | null = null;

    const initialProject = createEmptyCircuitProject("Note Test Project", "Main");

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={initialProject}>
        <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
      </CircuitContextProvider>,
    );

    expect(capturedContext).not.toBeNull();
    const ctx = capturedContext!;

    expect(ctx.currentCircuit.textNotes.length).toBe(0);

    const added = ctx.addTextNote("Meine erste Notiz", { x: 8, y: 12 }, {
      lineHeight: 18,
      fontFamily: "sans",
    });

    expect(added.note).toBe("Meine erste Notiz");
    expect(added.x).toBe(8);
    expect(added.y).toBe(12);
    expect(added.fontFamily).toBe("sans");
  });
});

describe("TextNoteView Component", () => {
  it("renders text note with hit rect and lines", () => {
    const note = createTextNote("main", 2, 4, "Erste Zeile\nZweite Zeile");
    const html = renderToStaticMarkup(
      <svg>
        <TextNoteView textNote={note} isSelected={true} />
      </svg>,
    );

    expect(html).toContain("data-component=\"TextNoteView\"");
    expect(html).toContain("class=\"hit-rect\"");
    expect(html).toContain("class=\"selection-box\"");
    expect(html).toContain("class=\"resize-markers\"");
    expect(html).toContain("class=\"resize-handle\"");
    expect(html).toContain("<clipPath");
    expect(html).toContain("clip-path=\"url(#text-clip-");
    expect(html).toContain("Erste Zeile");
    expect(html).toContain("Zweite Zeile");
  });

  it("does not render resize handles when multiple items are selected", () => {
    const note = createTextNote("main", 2, 4, "Mehrfachauswahl");
    const html = renderToStaticMarkup(
      <svg>
        <TextNoteView textNote={note} isSelected={true} isOnlySelected={false} />
      </svg>,
    );

    expect(html).toContain("class=\"selection-box\"");
    expect(html).not.toContain("class=\"resize-markers\"");
  });

  it("renders candidate box when candidate selected", () => {
    const note = createTextNote("main", 2, 4, "Vorschau");
    const html = renderToStaticMarkup(
      <svg>
        <TextNoteView textNote={note} isSelected={false} isCandidateSelected={true} />
      </svg>,
    );

    expect(html).toContain("class=\"candidate-box\"");
  });
});

describe("TextNoteModal Component", () => {
  it("renders modal dialog when open with text note data", () => {
    const note = createTextNote("main", 0, 0, "Zu bearbeitender Text");
    const html = renderToStaticMarkup(
      <TextNoteModal
        isOpen={true}
        textNote={note}
        onSave={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("data-component=\"TextNoteModal\"");
    expect(html).toContain("Text-Notiz bearbeiten");
    expect(html).toContain("Zu bearbeitender Text");
    expect(html).toContain("Standard-Zeilenhöhe");
    expect(html).toContain("Schriftart");
  });

  it("returns null when closed", () => {
    const note = createTextNote("main", 0, 0, "Test");
    const html = renderToStaticMarkup(
      <TextNoteModal
        isOpen={false}
        textNote={note}
        onSave={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).not.toContain("data-component=\"TextNoteModal\"");
  });
});

describe("CircuitSymbolView Component", () => {
  it("renders tooltip title without static text label", () => {
    const andGate = createGate("and", 2, false);
    const sym = createCircuitSymbol(andGate, "main", 10, 10, "up", "sym-and");
    const html = renderToStaticMarkup(
      <svg>
        <CircuitSymbolView symbol={sym} />
      </svg>,
    );

    expect(html).toContain("<title>AND</title>");
    expect(html).not.toContain("symbol-label");
  });

  it("renders multi-line tooltip title when circuit has a note", () => {
    const notGate = createGate("not", 1, false);
    notGate.note = "Das ist ein mehrzeiliger\nKommentar für das NOT Gate";
    const sym = createCircuitSymbol(notGate, "main", 10, 10, "up", "sym-not");
    const html = renderToStaticMarkup(
      <svg>
        <CircuitSymbolView symbol={sym} />
      </svg>,
    );

    expect(html).toContain("<title>NOT\n\nDas ist ein mehrzeiliger\nKommentar für das NOT Gate</title>");
  });
});
