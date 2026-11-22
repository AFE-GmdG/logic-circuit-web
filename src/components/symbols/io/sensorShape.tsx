import React from "react";

import styled from "@emotion/styled";

import type IOProps from "./ioProps";
import type SensorType from "../../../types/circuit/sensorType";

type SensorShapeProps = IOProps & {
  sensorType?: SensorType;
  notation?: string;
  value?: string;
  symbolId?: string;
  isInteractive?: boolean;
};

const SENSOR_TYPE_BADGE: Record<SensorType, string> = {
  random: "RND",
  manual: "MAN",
  series: "SER",
  loop: "LOOP",
  ascii: "ASC",
  keyCode: "KEY",
  sequence: "SEQ",
  clock: "CLK",
};

// Vektorsymbol für den Sensor-Baustein mit Modus-Anzeige und Messwert/Notation
const SensorShape = styled(({
  width,
  height,
  sensorType = "random",
  notation = "",
  value,
  symbolId,
  isInteractive = false,
  ...other
}: SensorShapeProps) => {
  const clipId = `sensor-clip-${symbolId || "def"}`;
  const badgeText = SENSOR_TYPE_BADGE[sensorType] ?? "SEN";
  const headerText = notation.trim() || badgeText;
  const displayText = value !== undefined && value !== "" ? value : badgeText;
  const headerY = Math.min(13, height * 0.28);
  const valueY = height * 0.64;

  return (
    <g {...other} data-component="SensorShape">
      <defs>
        <clipPath id={clipId}>
          <rect
            x={3}
            y={3}
            width={Math.max(0, width - 6)}
            height={Math.max(0, height - 6)}
            rx={3}
          />
        </clipPath>
      </defs>
      <rect
        x={2}
        y={2}
        width={Math.max(0, width - 4)}
        height={Math.max(0, height - 4)}
        rx={4}
        className="sensor-base"
      />
      <line
        x1={4}
        y1={height * 0.38}
        x2={Math.max(4, width - 4)}
        y2={height * 0.38}
        className="sensor-divider"
      />
      <text
        x={width / 2}
        y={headerY}
        textAnchor="middle"
        dominantBaseline="central"
        clipPath={`url(#${clipId})`}
        className="sensor-header"
      >
        {headerText}
      </text>
      {!isInteractive && (
        <text
          x={width / 2}
          y={valueY}
          textAnchor="middle"
          dominantBaseline="central"
          clipPath={`url(#${clipId})`}
          className="sensor-value"
        >
          {displayText}
        </text>
      )}
    </g>
  );
})({
  "& > .sensor-base": {
    fill: "var(--color-bg-elevated)",
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
  },
  "& > .sensor-divider": {
    stroke: "var(--color-border-strong)",
    strokeWidth: 1,
  },
  "& .sensor-header": {
    fill: "var(--color-text-secondary)",
    fontSize: "0.625rem",
    fontWeight: 600,
    fontFamily: "var(--font-family-base)",
  },
  "& .sensor-value": {
    fill: "var(--color-text-primary)",
    fontSize: "0.75rem",
    fontWeight: 700,
    fontFamily: "var(--font-family-mono)",
  },
});

export default SensorShape;
