export const COLLAB_CURSOR_VISIBILITY_MODES = [
  "all",
  "collaborators-and-raised-hand",
  "collaborators",
  "raised-hand",
] as const;

export const DEFAULT_COLLAB_CURSOR_VISIBILITY_MODE = "all" as const;

// Sichtbarkeitsmodus für Remote-Cursor zur Reduzierung visueller Unruhe
type CollabCursorVisibilityMode = (typeof COLLAB_CURSOR_VISIBILITY_MODES)[number];

export default CollabCursorVisibilityMode;
