import React from "react";

import styled from "@emotion/styled";

type PaletteCategoryProps = {
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

// Kreisrunder Expander-Button analog zum WPF-Expander im Desktop-Original
const ExpanderCircle = ({ isExpanded }: { isExpanded: boolean }) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    className="expander-circle"
  >
    <circle
      cx={8}
      cy={8}
      r={7}
      fill="none"
      stroke="var(--color-border-strong)"
      strokeWidth={1}
    />
    <path
      d={isExpanded ? "M 5 9.5 L 8 6.5 L 11 9.5" : "M 5 6.5 L 8 9.5 L 11 6.5"}
      fill="none"
      stroke="var(--color-text-secondary)"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PaletteCategory = styled(({
  title,
  isExpanded,
  onToggle,
  children,
  ...other
}: PaletteCategoryProps & React.ComponentPropsWithoutRef<"div">) => {
  return (
    <div
      {...other}
      data-component="PaletteCategory"
    >
      <button
        type="button"
        className="category-header"
        onClick={onToggle}
        aria-expanded={isExpanded}
      >
        <ExpanderCircle isExpanded={isExpanded} />
        <span className="category-title">{title}</span>
      </button>

      {isExpanded && <div className="category-content">{children}</div>}
    </div>
  );
})({
  display: "flex",
  flexDirection: "column",
  marginBottom: "0.25rem",

  "& > .category-header": {
    display: "flex",
    alignItems: "center",
    gap: "0.55rem",
    width: "100%",
    padding: "0.45rem 0.5rem",
    background: "transparent",
    border: "none",
    borderBottom: "1px solid var(--color-border-subtle)",
    cursor: "pointer",
    textAlign: "left",
    borderRadius: "0.25rem",
    transition: "background-color 0.15s ease",

    "&:hover": {
      backgroundColor: "var(--color-bg-elevated)",

      "& .expander-circle circle": {
        stroke: "var(--color-text-primary)",
      },
      "& .expander-circle path": {
        stroke: "var(--color-text-primary)",
      },
      "& > .category-title": {
        color: "var(--color-text-primary)",
      },
    },

    "& > .category-title": {
      fontSize: "0.82rem",
      fontWeight: 600,
      color: "var(--color-text-secondary)",
      letterSpacing: "0.02rem",
      userSelect: "none",
      transition: "color 0.15s ease",
    },
  },

  "& > .category-content": {
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
    paddingTop: "0.25rem",
    paddingBottom: "0.25rem",
  },
});

export default PaletteCategory;
