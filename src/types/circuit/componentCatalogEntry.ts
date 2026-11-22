import type ComponentCatalogPin from "./componentCatalogPin";
import type ComponentCatalogProperty from "./componentCatalogProperty";
import type ComponentPaletteCategory from "./componentPaletteCategory";
import type PaletteGateType from "./paletteGateType";

// Vollständiger Katalog-Eintrag für einen Baustein (Palette und MCP)
type ComponentCatalogEntry = {
  type: PaletteGateType | "subCircuit" | "textNote";
  paletteCategory: ComponentPaletteCategory;
  label: string;
  description: string;
  paletteVisible: boolean;
  aliasOf?: PaletteGateType;
  hasVariableInputs?: boolean;
  defaultSize: { width: number; height: number };
  resizable: boolean;
  minSize?: { width: number; height: number };
  maxSize?: { width: number; height: number };
  isDisplay: boolean;
  hasDynamicPinLayout: boolean;
  pinLayoutDependsOn: readonly string[];
  wiringHint?: string;
  pins: ComponentCatalogPin[];
  properties: ComponentCatalogProperty[];
};

export default ComponentCatalogEntry;
