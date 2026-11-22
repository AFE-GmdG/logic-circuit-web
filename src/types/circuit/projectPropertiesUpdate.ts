// Teilaktualisierung globaler Projekteinstellungen ohne Schaltungs-Undo
type ProjectPropertiesUpdate = {
  name?: string;
  note?: string;
  frequency?: number;
  isMaximumSpeed?: boolean;
};

export default ProjectPropertiesUpdate;
