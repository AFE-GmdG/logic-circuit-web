// Konfigurierbare Eigenschaft eines Bausteins im Komponenten-Katalog
type ComponentCatalogProperty = {
  name: string;
  type: "string" | "integer" | "boolean" | "enum";
  description: string;
  defaultValue?: string | number | boolean;
  min?: number;
  max?: number;
  enumValues?: readonly string[];
  settableOnCreate: boolean;
  settableOnUpdate: boolean;
};

export default ComponentCatalogProperty;
