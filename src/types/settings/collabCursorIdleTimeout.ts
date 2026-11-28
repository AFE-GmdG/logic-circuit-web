export const COLLAB_CURSOR_IDLE_TIMEOUT_OPTIONS = [5, 10, 15, 30, 0] as const;
export const DEFAULT_COLLAB_CURSOR_IDLE_TIMEOUT_SEC = 10 as const;

// Ausblendzeit für regungslose Remote-Cursor in Sekunden (0 = dauerhaft anzeigen)
type CollabCursorIdleTimeoutSec = (typeof COLLAB_CURSOR_IDLE_TIMEOUT_OPTIONS)[number];

export default CollabCursorIdleTimeoutSec;
