import React from "react";

import type CircuitProject from "../../types/circuit/circuitProject";
import type CircuitShape from "../../types/circuit/circuitShape";
import type DisplayMargin from "../../types/circuit/displayMargin";
import type { LibraryPersistenceState } from "../../types/storage/circuitLibrary";
import type { NativeLogicalCircuit } from "../../types/storage/nativeProjectFormat";

import type { BuiltInCircuitKey, BuiltInLibraryItem } from "../../utils/builtInLibraryCatalog";
import type { TransferToLibraryResult } from "../../utils/libraryCircuitTransfer";

export type SidebarPaletteTab = "project" | "library";

export type LibraryCircuitMetadataUpdate = {
  name?: string;
  notation?: string;
  category?: string;
  note?: string;
  circuitShape?: CircuitShape;
  showLabelAbove?: boolean;
  displayMargin?: DisplayMargin;
  exportToHDL?: boolean;
  pinOrder?: { pinId: string; index: number }[];
};

export type LibraryDeleteDependent = {
  logicalCircuitId: string;
  name: string;
};

export type LibraryDeleteResult = {
  deletedIds: string[];
  blockedByDependents: LibraryDeleteDependent[];
};

export type LibraryContextType = {
  activeSidebarTab: SidebarPaletteTab;
  setActiveSidebarTab: (tab: SidebarPaletteTab) => void;
  persistenceState: LibraryPersistenceState;
  isLoading: boolean;
  isResyncWarningDismissed: boolean;
  dismissResyncWarning: () => void;
  libraryError: string | null;
  clearLibraryError: () => void;
  builtInItems: readonly BuiltInLibraryItem[];
  builtInCircuits: readonly NativeLogicalCircuit[];
  userCircuits: readonly NativeLogicalCircuit[];
  isWritable: boolean;
  editingLibraryCircuitId: string | null;
  isEditingLibrary: boolean;
  openLibraryFile: () => Promise<boolean>;
  openLibraryFromText: (rawText: string, fileName?: string | null) => boolean;
  createLibraryFile: (suggestedName?: string) => Promise<boolean>;
  resyncLibrary: () => Promise<boolean>;
  unlinkLibrary: () => Promise<void>;
  reloadInitialLibrary: () => Promise<void>;
  addProjectCircuitToLibrary: (
    project: CircuitProject,
    rootCircuitId: string,
    metadataOverrides?: LibraryCircuitMetadataUpdate,
  ) => Promise<TransferToLibraryResult | null>;
  duplicateBuiltInToLibrary: (builtInKey: BuiltInCircuitKey) => Promise<TransferToLibraryResult | null>;
  updateLibraryCircuitMetadata: (
    circuitId: string,
    updates: LibraryCircuitMetadataUpdate,
  ) => Promise<boolean>;
  getLibraryDeletionDependents: (circuitId: string) => LibraryDeleteDependent[];
  deleteLibraryCircuits: (
    circuitId: string,
    options?: { cascadeDependents?: boolean },
  ) => Promise<LibraryDeleteResult>;
  importCircuitsIntoLibrary: (
    rawText: string,
    selectedRootCircuitIds?: readonly string[],
  ) => Promise<number>;
  exportLibraryCircuitNative: (circuitId: string) => void;
  exportLibraryCircuitXml: (circuitId: string) => void;
  exportLibraryDocument: () => void;
  enterLibraryEditMode: (circuitId: string) => Promise<boolean>;
  saveLibraryEditSession: () => Promise<boolean>;
  exitLibraryEditMode: () => Promise<void>;
  getSavedSessionProject?: () => CircuitProject | null;
  updateSavedSessionProject?: (nextProject: CircuitProject) => void;
};

const LibraryContext = React.createContext<LibraryContextType | undefined>(undefined);

export default LibraryContext;
