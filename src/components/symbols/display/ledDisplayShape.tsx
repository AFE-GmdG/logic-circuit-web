import React from "react";

import styled from "@emotion/styled";

import type DisplayColor from "../../../types/circuit/displayColor";
import type State from "../../../types/simulation/state";
import { STATE_ON0, STATE_ON1 } from "../../../types/simulation/state";

type LedDisplayShapeProps = React.ComponentPropsWithoutRef<"g"> & {
  width?: number;
  height?: number;
  isOn?: boolean;
  isDisconnected?: boolean;
  state?: State;
  color?: DisplayColor;
  symbolId?: string;
};

const COLOR_MAP: Record<DisplayColor, {
  offFill: string;
  offStroke: string;
  onFill: string;
  onStroke: string;
  glow: string;
}> = {
  red: {
    offFill: "#3a1414",
    offStroke: "#5e1e1e",
    onFill: "#ff4d4f",
    onStroke: "#ff7875",
    glow: "rgba(255, 77, 79, 0.45)",
  },
  yellow: {
    offFill: "#382e0e",
    offStroke: "#5c4b14",
    onFill: "#faad14",
    onStroke: "#ffd666",
    glow: "rgba(250, 173, 20, 0.45)",
  },
  green: {
    offFill: "#102d18",
    offStroke: "#1a4726",
    onFill: "#52c41a",
    onStroke: "#95de64",
    glow: "rgba(82, 196, 26, 0.45)",
  },
  blue: {
    offFill: "#0f2744",
    offStroke: "#183f6c",
    onFill: "#1677ff",
    onStroke: "#69b1ff",
    glow: "rgba(22, 119, 255, 0.45)",
  },
};

type LedColorTheme = {
  on0Fill: string;
  on0Stroke: string;
  glow: string;
  centerColor: string;
  mainColor: string;
  midColor: string;
  edgeColor: string;
};

const LED_THEMES: Record<DisplayColor, LedColorTheme> = {
  red: {
    on0Fill: "#5B4949",
    on0Stroke: "#3a2c2c",
    glow: "#ff2200",
    centerColor: "#FFFF70",
    mainColor: "#FB0303",
    midColor: "#985A5A",
    edgeColor: "#787878",
  },
  green: {
    on0Fill: "#445644",
    on0Stroke: "#283828",
    glow: "#02FD02",
    centerColor: "#E6FF99",
    mainColor: "#02FD02",
    midColor: "#4E874E",
    edgeColor: "#787878",
  },
  blue: {
    on0Fill: "#444B5E",
    on0Stroke: "#282F3E",
    glow: "#0088ff",
    centerColor: "#B8EEFF",
    mainColor: "#1677ff",
    midColor: "#4C6B98",
    edgeColor: "#787878",
  },
  yellow: {
    on0Fill: "#585240",
    on0Stroke: "#3A3525",
    glow: "#ffbb00",
    centerColor: "#FFFFB8",
    mainColor: "#FFD602",
    midColor: "#988748",
    edgeColor: "#787878",
  },
};

// Signallampe / Einzel-LED mit 3 visuellen Zuständen:
// - Wenn `state` übergeben wird (Simulations-Laufzeit analog Desktop-App):
//     STATE_OFF: LedOff-Farbverlauf
//     STATE_ON0: Inaktiver Zustand in der konfigurierten Farbe (on0Fill)
//     STATE_ON1: Leuchtendes Radial-Glow in der konfigurierten Farbe (onGradId)
// - Fallback für Palette/Statisch: Farbwahl über COLOR_MAP mit isDisconnected / isOff / isOn
const LedDisplayShape = styled(({
  width = 36,
  height = 36,
  isOn = false,
  isDisconnected = false,
  state,
  color = "red",
  symbolId,
  ...other
}: LedDisplayShapeProps) => {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.max(3, Math.min(width, height) / 2 - 3);

  const offGradId = `led-off-grad-${symbolId || "def"}`;
  const onGradId = `led-on-grad-${symbolId || "def"}`;

  const theme = LED_THEMES[color] ?? LED_THEMES.red;
  const colorSpec = COLOR_MAP[color] ?? COLOR_MAP.red;

  let fill: string;
  let stroke: string;
  let filter: string | undefined = undefined;
  let stateClass: string;

  if (state !== undefined) {
    if (state === STATE_ON1) {
      fill = `url(#${onGradId})`;
      stroke = "#787878";
      filter = `drop-shadow(0 0 5px ${theme.glow})`;
      stateClass = "is-on";
    } else if (state === STATE_ON0) {
      fill = theme.on0Fill;
      stroke = theme.on0Stroke;
      stateClass = "is-on0";
    } else {
      fill = `url(#${offGradId})`;
      stroke = "#606060";
      stateClass = "is-off";
    }
  } else if (isDisconnected) {
    fill = "#21262d";
    stroke = "#30363d";
    stateClass = "is-disconnected";
  } else if (isOn) {
    fill = colorSpec.onFill;
    stroke = colorSpec.onStroke;
    filter = `drop-shadow(0 0 4px ${colorSpec.glow})`;
    stateClass = "is-on";
  } else {
    fill = colorSpec.offFill;
    stroke = colorSpec.offStroke;
    stateClass = "is-off";
  }

  return (
    <g {...other} data-component="LedDisplayShape">
      <defs>
        <radialGradient id={offGradId} cx="50%" cy="50%" fx="50%" fy="50%" r="50%">
          <stop offset="0%" stopColor={theme.midColor} />
          <stop offset="100%" stopColor="#909090" />
        </radialGradient>
        <radialGradient id={onGradId} cx="50%" cy="50%" fx="50%" fy="50%" r="50%">
          <stop offset="0%" stopColor={theme.centerColor} />
          <stop offset="20%" stopColor={theme.mainColor} />
          <stop offset="90%" stopColor={theme.midColor} />
          <stop offset="100%" stopColor={theme.edgeColor} />
        </radialGradient>
      </defs>

      {/* Äußerer Metall- / Kunststoffrahmen (Bezel) */}
      <circle
        cx={cx}
        cy={cy}
        r={radius + 1.5}
        className="led-bezel"
      />

      {/* LED-Linse entsprechend dem Zustand */}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={fill}
        stroke={stroke}
        style={{ filter }}
        className={`led-lens ${stateClass}`}
      />
    </g>
  );
})({
  "& > .led-bezel": {
    fill: "var(--color-bg-elevated)",
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
  },
  "& > .led-lens": {
    strokeWidth: 1.2,
    transition: "fill 0.15s ease, filter 0.15s ease",
  },
});

export default LedDisplayShape;
