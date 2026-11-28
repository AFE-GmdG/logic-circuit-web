import type { FileSystemFileHandleLike } from "../../utils/fileSystemStorage";

import type {
  NATIVE_PROJECT_SCHEMA_VERSION,
  NativeLogicalCircuit,
} from "./nativeProjectFormat";

export const LIBRARY_FORMAT = "logic-circuit-web-library" as const;
export const LIBRARY_FILE_EXTENSION = ".lclib" as const;

// Synchronisierungs- und Berechtigungsstatus der lokalen Schaltungs-Bibliothek
export type LibrarySyncStatus =
  | "uninitialized"
  | "synced"
  | "needs-permission"
  | "handle-invalid"
  | "unsupported";

// Aktueller Persistenz-Zustand inklusive Read-Only-Flag für Cache-Fallbacks
export type LibraryPersistenceState = {
  status: LibrarySyncStatus;
  isReadOnly: boolean;
  fileName: string | null;
  handle?: FileSystemFileHandleLike | null;
  cachedAt: number | null;
  lastSyncedAt: number | null;
  document: CircuitLibraryDocument | null;
  errorReason?: string;
};

// Wählbare Schaltung samt transitiven Abhängigkeiten beim Import aus .lcweb oder .CircuitProject
export type LibraryProjectCircuitCandidate = {
  logicalCircuitId: string;
  name: string;
  category: string;
  note: string;
  isProjectRoot: boolean;
  transitiveCircuitIds: string[];
};

// Flaches Bibliotheks-Dokument ohne globales Projekt-Objekt und ohne Hauptschaltung
type CircuitLibraryDocument = {
  format: typeof LIBRARY_FORMAT;
  schemaVersion: typeof NATIVE_PROJECT_SCHEMA_VERSION;
  appVersion: string;
  logicalCircuits: NativeLogicalCircuit[];
};

export default CircuitLibraryDocument;
