import type FrameRateLimit from "../simulation/frameRateLimit";

import type AppLanguage from "./appLanguage";
import type StartupProjectMode from "./startupProjectMode";

// Globale Anwendungseinstellungen für Startverhalten, Sprache und Standard-Taktfrequenz neuer Projekte
type AppSettings = {
  startupProjectMode: StartupProjectMode;
  defaultFrequency: FrameRateLimit;
  language: AppLanguage;
  audioVolume: number;
  audioMuted: boolean;
};

export default AppSettings;
