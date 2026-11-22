// Projekt-Metadaten und globale Einstellungen analog zu Project.cs
type Project = {
  projectId: string;
  name: string;
  note: string;
  zoom: number;
  frequency: number;
  isMaximumSpeed: boolean;
  logicalCircuitId: string;
  startupCircuitId?: string;
  categoryTextNoteCollapsed: boolean;
  categoryInputOutputCollapsed: boolean;
  categoryPrimitivesCollapsed: boolean;
};

export default Project;
