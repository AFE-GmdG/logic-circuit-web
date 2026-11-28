import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";

import type {
  CollabMutationRequestPayload,
  CollabSerializedMutation,
} from "../types/collab/modelSyncMessage";
import {
  COLLAB_APP_TOPIC_CATCHUP_RESPONSE,
  COLLAB_APP_TOPIC_CIRCUIT_COMMIT,
  COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REJECTED,
  COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REQUEST,
  COLLAB_APP_TOPIC_HOST_HANDOVER_READY,
  COLLAB_APP_TOPIC_HOST_HANDOVER_STATE,
  COLLAB_APP_TOPIC_PROJECT_SNAPSHOT,
  COLLAB_APP_TOPIC_SESSION_QUIESCE,
  COLLAB_APP_TOPIC_SOFT_LOCK,
} from "../types/collab/modelSyncMessage";
import type CollabParticipant from "../types/collab/sessionState";
import type CircuitDelta from "../types/history/circuitDelta";

import { authorizeCollabAction } from "../collab/collabAuthorization";
import {
  applySerializedMutationToProject,
  decodeProjectSnapshot,
  encodeCircuitDeltaToMutation,
  encodeProjectSnapshot,
  extractMutationHighlightIds,
  validateSerializedMutation,
} from "../collab/collabModelCodec";
import CollabRevisionEngine, { DEFAULT_COLLAB_REVISION_RING_BUFFER_SIZE } from "../collab/collabRevisionEngine";
import {
  createCircuitSymbol,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createTextNote,
  instantiateCircuitFromPalette,
} from "../utils/circuitLayout";
import { generateEntityUuid, isUuid, UUID_V4_PATTERN } from "../utils/entityId";
import { createWire } from "../utils/wireUtils";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createParticipant(overrides: Partial<CollabParticipant> & { peerId: string }): CollabParticipant {
  return {
    role: "guest",
    displayName: "Teilnehmer",
    nameLocked: false,
    handRaised: false,
    connectionState: "connected",
    ...overrides,
  };
}

function ContextProbe({
  onCapture,
}: {
  onCapture: (ctx: React.ContextType<typeof CircuitContext>) => void;
}) {
  const ctx = React.useContext(CircuitContext);
  onCapture(ctx);
  return null;
}

describe("T-098: Zentrale UUID-Vergabe, Modell-Sync-Protokoll, Codec & Revisions-Ringpuffer", () => {
  it("erzeugt kollisionsfreie RFC-4122-v4-UUIDs für neue Bauteile, Leitungen, Textnotizen und Schaltpläne", () => {
    const generated = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const id = generateEntityUuid();
      expect(UUID_V4_PATTERN.test(id)).toBe(true);
      expect(isUuid(id)).toBe(true);
      expect(generated.has(id)).toBe(false);
      generated.add(id);
    }

    const project = createEmptyCircuitProject();
    const mainId = project.logicalCircuits[0].logicalCircuitId;

    const wire = createWire(mainId, { x: 2, y: 2 }, { x: 8, y: 2 });
    expect(isUuid(wire.wireId)).toBe(true);

    const note = createTextNote(mainId, 4, 4, "Hallo");
    expect(isUuid(note.textNoteId)).toBe(true);

    // Kanonische Gatter behalten ihre geteilte Gate-ID, erhalten aber eine UUID als Symbol-ID
    const gatePlacement = instantiateCircuitFromPalette(
      project,
      mainId,
      { type: "and", name: "AND", inputCount: 2 },
      { x: 6, y: 6 },
    );
    expect(gatePlacement.circuit.circuitId).toBe("00000000-0000-0000-0000-000000040200");
    expect(isUuid(gatePlacement.circuitSymbol.circuitSymbolId)).toBe(true);

    const buttonPlacement = instantiateCircuitFromPalette(
      project,
      mainId,
      { type: "button", name: "Taster" },
      { x: 10, y: 10 },
    );
    expect(isUuid(buttonPlacement.circuit.circuitId)).toBe(true);
    expect(isUuid(buttonPlacement.circuitSymbol.circuitSymbolId)).toBe(true);

    const ramPlacement = instantiateCircuitFromPalette(
      project,
      mainId,
      { type: "ram", name: "RAM" },
      { x: 14, y: 10 },
    );
    expect(isUuid(ramPlacement.circuit.circuitId)).toBe(true);
    expect(isUuid(ramPlacement.circuitSymbol.circuitSymbolId)).toBe(true);

    // Auch neu angelegte LogicalCircuits über CircuitContext erhalten kollisionsfreie UUIDs
    let ctx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      React.createElement(CircuitContextProvider, {
        initialProject: project,
        children: React.createElement(ContextProbe, {
          onCapture: (c) => {
            ctx = c;
          },
        }),
      }),
    );
    let createdAId = "";
    let createdBId = "";
    React.act(() => {
      const [lcA, lcB] = ctx.createCircuits([{ name: "Adder" }, { name: "Adder" }]);
      createdAId = lcA.logicalCircuitId;
      createdBId = lcB.logicalCircuitId;
    });
    expect(isUuid(createdAId)).toBe(true);
    expect(isUuid(createdBId)).toBe(true);
    expect(createdAId).not.toBe(createdBId);
  });

  it("autorisiert alle Modell-Sync- und Soft-Lock-Topics strikt nach Rolle", () => {
    const roster = [
      createParticipant({ peerId: "host-1", role: "host", displayName: "Host" }),
      createParticipant({ peerId: "collab-1", role: "collaborator", displayName: "Clara" }),
      createParticipant({ peerId: "guest-1", role: "guest", displayName: "Gustav" }),
    ];

    const hostOnlyTopics = [
      COLLAB_APP_TOPIC_PROJECT_SNAPSHOT,
      COLLAB_APP_TOPIC_CIRCUIT_COMMIT,
      COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REJECTED,
      COLLAB_APP_TOPIC_CATCHUP_RESPONSE,
      COLLAB_APP_TOPIC_HOST_HANDOVER_STATE,
      COLLAB_APP_TOPIC_SESSION_QUIESCE,
    ];
    for (const topic of hostOnlyTopics) {
      expect(authorizeCollabAction("collab-1", { kind: "app", topic, payload: {} }, roster)).toMatchObject({
        allowed: false,
        code: "host-only",
      });
      expect(authorizeCollabAction("host-1", { kind: "app", topic, payload: {} }, roster)).toEqual({
        allowed: true,
      });
    }

    const validMutationReq = {
      kind: "app" as const,
      topic: COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REQUEST,
      payload: {
        mutationId: "m-1",
        baseRevision: 0,
        mutation: { type: "updateProjectProperties", updates: { name: "Team-CPU" } },
      },
    };
    expect(authorizeCollabAction("guest-1", validMutationReq, roster)).toMatchObject({
      allowed: false,
      code: "unauthorized-role",
    });
    expect(authorizeCollabAction("collab-1", validMutationReq, roster)).toEqual({ allowed: true });

    expect(
      authorizeCollabAction(
        "collab-1",
        { kind: "app", topic: COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REQUEST, payload: { mutationId: "" } },
        roster,
      ),
    ).toMatchObject({ allowed: false, code: "invalid-payload" });

    const validSoftLock = {
      kind: "app" as const,
      topic: COLLAB_APP_TOPIC_SOFT_LOCK,
      payload: { action: "acquire", locks: [] },
    };
    expect(authorizeCollabAction("guest-1", validSoftLock, roster)).toMatchObject({
      allowed: false,
      code: "unauthorized-role",
    });
    expect(authorizeCollabAction("collab-1", validSoftLock, roster)).toEqual({ allowed: true });

    // Host-Handover kann auch an Gäste übertragen werden -> host-handover-ready ist für Gäste erlaubt
    const readyMsg = {
      kind: "app" as const,
      topic: COLLAB_APP_TOPIC_HOST_HANDOVER_READY,
      payload: { targetPeerId: "guest-1", acceptedRevision: 4, ok: true },
    };
    expect(authorizeCollabAction("guest-1", readyMsg, roster)).toEqual({ allowed: true });
    expect(
      authorizeCollabAction(
        "guest-1",
        { kind: "app", topic: COLLAB_APP_TOPIC_HOST_HANDOVER_READY, payload: { ok: true } },
        roster,
      ),
    ).toMatchObject({ allowed: false, code: "invalid-payload" });
  });

  it("serialisiert Snapshots und alle Schaltungs-Mutationen verlustfrei über JSON-Roundtrips", () => {
    let project = createEmptyCircuitProject();
    const mainId = project.logicalCircuits[0].logicalCircuitId;

    // Snapshot-Roundtrip
    const snapshotJson = cloneJson(encodeProjectSnapshot(project));
    const decodedSnapshot = decodeProjectSnapshot(snapshotJson);
    expect(decodedSnapshot.logicalCircuits[0].logicalCircuitId).toBe(mainId);

    // add (Symbol + Pin + TextNote + Wire)
    const gatePlacement = instantiateCircuitFromPalette(
      project,
      mainId,
      { type: "and", name: "AND", inputCount: 2 },
      { x: 10, y: 10 },
    );
    const pinPlacement = instantiateCircuitFromPalette(
      project,
      mainId,
      { type: "pinIn", name: "Pin (Eingang)", notation: "A" },
      { x: 4, y: 10 },
    );
    const ramPlacement = instantiateCircuitFromPalette(
      project,
      mainId,
      { type: "ram", name: "RAM" },
      { x: 20, y: 10 },
    );
    const note = createTextNote(mainId, 4, 4, "Testnotiz");
    const wire = createWire(mainId, { x: 6, y: 10 }, { x: 10, y: 10 });

    const pinRecord = project.pins.find((p) => p.pinId === pinPlacement.circuit.circuitId);
    const addDelta: CircuitDelta = {
      type: "add",
      logicalCircuitId: mainId,
      symbols: [
        { symbol: gatePlacement.circuitSymbol, circuit: gatePlacement.circuit },
        { symbol: pinPlacement.circuitSymbol, circuit: pinPlacement.circuit, pin: pinRecord },
        { symbol: ramPlacement.circuitSymbol, circuit: ramPlacement.circuit },
      ],
      textNotes: [note],
      wires: [wire],
    };
    const addMutation = cloneJson(encodeCircuitDeltaToMutation(addDelta, project));
    expect(validateSerializedMutation(addMutation)).toBe(true);
    project = applySerializedMutationToProject(project, addMutation);
    expect(project.circuitSymbols).toHaveLength(3);
    expect(project.textNotes).toHaveLength(1);
    expect(project.wires).toHaveLength(1);
    expect(project.memories).toHaveLength(1);

    // move & rotate
    const symId = gatePlacement.circuitSymbol.circuitSymbolId;
    const moveMutation = cloneJson<CollabSerializedMutation>({
      type: "move",
      logicalCircuitId: mainId,
      symbolIds: [symId],
      textNoteIds: [note.textNoteId],
      dx: 2,
      dy: 3,
      symbolPositions: [{ symbolId: symId, before: { x: 10, y: 10 }, after: { x: 12, y: 13 } }],
      textNotePositions: [{ textNoteId: note.textNoteId, before: { x: 4, y: 4 }, after: { x: 6, y: 7 } }],
    });
    expect(validateSerializedMutation(moveMutation)).toBe(true);
    project = applySerializedMutationToProject(project, moveMutation);
    expect(project.circuitSymbols.find((s) => s.circuitSymbolId === symId)).toMatchObject({ x: 12, y: 13 });
    expect(project.textNotes.find((n) => n.textNoteId === note.textNoteId)).toMatchObject({ x: 6, y: 7 });

    const rotateMutation = cloneJson<CollabSerializedMutation>({
      type: "rotate",
      logicalCircuitId: mainId,
      direction: "clockwise",
      symbols: [{ symbolId: symId, before: { x: 12, y: 13, rotation: "up" }, after: { x: 12, y: 13, rotation: "right" } }],
      textNotes: [{ textNoteId: note.textNoteId, before: { x: 6, y: 7, rotation: "up" }, after: { x: 6, y: 7, rotation: "right" } }],
    });
    expect(validateSerializedMutation(rotateMutation)).toBe(true);
    project = applySerializedMutationToProject(project, rotateMutation);
    expect(project.circuitSymbols.find((s) => s.circuitSymbolId === symId)?.rotation).toBe("right");

    // wireBatch
    const extraWire = createWire(mainId, { x: 12, y: 10 }, { x: 16, y: 10 });
    const wireBatchMutation = cloneJson<CollabSerializedMutation>({
      type: "wireBatch",
      logicalCircuitId: mainId,
      addedWires: [{ wireId: extraWire.wireId, x1: 12, y1: 10, x2: 16, y2: 10 }],
      removedWireIds: [],
      updatedWires: [{ wireId: wire.wireId, before: { x1: 6, y1: 10, x2: 10, y2: 10 }, after: { x1: 6, y1: 10, x2: 12, y2: 10 } }],
    });
    expect(validateSerializedMutation(wireBatchMutation)).toBe(true);
    project = applySerializedMutationToProject(project, wireBatchMutation);
    expect(project.wires).toHaveLength(2);

    // updateProperty (Symbol, TextNote, LogicalCircuit)
    const propNoteMutation = cloneJson<CollabSerializedMutation>({
      type: "updateProperty",
      logicalCircuitId: mainId,
      targetType: "textNote",
      targetId: note.textNoteId,
      afterTextNote: {
        textNoteId: note.textNoteId,
        x: 6,
        y: 7,
        width: note.width,
        height: note.height,
        note: "Geändert",
        rotation: "right",
        lineHeight: 36,
        fontFamily: "sans",
        lineHeights: null,
      },
    });
    expect(validateSerializedMutation(propNoteMutation)).toBe(true);
    project = applySerializedMutationToProject(project, propNoteMutation);
    expect(project.textNotes[0].note).toBe("Geändert");

    const propLcMutation = cloneJson<CollabSerializedMutation>({
      type: "updateProperty",
      logicalCircuitId: mainId,
      targetType: "logicalCircuit",
      targetId: mainId,
      afterLogicalCircuit: {
        name: "Hauptschaltplan",
        notation: "MAIN",
        category: "Top",
        note: "Aktualisiert",
        circuitShape: "rectangular",
        showLabelAbove: true,
        exportToHDL: true,
      },
    });
    expect(validateSerializedMutation(propLcMutation)).toBe(true);
    project = applySerializedMutationToProject(project, propLcMutation);
    expect(project.logicalCircuits[0].name).toBe("Hauptschaltplan");

    // updateMemoryData & updateProjectProperties
    const memId = project.memories[0].memoryId;
    const memMutation = cloneJson<CollabSerializedMutation>({
      type: "updateMemoryData",
      updates: [{ memoryId: memId, data: "00:ff aa 55" }],
    });
    expect(validateSerializedMutation(memMutation)).toBe(true);
    project = applySerializedMutationToProject(project, memMutation);
    expect(project.memories[0].data).toBe("00:ff aa 55");

    const projPropsMutation = cloneJson<CollabSerializedMutation>({
      type: "updateProjectProperties",
      updates: { name: "Kollab-Projekt", frequency: 25, isMaximumSpeed: true },
    });
    expect(validateSerializedMutation(projPropsMutation)).toBe(true);
    project = applySerializedMutationToProject(project, projPropsMutation);
    expect(project.project.name).toBe("Kollab-Projekt");
    expect(project.project.frequency).toBe(25);
    expect(project.project.isMaximumSpeed).toBe(true);

    // createCircuits, importLibraryCircuit & deleteCircuits
    const subUuid = generateEntityUuid();
    const createSubMutation = cloneJson<CollabSerializedMutation>({
      type: "createCircuits",
      circuits: [
        {
          logicalCircuitId: subUuid,
          name: "SubA",
          notation: "SA",
          note: "",
          category: "Sub",
          circuitShape: "rectangular",
          showLabelAbove: false,
          displayMargin: "none",
          validators: "",
          exportToHDL: false,
          pins: [],
          elements: [],
          wires: [],
          textNotes: [],
        },
      ],
    });
    expect(validateSerializedMutation(createSubMutation)).toBe(true);
    project = applySerializedMutationToProject(project, createSubMutation);
    expect(project.logicalCircuits.some((lc) => lc.logicalCircuitId === subUuid)).toBe(true);

    const libUuid = generateEntityUuid();
    const libPlacedSymId = generateEntityUuid();
    const libImportMutation = cloneJson<CollabSerializedMutation>({
      type: "importLibraryCircuit",
      addedCircuits: [
        {
          logicalCircuitId: libUuid,
          name: "LibHalfAdder",
          notation: "HA",
          note: "",
          category: "Lib",
          circuitShape: "rectangular",
          showLabelAbove: false,
          displayMargin: "none",
          validators: "",
          exportToHDL: false,
          pins: [],
          elements: [],
          wires: [],
          textNotes: [],
        },
      ],
      targetCircuitId: mainId,
      placedElement: {
        kind: "subCircuit",
        symbolId: libPlacedSymId,
        logicalCircuitId: libUuid,
        x: 30,
        y: 12,
        rotation: "up",
      },
    });
    expect(validateSerializedMutation(libImportMutation)).toBe(true);
    project = applySerializedMutationToProject(project, libImportMutation);
    expect(project.logicalCircuits.some((lc) => lc.logicalCircuitId === libUuid)).toBe(true);
    expect(project.circuitSymbols.some((s) => s.circuitSymbolId === libPlacedSymId)).toBe(true);

    const deleteMutation = cloneJson<CollabSerializedMutation>({
      type: "deleteCircuits",
      circuitIds: [subUuid],
    });
    expect(validateSerializedMutation(deleteMutation)).toBe(true);
    project = applySerializedMutationToProject(project, deleteMutation);
    expect(project.logicalCircuits.some((lc) => lc.logicalCircuitId === subUuid)).toBe(false);

    // remove
    const removeMutation = cloneJson<CollabSerializedMutation>({
      type: "remove",
      logicalCircuitId: mainId,
      symbolIds: [symId],
      textNoteIds: [note.textNoteId],
      wireIds: [extraWire.wireId],
    });
    expect(validateSerializedMutation(removeMutation)).toBe(true);
    project = applySerializedMutationToProject(project, removeMutation);
    expect(project.circuitSymbols.some((s) => s.circuitSymbolId === symId)).toBe(false);
    expect(project.textNotes).toHaveLength(0);
    expect(project.wires.some((w) => w.wireId === extraWire.wireId)).toBe(false);
  });

  it("führt disjunkte Mutationen zusammen, lehnt Konflikte/ID-Kollisionen ab und liefert Ringpuffer-Catch-up", () => {
    const project = createEmptyCircuitProject();
    const mainId = project.logicalCircuits[0].logicalCircuitId;
    const engine = new CollabRevisionEngine({ initialProject: project, now: () => 1000 });

    expect(DEFAULT_COLLAB_REVISION_RING_BUFFER_SIZE).toBe(200);

    // Zwei disjunkte Bauteile auf Revision 0 erzeugen -> Peer B mit baseRevision=0 wird gemergt
    const symAId = generateEntityUuid();
    const symBId = generateEntityUuid();
    const reqA: CollabMutationRequestPayload = {
      mutationId: "mut-a",
      baseRevision: 0,
      origin: "mcp",
      mutation: {
        type: "add",
        logicalCircuitId: mainId,
        entities: {
          logicalCircuitId: mainId,
          pins: [],
          elements: [
            {
              kind: "gate",
              symbolId: symAId,
              x: 4,
              y: 4,
              rotation: "up",
              gateType: "and",
              inputCount: 2,
              invertedOutput: false,
              color: null,
              note: "",
            },
          ],
          wires: [],
          textNotes: [],
        },
      },
    };
    const resA = engine.submitMutation(reqA, "host-1");
    expect(resA.accepted).toBe(true);
    if (resA.accepted) {
      expect(resA.commit.revision).toBe(1);
      expect(resA.commit.origin).toBe("mcp");
      expect(resA.commit.highlightIds?.symbolIds).toEqual([symAId]);
    }

    // Idempotente Wiederholung von mut-a erhöht Revision nicht
    const resADup = engine.submitMutation(reqA, "host-1");
    expect(resADup.accepted).toBe(true);
    if (resADup.accepted) {
      expect(resADup.deduplicated).toBe(true);
      expect(resADup.commit.revision).toBe(1);
    }

    // Parallele disjunkte Mutation auf baseRevision=0 wird angenommen
    const reqB: CollabMutationRequestPayload = {
      mutationId: "mut-b",
      baseRevision: 0,
      mutation: {
        type: "add",
        logicalCircuitId: mainId,
        entities: {
          logicalCircuitId: mainId,
          pins: [],
          elements: [
            {
              kind: "gate",
              symbolId: symBId,
              x: 16,
              y: 4,
              rotation: "up",
              gateType: "or",
              inputCount: 2,
              invertedOutput: false,
              color: null,
              note: "",
            },
          ],
          wires: [],
          textNotes: [],
        },
      },
    };
    const resB = engine.submitMutation(reqB, "collab-1");
    expect(resB.accepted).toBe(true);
    if (resB.accepted) {
      expect(resB.commit.revision).toBe(2);
      expect(resB.commit.origin).toBe("user");
      expect(extractMutationHighlightIds(resB.commit.mutation).symbolIds).toEqual([symBId]);
    }

    // ID-Kollision ohne Remapping wird deterministisch abgelehnt
    const collisionRes = engine.submitMutation(
      {
        mutationId: "mut-collision",
        baseRevision: 2,
        mutation: {
          type: "add",
          logicalCircuitId: mainId,
          entities: {
            logicalCircuitId: mainId,
            pins: [],
            elements: [
              {
                kind: "gate",
                symbolId: symAId,
                x: 20,
                y: 20,
                rotation: "up",
                gateType: "not",
                inputCount: 1,
                invertedOutput: false,
                color: null,
                note: "",
              },
            ],
            wires: [],
            textNotes: [],
          },
        },
      },
      "collab-1",
    );
    expect(collisionRes).toMatchObject({
      accepted: false,
      rejection: { code: "id-collision", requiresResync: true, conflictingEntityIds: [symAId] },
    });

    // Zwei parallele Moves auf dasselbe Symbol symAId -> Zweiter mit veralteter baseRevision wird abgelehnt
    const move1 = engine.submitMutation(
      {
        mutationId: "mut-move-1",
        baseRevision: 2,
        mutation: {
          type: "move",
          logicalCircuitId: mainId,
          symbolIds: [symAId],
          textNoteIds: [],
          dx: 2,
          dy: 0,
        },
      },
      "host-1",
    );
    expect(move1.accepted).toBe(true);

    const move2 = engine.submitMutation(
      {
        mutationId: "mut-move-2",
        baseRevision: 2,
        mutation: {
          type: "move",
          logicalCircuitId: mainId,
          symbolIds: [symAId],
          textNoteIds: [],
          dx: 0,
          dy: 2,
        },
      },
      "collab-1",
    );
    expect(move2).toMatchObject({
      accepted: false,
      rejection: { code: "conflict", requiresResync: true, conflictingEntityIds: [symAId] },
    });

    // Konkurrierende Wire-Topologie-Mutationen im selben Schaltplan führen zum Konflikt
    const wire1Id = generateEntityUuid();
    const wire2Id = generateEntityUuid();
    const wireRes1 = engine.submitMutation(
      {
        mutationId: "mut-wire-1",
        baseRevision: 3,
        mutation: {
          type: "wireBatch",
          logicalCircuitId: mainId,
          addedWires: [{ wireId: wire1Id, x1: 2, y1: 2, x2: 8, y2: 2 }],
          removedWireIds: [],
          updatedWires: [],
        },
      },
      "host-1",
    );
    expect(wireRes1.accepted).toBe(true);

    const wireRes2 = engine.submitMutation(
      {
        mutationId: "mut-wire-2",
        baseRevision: 3,
        mutation: {
          type: "wireBatch",
          logicalCircuitId: mainId,
          addedWires: [{ wireId: wire2Id, x1: 2, y1: 2, x2: 12, y2: 2 }],
          removedWireIds: [],
          updatedWires: [],
        },
      },
      "collab-1",
    );
    expect(wireRes2).toMatchObject({
      accepted: false,
      rejection: { code: "conflict", requiresResync: true },
    });

    // Quiesce pausiert neue Mutationen bis zum Handover
    engine.setQuiesced(true);
    const quiescedRes = engine.submitMutation(
      {
        mutationId: "mut-quiesce",
        baseRevision: 4,
        mutation: { type: "updateProjectProperties", updates: { name: "Blockiert" } },
      },
      "collab-1",
    );
    expect(quiescedRes).toMatchObject({
      accepted: false,
      rejection: { code: "quiesced", requiresResync: false },
    });
    engine.setQuiesced(false);

    // Ringpuffer-Catch-up vs. Full-Snapshot-Fallback
    const catchupOk = engine.getCatchupSince(1);
    expect(catchupOk.requiresFullSnapshot).toBe(false);
    expect(catchupOk.entries.map((e) => e.revision)).toEqual([2, 3, 4]);

    const smallEngine = new CollabRevisionEngine({ initialProject: project, maxRingBufferSize: 2 });
    for (let i = 0; i < 4; i += 1) {
      smallEngine.submitMutation(
        {
          mutationId: `small-${i}`,
          baseRevision: i,
          mutation: { type: "updateProjectProperties", updates: { note: `Rev ${i + 1}` } },
        },
        "host-1",
      );
    }
    expect(smallEngine.getCatchupSince(1).requiresFullSnapshot).toBe(true);
    expect(smallEngine.getCatchupSince(2).requiresFullSnapshot).toBe(false);
    expect(smallEngine.getCatchupSince(2).entries.map((e) => e.revision)).toEqual([3, 4]);

    // Handover-Übernahme & Project-Reset
    const handoverSnap = smallEngine.createSnapshotPayload("initial");
    const restoredProject = decodeProjectSnapshot(handoverSnap.document);
    const handoverEngine = new CollabRevisionEngine({ initialProject: createEmptyCircuitProject() });
    handoverEngine.restoreFromHandover(restoredProject, {
      revision: smallEngine.getRevision(),
      epochId: smallEngine.getEpochId(),
      ringBuffer: smallEngine.getRingBuffer(),
    });
    expect(handoverEngine.getRevision()).toBe(4);
    expect(handoverEngine.getRingBuffer().map((e) => e.revision)).toEqual([3, 4]);

    const freshProject = createEmptyCircuitProject();
    const freshLc = createDefaultLogicalCircuit(generateEntityUuid(), "Neu");
    const gate = createGate("not", 1);
    freshLc.circuitSymbols.push(createCircuitSymbol(gate, freshLc.logicalCircuitId, 2, 2));
    freshProject.logicalCircuits.push(freshLc);
    const resetSnap = handoverEngine.resetWithProject(freshProject);
    expect(resetSnap.reason).toBe("project-switch");
    expect(resetSnap.revision).toBe(5);
    expect(handoverEngine.getCatchupSince(4).requiresFullSnapshot).toBe(true);
  });
});
