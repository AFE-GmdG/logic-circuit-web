import React from "react";

import styled from "@emotion/styled";

import type { GateType } from "../../types/circuit";

type PaletteCategory = {
  title: string;
  items: { type: GateType; label: string; description: string }[];
};

const CATEGORIES: PaletteCategory[] = [
  {
    title: "Ein- & Ausgänge",
    items: [
      { type: "button", label: "Taster / Schalter", description: "Interaktiver Eingang" },
      { type: "constant", label: "Konstante (0/1)", description: "Fester Signalpegel" },
      { type: "clock", label: "Taktgenerator", description: "Periodischer Puls" },
      { type: "probe", label: "Signal-Sonde (Probe)", description: "Zustandsanzeige" },
    ],
  },
  {
    title: "Logik-Gatter",
    items: [
      { type: "not", label: "NOT-Inverter", description: "Negiert das Eingangssignal" },
      { type: "and", label: "AND-Gatter", description: "Logisches Und" },
      { type: "or", label: "OR-Gatter", description: "Logisches Oder" },
      { type: "xor", label: "XOR-Gatter", description: "Exklusives Oder" },
      { type: "nand", label: "NAND-Gatter", description: "Negiertes Und" },
      { type: "nor", label: "NOR-Gatter", description: "Negiertes Oder" },
    ],
  },
];

type ComponentPaletteProps = React.ComponentPropsWithoutRef<"aside"> & {
  onSelectItem?: (type: GateType) => void;
};

const ComponentPalette = styled(({ onSelectItem, ...other }: ComponentPaletteProps) => {
  return (
    <aside {...other} data-component="ComponentPalette">
      <div className="palette-header">
        <h2 className="palette-title">Bausteine</h2>
      </div>

      <div className="palette-content">
        {CATEGORIES.map((category) => (
          <div key={category.title} className="category-group">
            <h3 className="category-title">{category.title}</h3>
            <div className="category-items">
              {category.items.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  className="palette-item"
                  onClick={() => onSelectItem?.(item.type)}
                >
                  <span className="item-label">{item.label}</span>
                  <span className="item-description">{item.description}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
})({
  display: "flex",
  flexDirection: "column",
  width: "16rem",
  backgroundColor: "var(--color-bg-surface)",
  borderRight: "1px solid var(--color-border-subtle)",
  overflowY: "auto",
  userSelect: "none",

  "& > .palette-header": {
    padding: "0.85rem 1rem",
    borderBottom: "1px solid var(--color-border-subtle)",

    "& > .palette-title": {
      margin: 0,
      fontSize: "0.95rem",
      fontWeight: 600,
      color: "var(--color-text-secondary)",
      textTransform: "uppercase",
      letterSpacing: "0.05rem",
    },
  },

  "& > .palette-content": {
    display: "flex",
    flexDirection: "column",
    padding: "0.75rem",
    gap: "1rem",

    "& > .category-group": {
      display: "flex",
      flexDirection: "column",
      gap: "0.4rem",

      "& > .category-title": {
        margin: "0 0.25rem",
        fontSize: "0.8rem",
        fontWeight: 600,
        color: "var(--color-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.03rem",
      },

      "& > .category-items": {
        display: "flex",
        flexDirection: "column",
        gap: "0.3rem",

        "& > .palette-item": {
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          padding: "0.5rem 0.6rem",
          backgroundColor: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "0.375rem",
          cursor: "pointer",
          textAlign: "left",
          transition: "all 0.15s ease",

          "&:hover": {
            backgroundColor: "var(--color-bg-base)",
            borderColor: "var(--color-accent-primary)",
          },

          "& > .item-label": {
            fontSize: "0.85rem",
            fontWeight: 500,
            color: "var(--color-text-primary)",
          },

          "& > .item-description": {
            fontSize: "0.75rem",
            color: "var(--color-text-muted)",
            marginTop: "0.15rem",
          },
        },
      },
    },
  },
});

export default ComponentPalette;
