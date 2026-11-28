import type FrameRateLimit from "../simulation/frameRateLimit";

import type AppLanguage from "./appLanguage";
import type CollabCursorIdleTimeoutSec from "./collabCursorIdleTimeout";
import type CollabCursorVisibilityMode from "./collabCursorVisibilityMode";
import type StartupProjectMode from "./startupProjectMode";

// Globale Anwendungseinstellungen für Startverhalten, Sprache, Taktfrequenz, Audio und WebRTC-STUN-Server
type AppSettings = {
  startupProjectMode: StartupProjectMode;
  defaultFrequency: FrameRateLimit;
  language: AppLanguage;
  audioVolume: number;
  audioMuted: boolean;
  collabStunUrls?: string[];
  collabCursorIdleTimeoutSec?: CollabCursorIdleTimeoutSec;
  collabCursorVisibilityMode?: CollabCursorVisibilityMode;
};

export default AppSettings;
