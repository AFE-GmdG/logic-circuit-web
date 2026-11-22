import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type McpImageResult from "../types/mcp/mcpImageResult";

import {
  getSymbolGridBoundingBox,
  getTextNoteGridBoundingBox,
} from "./circuitLayout";
import { GRID_SIZE } from "./coordinateSystem";

export type CaptureMode = "viewport" | "circuit";
export type UnrelatedSymbolsMode = "show" | "dim" | "hide";

export type GridRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PixelBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CaptureOptions = {
  mode?: CaptureMode;
  circuit?: LogicalCircuit;
  gridRect?: GridRect;
  symbolIds?: string[];
  margin?: number;
  unrelatedSymbols?: UnrelatedSymbolsMode;
  transparentBackground?: boolean;
  scale?: number;
};

const DEFAULT_CIRCUIT_MARGIN_UNITS = 2;
const DEFAULT_REGION_RECT_MARGIN_UNITS = 0;
const UNRELATED_SYMBOL_DIM_OPACITY = "0.15";

// Standard-Farbpalette als Fallback für SVG-in-Image-Rendering
const FALLBACK_CSS_VARS = `
  --color-bg-base: #10141a;
  --color-bg-surface: #161b22;
  --color-bg-elevated: #21262d;
  --color-border-subtle: #30363d;
  --color-border-strong: #484f58;
  --color-text-primary: #f0f4f8;
  --color-text-secondary: #b1bac4;
  --color-text-muted: #6e7681;
  --color-logic-low: #325838;
  --color-logic-high: #3fb950;
  --color-logic-high-glow: rgba(63, 185, 80, 0.4);
  --color-logic-undefined: #58a6ff;
  --color-logic-error: #f85149;
  --color-wire-default: #656d76;
  --color-wire-selected: #f0883e;
  --color-grid-dots: #30363d;
  --color-grid-canvas: #161b22;
  --color-accent-primary: #388bfd;
  --color-accent-primary-hover: #58a6ff;
  --color-accent-primary-bg: #0d419d;
  --color-selection-fill: rgba(56, 139, 253, 0.15);
  --color-ai-highlight: #2dd4bf;
  --color-button-toggle-off: #384038;
  --color-button-toggle-off-border: #222b22;
  --color-button-toggle-on: #02fd02;
  --color-button-toggle-on-border: #00aa00;
  --color-button-toggle-on-glow: #02fd02;
  --font-family-base: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-family-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
`;

// Sammelt aktive CSS-Variablen aus dem Dokument für die SVG-Einbettung
function collectRootCssVariables(): string {
  if (typeof window === "undefined" || typeof document === "undefined" || !document.documentElement) {
    return FALLBACK_CSS_VARS;
  }

  const computed = window.getComputedStyle(document.documentElement);
  const collected: string[] = [];

  const knownNames = [
    "--color-bg-base",
    "--color-bg-surface",
    "--color-bg-elevated",
    "--color-border-subtle",
    "--color-border-strong",
    "--color-text-primary",
    "--color-text-secondary",
    "--color-text-muted",
    "--color-logic-low",
    "--color-logic-high",
    "--color-logic-high-glow",
    "--color-logic-undefined",
    "--color-logic-error",
    "--color-wire-default",
    "--color-wire-selected",
    "--color-grid-dots",
    "--color-grid-canvas",
    "--color-accent-primary",
    "--color-accent-primary-hover",
    "--color-accent-primary-bg",
    "--color-selection-fill",
    "--color-ai-highlight",
    "--color-button-toggle-off",
    "--color-button-toggle-off-border",
    "--color-button-toggle-on",
    "--color-button-toggle-on-border",
    "--color-button-toggle-on-glow",
    "--font-family-base",
    "--font-family-mono",
  ];

  for (const name of knownNames) {
    const value = computed.getPropertyValue(name).trim();
    if (value) {
      collected.push(`  ${name}: ${value};`);
    }
  }

  return collected.length > 0 ? collected.join("\n") : FALLBACK_CSS_VARS;
}

// Sammelt aktive CSS-Variablen und Emotion-Stylesheets aus dem Dokument für die SVG-Einbettung
function collectDocumentStyles(): string {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return `:root {\n${FALLBACK_CSS_VARS}\n}`;
  }

  const parts: string[] = [];

  // CSS-Variablen einbetten
  parts.push(`:root {\n${collectRootCssVariables()}\n}`);

  // Emotion-Style-Tags und CSS-Regeln aus dem DOM einbetten
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const owner = sheet.ownerNode as HTMLElement | null;
        const isEmotion = owner?.tagName === "STYLE" && owner.hasAttribute("data-emotion");
        if (isEmotion && sheet.cssRules) {
          const rules: string[] = [];
          for (let i = 0; i < sheet.cssRules.length; i++) {
            rules.push(sheet.cssRules[i].cssText);
          }
          if (rules.length > 0) {
            parts.push(rules.join("\n"));
          }
        }
      } catch (_error) {
        // Cross-Origin Stylesheets überspringen
      }
    }

    const emotionTags = document.querySelectorAll("style[data-emotion]");
    for (const tag of Array.from(emotionTags)) {
      if (tag.textContent && tag.textContent.trim().length > 0) {
        parts.push(tag.textContent);
      }
    }
  } catch (_error) {
    // Bei Fehlern auf Fallback vertrauen
  }

  return parts.join("\n\n");
}

// Rechnet eine Raster-Bounding-Box inklusive Rand in Pixel-Koordinaten um
function gridBoxToPixelBounds(
  minGridX: number,
  minGridY: number,
  maxGridX: number,
  maxGridY: number,
  marginUnits: number,
): PixelBounds {
  const startX = (minGridX - marginUnits) * GRID_SIZE;
  const startY = (minGridY - marginUnits) * GRID_SIZE;
  const width = Math.max(GRID_SIZE, (maxGridX - minGridX + marginUnits * 2) * GRID_SIZE);
  const height = Math.max(GRID_SIZE, (maxGridY - minGridY + marginUnits * 2) * GRID_SIZE);
  return { x: startX, y: startY, width, height };
}

// Berechnet die gemeinsame Bounding-Box aller Entitäten einer Schaltung in Pixeln
function calculateCircuitBounds(circuit: LogicalCircuit, marginUnits: number): PixelBounds {
  let minGridX = Infinity;
  let minGridY = Infinity;
  let maxGridX = -Infinity;
  let maxGridY = -Infinity;

  for (const sym of circuit.circuitSymbols) {
    const box = getSymbolGridBoundingBox(sym);
    minGridX = Math.min(minGridX, box.minX);
    minGridY = Math.min(minGridY, box.minY);
    maxGridX = Math.max(maxGridX, box.maxX);
    maxGridY = Math.max(maxGridY, box.maxY);
  }

  for (const note of circuit.textNotes) {
    const box = getTextNoteGridBoundingBox(note);
    minGridX = Math.min(minGridX, box.minX);
    minGridY = Math.min(minGridY, box.minY);
    maxGridX = Math.max(maxGridX, box.maxX);
    maxGridY = Math.max(maxGridY, box.maxY);
  }

  for (const wire of circuit.wires) {
    minGridX = Math.min(minGridX, wire.x1, wire.x2);
    minGridY = Math.min(minGridY, wire.y1, wire.y2);
    maxGridX = Math.max(maxGridX, wire.x1, wire.x2);
    maxGridY = Math.max(maxGridY, wire.y1, wire.y2);
  }

  // Fallback bei leerer Schaltung
  if (!Number.isFinite(minGridX)) {
    minGridX = 0;
    minGridY = 0;
    maxGridX = 24;
    maxGridY = 16;
  }

  return gridBoxToPixelBounds(minGridX, minGridY, maxGridX, maxGridY, marginUnits);
}

// Ermittelt die Ziel-Pixelbounds für Ausschnitt- oder Gesamtschaltungs-Screenshots
export function resolveCaptureBounds(options: CaptureOptions): PixelBounds | null {
  if (options.gridRect) {
    const { x, y, width, height } = options.gridRect;
    const margin = options.margin ?? DEFAULT_REGION_RECT_MARGIN_UNITS;
    return gridBoxToPixelBounds(x, y, x + width, y + height, margin);
  }

  if (options.symbolIds && options.symbolIds.length > 0 && options.circuit) {
    const selectedSet = new Set(options.symbolIds);
    const matching = options.circuit.circuitSymbols.filter((sym) => selectedSet.has(sym.circuitSymbolId));
    if (matching.length === 0) {
      throw new Error("Keines der angegebenen Bauteile wurde in der Schaltung gefunden.");
    }

    let minGridX = Infinity;
    let minGridY = Infinity;
    let maxGridX = -Infinity;
    let maxGridY = -Infinity;

    for (const sym of matching) {
      const box = getSymbolGridBoundingBox(sym);
      minGridX = Math.min(minGridX, box.minX);
      minGridY = Math.min(minGridY, box.minY);
      maxGridX = Math.max(maxGridX, box.maxX);
      maxGridY = Math.max(maxGridY, box.maxY);
    }

    const margin = options.margin ?? DEFAULT_CIRCUIT_MARGIN_UNITS;
    return gridBoxToPixelBounds(minGridX, minGridY, maxGridX, maxGridY, margin);
  }

  if ((options.mode ?? "viewport") === "circuit" && options.circuit) {
    return calculateCircuitBounds(options.circuit, options.margin ?? DEFAULT_CIRCUIT_MARGIN_UNITS);
  }

  return null;
}

// Wendet den Sichtbarkeitsfilter für nicht genannte Bauteile im SVG-Klon an
function applyUnrelatedSymbolsFilter(
  clone: SVGSVGElement,
  symbolIds: string[] | undefined,
  unrelatedSymbols: UnrelatedSymbolsMode | undefined,
): void {
  if (!symbolIds || symbolIds.length === 0 || !unrelatedSymbols || unrelatedSymbols === "show") {
    return;
  }

  const allowedSet = new Set(symbolIds);
  const symbolNodes = clone.querySelectorAll<SVGGElement>("[data-component=\"CircuitSymbolView\"][data-symbol-id]");
  for (const node of Array.from(symbolNodes)) {
    const symbolId = node.getAttribute("data-symbol-id");
    if (symbolId && !allowedSet.has(symbolId)) {
      if (unrelatedSymbols === "hide") {
        node.remove();
      } else {
        node.setAttribute("opacity", UNRELATED_SYMBOL_DIM_OPACITY);
      }
    }
  }
}

// Ersetzt eingebettete Live-Canvas-Displays (foreignObject) im SVG-Klon durch statische PNG-Image-Knoten
function inlineCanvasDisplaysInSvgClone(
  originalSvg: SVGSVGElement,
  clone: SVGSVGElement,
): void {
  if (
    typeof document === "undefined" ||
    typeof originalSvg.querySelectorAll !== "function" ||
    typeof clone.querySelectorAll !== "function"
  ) {
    return;
  }

  const selector = "foreignObject canvas[data-graphics-array-canvas='true']";
  const origCanvases = Array.from(originalSvg.querySelectorAll<HTMLCanvasElement>(selector));
  const cloneCanvases = Array.from(clone.querySelectorAll<HTMLCanvasElement>(selector));
  const pairCount = Math.min(origCanvases.length, cloneCanvases.length);

  for (let i = 0; i < pairCount; i++) {
    const origCanvas = origCanvases[i];
    const cloneCanvas = cloneCanvases[i];
    const cloneFo = typeof cloneCanvas.closest === "function"
      ? cloneCanvas.closest("foreignObject")
      : null;
    if (!cloneFo || !cloneFo.parentNode) {
      continue;
    }

    let dataUrl = "";
    try {
      dataUrl = origCanvas.toDataURL("image/png");
    } catch {
      continue;
    }
    if (!dataUrl || !dataUrl.startsWith("data:image/")) {
      continue;
    }

    const imageEl = document.createElementNS("http://www.w3.org/2000/svg", "image");
    imageEl.setAttribute("x", cloneFo.getAttribute("x") ?? "0");
    imageEl.setAttribute("y", cloneFo.getAttribute("y") ?? "0");
    imageEl.setAttribute("width", cloneFo.getAttribute("width") ?? String(origCanvas.width || 1));
    imageEl.setAttribute("height", cloneFo.getAttribute("height") ?? String(origCanvas.height || 1));
    imageEl.setAttribute("href", dataUrl);
    imageEl.setAttribute("preserveAspectRatio", "none");
    imageEl.setAttribute("style", "image-rendering: pixelated;");
    cloneFo.parentNode.replaceChild(imageEl, cloneFo);
  }
}

// Bereitet einen geklonten Schaltungs-SVG für viewBox, Hintergrund, Raster und Filter auf
export function prepareCircuitSvgClone(
  svgElement: SVGSVGElement,
  options: CaptureOptions = {},
  viewportFallbackSize?: { width: number; height: number },
): { clone: SVGSVGElement; width: number; height: number } {
  const clone = svgElement.cloneNode(true) as SVGSVGElement;
  inlineCanvasDisplaysInSvgClone(svgElement, clone);

  // Interaktions-Overlays aus dem Screenshot entfernen
  const selectionBoxes = clone.querySelectorAll("[data-component=\"SelectionBox\"]");
  for (const box of Array.from(selectionBoxes)) {
    box.remove();
  }

  const isTransparent = options.transparentBackground === true;

  // Bei transparentem Hintergrund auch die Rasterpunkte von CanvasGrid entfernen
  if (isTransparent) {
    const gridNodes = clone.querySelectorAll("[data-component=\"CanvasGrid\"]");
    for (const gridNode of Array.from(gridNodes)) {
      gridNode.remove();
    }
  }

  // Hintergrund-Rechteck nur bei nicht-transparentem Hintergrund einfügen
  const bgRect = isTransparent ? null : document.createElementNS("http://www.w3.org/2000/svg", "rect");
  if (bgRect) {
    bgRect.setAttribute("fill", "var(--color-grid-canvas)");
    clone.insertBefore(bgRect, clone.firstChild);
  }

  // CSS-Variablen und Emotion-Styles in einen Style-Block einbetten
  const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
  styleEl.textContent = collectDocumentStyles();
  clone.insertBefore(styleEl, clone.firstChild);

  const bounds = resolveCaptureBounds(options);
  let targetWidth = 1280;
  let targetHeight = 800;

  if (bounds) {
    targetWidth = Math.max(1, Math.round(bounds.width));
    targetHeight = Math.max(1, Math.round(bounds.height));

    if (bgRect) {
      bgRect.setAttribute("x", String(bounds.x));
      bgRect.setAttribute("y", String(bounds.y));
      bgRect.setAttribute("width", String(bounds.width));
      bgRect.setAttribute("height", String(bounds.height));
    }

    // Rasterpunkte und -fläche auf die beschnittenen Weltkoordinaten abstimmen
    if (!isTransparent) {
      const gridGroup = clone.querySelector("[data-component=\"CanvasGrid\"]");
      if (gridGroup) {
        const pattern = gridGroup.querySelector("pattern");
        if (pattern) {
          pattern.setAttribute("patternTransform", `translate(${-GRID_SIZE / 2}, ${-GRID_SIZE / 2}) scale(1)`);
        }
        const gridRect = gridGroup.querySelector("rect");
        if (gridRect) {
          gridRect.setAttribute("x", String(bounds.x));
          gridRect.setAttribute("y", String(bounds.y));
          gridRect.setAttribute("width", String(bounds.width));
          gridRect.setAttribute("height", String(bounds.height));
        }
      }
    }

    clone.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
    clone.setAttribute("width", String(targetWidth));
    clone.setAttribute("height", String(targetHeight));

    // Transformationsgruppe auf Schaltungsursprung ohne Viewport-Pan ausrichten
    const mainGroup = Array.from(clone.children).find(
      (child) => child.tagName.toLowerCase() === "g" && child.hasAttribute("transform"),
    );
    if (mainGroup) {
      mainGroup.setAttribute("transform", "translate(0, 0) scale(1)");
    }
  } else {
    const rect = viewportFallbackSize ?? svgElement.getBoundingClientRect();
    targetWidth = Math.max(100, Math.round(rect.width || 1280));
    targetHeight = Math.max(100, Math.round(rect.height || 800));

    if (bgRect) {
      bgRect.setAttribute("x", "0");
      bgRect.setAttribute("y", "0");
      bgRect.setAttribute("width", "100%");
      bgRect.setAttribute("height", "100%");
    }

    clone.setAttribute("viewBox", `0 0 ${targetWidth} ${targetHeight}`);
    clone.setAttribute("width", String(targetWidth));
    clone.setAttribute("height", String(targetHeight));
  }

  applyUnrelatedSymbolsFilter(clone, options.symbolIds, options.unrelatedSymbols);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  return { clone, width: targetWidth, height: targetHeight };
}

// Formatiert eine lesbare Beschreibung des gewählten Screenshot-Bereichs
function formatCaptureModeLabel(options: CaptureOptions): string {
  if (options.gridRect) {
    const { x, y, width, height } = options.gridRect;
    return `Ausschnitt (${x},${y} ${width}x${height})`;
  }
  if (options.symbolIds && options.symbolIds.length > 0) {
    const suffix = options.unrelatedSymbols === "hide"
      ? ", andere ausgeblendet"
      : options.unrelatedSymbols === "dim"
        ? ", andere abgeblendet"
        : "";
    return `Ausschnitt (${options.symbolIds.length} Bauteile${suffix})`;
  }
  return (options.mode ?? "viewport") === "circuit" ? "gesamte Schaltung" : "aktueller Viewport";
}

// Rendert ein serialisiertes SVG auf ein Offscreen-Canvas und gibt das PNG als Base64 zurück
function renderSvgToCanvas(
  svgString: string,
  width: number,
  height: number,
  options: { transparentBackground?: boolean; scale?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      reject(new Error("DOM-Umgebung steht für Canvas-Rendering nicht zur Verfügung."));
      return;
    }

    const scale = options.scale && Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 1;
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error("2D-Kontext des Canvas konnte nicht initialisiert werden."));
          return;
        }

        if (options.transparentBackground) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        } else {
          // Dunkler Hintergrund für nicht-transparente Exporte
          ctx.fillStyle = "#161b22";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);

        const dataUrl = canvas.toDataURL("image/png");
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
        resolve(base64);
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("SVG konnte im Offscreen-Image nicht gerendert werden."));
    };

    img.src = url;
  });
}

// Erstellt einen sicheren Dateinamen für den Bildexport
export function buildExportImageFilename(circuitName: string | undefined, extension: "svg" | "png"): string {
  const baseName = (circuitName ?? "schaltung")
    .trim()
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, "_");
  return `${baseName || "schaltung"}.${extension}`;
}

// Löst den Browser-Download eines Blobs aus
export function triggerBlobDownload(blob: Blob, filename: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// Serialisiert den Schaltungs-SVG für den direkten SVG-Dateiexport
export function exportCircuitAsSvgString(options: CaptureOptions = {}): {
  svgString: string;
  width: number;
  height: number;
} {
  if (typeof document === "undefined") {
    throw new Error("Bildexport erfordert einen geöffneten Browser.");
  }

  const svgElement = document.querySelector<SVGSVGElement>("svg.schematic-viewport");
  if (!svgElement) {
    throw new Error("Schaltungs-Viewport (<svg.schematic-viewport>) im DOM nicht gefunden.");
  }

  const { clone, width, height } = prepareCircuitSvgClone(svgElement, options);
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);
  return { svgString, width, height };
}

// Exportiert die Schaltung als PNG-Blob (standardmäßig 1:1)
export async function exportCircuitAsPngBlob(options: CaptureOptions = {}): Promise<{
  blob: Blob;
  width: number;
  height: number;
}> {
  const { svgString, width, height } = exportCircuitAsSvgString(options);
  const base64 = await renderSvgToCanvas(svgString, width, height, {
    transparentBackground: options.transparentBackground,
    scale: options.scale,
  });

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return {
    blob: new Blob([bytes], { type: "image/png" }),
    width,
    height,
  };
}

// Erfasst das Schaltungs-SVG und gibt ein Base64-kodiertes PNG-Ergebnis zurück
export async function captureCircuitSvg(options: CaptureOptions = {}): Promise<McpImageResult> {
  const { svgString, width: targetWidth, height: targetHeight } = exportCircuitAsSvgString(options);

  const base64 = await renderSvgToCanvas(svgString, targetWidth, targetHeight, {
    transparentBackground: options.transparentBackground,
    scale: options.scale,
  });
  const circuitName = options.circuit?.name ?? "Schaltung";
  const modeLabel = formatCaptureModeLabel(options);

  return {
    mimeType: "image/png",
    data: base64,
    width: targetWidth,
    height: targetHeight,
    description: `Screenshot der Schaltung "${circuitName}" (${modeLabel}, ${targetWidth}x${targetHeight} px)`,
  };
}
