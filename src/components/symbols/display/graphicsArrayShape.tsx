import React from "react";

import styled from "@emotion/styled";

import {
  GRAPHICS_ARRAY_DEFAULT_BITS_PER_PIXEL,
  GRAPHICS_ARRAY_DEFAULT_HEIGHT,
  GRAPHICS_ARRAY_DEFAULT_WIDTH,
  GRAPHICS_ARRAY_DEFAULT_ZOOM,
  getGraphicsArrayStrides,
  renderGraphicsVramToRgba,
} from "../../../utils/graphicsArrayUtils";

type GraphicsArrayShapeProps = React.ComponentPropsWithoutRef<"g"> & {
  width?: number;
  height?: number;
  displayWidth?: number;
  displayHeight?: number;
  bitsPerPixel?: number;
  zoom?: number;
  vram?: Uint8Array;
  bitmapStride?: number;
  vramRevision?: number;
  isPalettePreview?: boolean;
};

// Symbol- und Live-VRAM-Canvas-Renderer für das Grafische Display (GraphicsArray)
const GraphicsArrayShape = styled(({
  width = 180,
  height = 126,
  displayWidth = GRAPHICS_ARRAY_DEFAULT_WIDTH,
  displayHeight = GRAPHICS_ARRAY_DEFAULT_HEIGHT,
  bitsPerPixel = GRAPHICS_ARRAY_DEFAULT_BITS_PER_PIXEL,
  zoom = GRAPHICS_ARRAY_DEFAULT_ZOOM,
  vram,
  bitmapStride,
  vramRevision = 0,
  isPalettePreview = false,
  ...other
}: GraphicsArrayShapeProps) => {
  const safeWidth = Math.max(0, width - 1);
  const safeHeight = Math.max(0, height - 1);
  const screenW = Math.min(Math.max(1, displayWidth * zoom), Math.max(1, width - 2));
  const screenH = Math.min(Math.max(1, displayHeight * zoom), Math.max(1, height - 2));
  const screenX = (width - screenW) / 2;
  const screenY = (height - screenH) / 2;

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const imageDataRef = React.useRef<{
    width: number;
    height: number;
    imageData: ImageData;
    pixels32: Uint32Array;
  } | null>(null);
  const lastBlittedRef = React.useRef<{
    revision: number;
    width: number;
    height: number;
    bitsPerPixel: number;
  } | null>(null);

  const effectiveStride =
    bitmapStride ?? getGraphicsArrayStrides(8, bitsPerPixel, displayWidth, displayHeight).bitmapStride;

  React.useEffect(
    () => {
      if (!vram) {
        lastBlittedRef.current = null;
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const prevBlit = lastBlittedRef.current;
      if (
        prevBlit &&
        prevBlit.revision === vramRevision &&
        prevBlit.width === displayWidth &&
        prevBlit.height === displayHeight &&
        prevBlit.bitsPerPixel === bitsPerPixel
      ) {
        return;
      }

      let ctx: CanvasRenderingContext2D | null = null;
      try {
        ctx = canvas.getContext("2d");
      } catch {
        ctx = null;
      }
      if (!ctx) {
        return;
      }

      let bufferEntry = imageDataRef.current;
      if (!bufferEntry || bufferEntry.width !== displayWidth || bufferEntry.height !== displayHeight) {
        const imageData = ctx.createImageData(displayWidth, displayHeight);
        bufferEntry = {
          width: displayWidth,
          height: displayHeight,
          imageData,
          pixels32: new Uint32Array(imageData.data.buffer),
        };
        imageDataRef.current = bufferEntry;
      }

      renderGraphicsVramToRgba(
        vram,
        bufferEntry.pixels32,
        displayWidth,
        displayHeight,
        bitsPerPixel,
        effectiveStride,
      );
      ctx.putImageData(bufferEntry.imageData, 0, 0);
      lastBlittedRef.current = {
        revision: vramRevision,
        width: displayWidth,
        height: displayHeight,
        bitsPerPixel,
      };
    },
    [
      bitsPerPixel,
      displayHeight,
      displayWidth,
      effectiveStride,
      vram,
      vramRevision,
    ],
  );

  const showEditLabel = !vram && !isPalettePreview && screenW >= 54 && screenH >= 28;
  const showPaletteDecor = !vram && isPalettePreview && screenW >= 18 && screenH >= 14;

  return (
    <g
      {...other}
      data-component="GraphicsArrayShape"
      data-display-width={displayWidth}
      data-display-height={displayHeight}
      data-bpp={bitsPerPixel}
      data-zoom={zoom}
    >
      {/* Äußeres Display-Gehäuse */}
      <rect
        x={0.5}
        y={0.5}
        width={safeWidth}
        height={safeHeight}
        rx={3}
        className="graphics-array-body"
      />

      {/* Zentrierte Bildschirmfläche */}
      <rect
        x={screenX}
        y={screenY}
        width={screenW}
        height={screenH}
        rx={1}
        className="graphics-array-screen"
      />

      {vram ? (
        <foreignObject
          x={screenX}
          y={screenY}
          width={screenW}
          height={screenH}
          className="graphics-array-fo"
        >
          <canvas
            ref={canvasRef}
            width={displayWidth}
            height={displayHeight}
            data-graphics-array-canvas="true"
            className="graphics-array-canvas"
          />
        </foreignObject>
      ) : (
        <>
          {showEditLabel && (
            <>
              <text
                x={width / 2}
                y={height / 2 - (screenH >= 42 ? 6 : 0)}
                textAnchor="middle"
                dominantBaseline="central"
                className="graphics-array-res-label"
              >
                {`${displayWidth}×${displayHeight}`}
              </text>
              {screenH >= 42 && (
                <text
                  x={width / 2}
                  y={height / 2 + 9}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="graphics-array-bpp-label"
                >
                  {`${bitsPerPixel} bpp`}
                </text>
              )}
            </>
          )}

          {showPaletteDecor && (
            <g className="graphics-array-preview-pixels">
              <rect
                x={screenX + screenW * 0.16}
                y={screenY + screenH * 0.22}
                width={screenW * 0.28}
                height={screenH * 0.28}
                className="preview-pixel-accent"
              />
              <rect
                x={screenX + screenW * 0.52}
                y={screenY + screenH * 0.44}
                width={screenW * 0.32}
                height={screenH * 0.32}
                className="preview-pixel-dim"
              />
            </g>
          )}
        </>
      )}
    </g>
  );
})({
  "& > .graphics-array-body": {
    fill: "var(--color-bg-elevated)",
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
  },

  "& > .graphics-array-screen": {
    fill: "#0b0f16",
    stroke: "var(--color-border-strong)",
    strokeWidth: 1,
  },

  "& > .graphics-array-fo": {
    pointerEvents: "none",
    overflow: "hidden",

    "& > .graphics-array-canvas": {
      width: "100%",
      height: "100%",
      display: "block",
      imageRendering: "pixelated",
      pointerEvents: "none",
    },
  },

  "& > .graphics-array-res-label": {
    fill: "var(--color-text-secondary)",
    fontSize: "0.6875rem",
    fontWeight: 700,
    fontFamily: "var(--font-family-mono)",
    pointerEvents: "none",
  },

  "& > .graphics-array-bpp-label": {
    fill: "var(--color-text-muted)",
    fontSize: "0.5625rem",
    fontWeight: 600,
    fontFamily: "var(--font-family-mono)",
    pointerEvents: "none",
  },

  "& > .graphics-array-preview-pixels": {
    pointerEvents: "none",

    "& > .preview-pixel-accent": {
      fill: "var(--color-accent-primary)",
      opacity: 0.75,
    },

    "& > .preview-pixel-dim": {
      fill: "var(--color-logic-high)",
      opacity: 0.65,
    },
  },
});

export default GraphicsArrayShape;
