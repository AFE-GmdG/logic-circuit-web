import type CanvasPoint from "../types/canvas/canvasPoint";
import type GridPoint from "../types/canvas/gridPoint";
import type ViewportTransform from "../types/canvas/viewportTransform";

export const GRID_SIZE = 18;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4.0;
export const DEFAULT_ZOOM = 1.0;

// Rechnet Bildschirmkoordinaten (Client/Pixel relativ zum Canvas-Element) in logische Canvas-Koordinaten um
export function screenToCanvas(screenPoint: CanvasPoint, viewport: ViewportTransform): CanvasPoint {
  return {
    x: (screenPoint.x - viewport.panX) / viewport.zoom,
    y: (screenPoint.y - viewport.panY) / viewport.zoom,
  };
}

// Rechnet logische Canvas-Koordinaten in Bildschirmkoordinaten um
export function canvasToScreen(canvasPoint: CanvasPoint, viewport: ViewportTransform): CanvasPoint {
  return {
    x: canvasPoint.x * viewport.zoom + viewport.panX,
    y: canvasPoint.y * viewport.zoom + viewport.panY,
  };
}

// Konvertiert stetige logische Canvas-Koordinaten in diskrete ganzzahlige Rasterpunkte
export function canvasToGrid(canvasPoint: CanvasPoint): GridPoint {
  return {
    x: Math.round(canvasPoint.x / GRID_SIZE),
    y: Math.round(canvasPoint.y / GRID_SIZE),
  };
}

// Konvertiert diskrete Rasterpunkte in logische Canvas-Pixelkoordinaten
export function gridToCanvas(gridPoint: GridPoint): CanvasPoint {
  return {
    x: gridPoint.x * GRID_SIZE,
    y: gridPoint.y * GRID_SIZE,
  };
}

// Konvertiert Bildschirmkoordinaten direkt in diskrete Rasterpunkte
export function screenToGrid(screenPoint: CanvasPoint, viewport: ViewportTransform): GridPoint {
  const canvasPoint = screenToCanvas(screenPoint, viewport);
  return canvasToGrid(canvasPoint);
}

// Begrenzt den Zoomfaktor auf den zulässigen Wertebereich
export function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
}

// Berechnet die neue Viewport-Transformation für einen zoom-zentrierten Punkt unter dem Mauszeiger
export function calculateZoomAtPoint(
  currentViewport: ViewportTransform,
  cursorScreen: CanvasPoint,
  nextZoom: number,
): ViewportTransform {
  const clampedZoom = clampZoom(nextZoom);
  if (clampedZoom === currentViewport.zoom) {
    return currentViewport;
  }

  // Punkt unter dem Cursor im logischen Canvas ermitteln
  const canvasCursorX = (cursorScreen.x - currentViewport.panX) / currentViewport.zoom;
  const canvasCursorY = (cursorScreen.y - currentViewport.panY) / currentViewport.zoom;

  // Pan so anpassen, dass der Canvas-Punkt an der gleichen Bildschirmposition verbleibt
  const nextPanX = cursorScreen.x - canvasCursorX * clampedZoom;
  const nextPanY = cursorScreen.y - canvasCursorY * clampedZoom;

  return {
    panX: Math.round(nextPanX),
    panY: Math.round(nextPanY),
    zoom: clampedZoom,
  };
}

// Formatiert die Zoomstufe zur Anzeige als ganzzahligen Prozentwert
export function formatZoomPercentage(zoom: number): string {
  return `${Math.round(zoom * 100)} %`;
}
