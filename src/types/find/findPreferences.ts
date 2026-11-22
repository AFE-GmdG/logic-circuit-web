import type FindScope from "./findScope";

// Persistierte Suchoptionen und LRU-Verlauf für die Projektsuche (US-015)
type FindPreferences = {
  scope: FindScope;
  matchCase: boolean;
  wholeWord: boolean;
  includeNotes: boolean;
  recentQueries: string[];
};

export default FindPreferences;
