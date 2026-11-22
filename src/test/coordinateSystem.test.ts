import { describe, expect, it } from "vitest";

import type CanvasPoint from "../types/canvas/canvasPoint";
import type ViewportTransform from "../types/canvas/viewportTransform";

import {
  calculateZoomAtPoint,
  canvasToGrid,
  canvasToScreen,
  clampZoom,
  formatZoomPercentage,
  GRID_SIZE,
  gridToCanvas,
  screenToCanvas,
  screenToGrid,
} from "../utils/coordinateSystem";

describe("Coordinate System & Grid Transformations", () => {
  const defaultViewport: ViewportTransform = {
    panX: 0,
    panY: 0,
    zoom: 1.0,
  };

  it("maintains GridSize of 18px matching original Logic Circuit specifications", () => {
    expect(GRID_SIZE).toBe(18);
  });

  it("converts screen to canvas coordinates with zoom and pan offsets", () => {
    const viewport: ViewportTransform = {
      panX: 100,
      panY: 50,
      zoom: 2.0,
    };
    const screenPoint: CanvasPoint = { x: 200, y: 150 };
    const canvasPoint = screenToCanvas(screenPoint, viewport);

    expect(canvasPoint.x).toBe(50);
    expect(canvasPoint.y).toBe(50);

    const roundTripScreen = canvasToScreen(canvasPoint, viewport);
    expect(roundTripScreen.x).toBe(screenPoint.x);
    expect(roundTripScreen.y).toBe(screenPoint.y);
  });

  it("snaps continuous canvas coordinates to discrete grid points", () => {
    expect(canvasToGrid({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(canvasToGrid({ x: 8, y: 8 })).toEqual({ x: 0, y: 0 });
    expect(canvasToGrid({ x: 9, y: 9 })).toEqual({ x: 1, y: 1 });
    expect(canvasToGrid({ x: 18, y: 36 })).toEqual({ x: 1, y: 2 });
    expect(canvasToGrid({ x: 26, y: 53 })).toEqual({ x: 1, y: 3 });
    expect(canvasToGrid({ x: -18, y: -36 })).toEqual({ x: -1, y: -2 });
  });

  it("converts discrete grid points to continuous canvas pixels", () => {
    expect(gridToCanvas({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(gridToCanvas({ x: 5, y: 10 })).toEqual({ x: 90, y: 180 });
    expect(gridToCanvas({ x: -2, y: -3 })).toEqual({ x: -36, y: -54 });
  });

  it("converts screen coordinates directly to grid points", () => {
    const viewport: ViewportTransform = {
      panX: 18,
      panY: 36,
      zoom: 1.0,
    };
    const screenPoint: CanvasPoint = { x: 36, y: 72 };
    expect(screenToGrid(screenPoint, viewport)).toEqual({ x: 1, y: 2 });
  });

  it("clamps zoom within allowable limits", () => {
    expect(clampZoom(0.05)).toBe(0.2);
    expect(clampZoom(1.5)).toBe(1.5);
    expect(clampZoom(10.0)).toBe(4.0);
  });

  it("keeps point under cursor fixed during cursor-centered zoom", () => {
    const cursorScreen: CanvasPoint = { x: 300, y: 200 };
    const nextViewport = calculateZoomAtPoint(defaultViewport, cursorScreen, 2.0);

    expect(nextViewport.zoom).toBe(2.0);

    const canvasPointBefore = screenToCanvas(cursorScreen, defaultViewport);
    const canvasPointAfter = screenToCanvas(cursorScreen, nextViewport);

    expect(canvasPointAfter.x).toBeCloseTo(canvasPointBefore.x, 5);
    expect(canvasPointAfter.y).toBeCloseTo(canvasPointBefore.y, 5);
  });

  it("formats zoom percentage strings accurately", () => {
    expect(formatZoomPercentage(1.0)).toBe("100 %");
    expect(formatZoomPercentage(1.25)).toBe("125 %");
    expect(formatZoomPercentage(0.5)).toBe("50 %");
  });
});
