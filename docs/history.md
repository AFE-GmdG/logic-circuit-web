# Was bisher geschah – Release-Chronik

[← Zurück zur Übersicht](intro.md) • [📋 Zum Scrum-Board](scrum-board.md)

Dieses Dokument fasst die abgeschlossenen User Stories, technischen Arbeitspakete und behobenen Fehlerberichte der Haupt- und Feature-Releases von **Logic Circuit Web** thematisch zusammen (`Release 1.2.0`, `Release 1.1.0` sowie `Release 1.0.0`). Die ursprünglichen Einzeldateien der ersten Produktversion wurden im Rahmen von `US-023` (`T-064`) zugunsten einer kompakten, kontextschonenden Projektdokumentation konsolidiert.

---

## Release 1.2.0 – Schaltungs-Bibliothek, Streamable-HTTP-MCP & WebRTC-Kollaboration

Im Minor-Release **1.2.0** wurde Logic Circuit Web um eine lokale Schaltungs-Bibliothek mit Standard-ICs, den auf Streamable HTTP und Self-Hosting umgestellten Remote-MCP-Sidecar sowie eine vollständige WebRTC-basierte Echtzeit-Kollaboration erweitert (`US-017`, `US-028` bis `US-032`, `US-034` inklusive `T-080` bis `T-108` sowie Bugfixes `B-005` bis `B-008`):

- **Schaltungs-Bibliothek & Standard-ICs (`US-017` / `T-080` bis `T-084`):**
  - Persistente Benutzer-Bibliothek über die File System Access API inklusive Read-Only-Reload-Cache, Standard-ICs mit optimiertem Leitungs-Layout, umschaltbarer Seitenleiste (`Projekt` ↔ `Bibliothek`), Subschaltungs-Extraktion mit Kopie-/Hash-Abgleich sowie farblich gekennzeichnetem Bibliotheks-Bearbeitungsmodus.
- **Streamable-HTTP-MCP, Sidecar-Schutz & Self-Hosting (`US-034` / `T-089` bis `T-093`):**
  - Vollständige Ablösung von `mcpCli.mjs` durch Streamable HTTP (`/mcp`), Auth-First- und Rate-Limiting-Schutz für MCP/Collab, Custom-Sidecar-Opt-in (inklusive GitHub Pages via Sidecar-CORS) sowie herunterladbares Sidecar-ZIP-Paket im Hauptmenü mit automatischem Versionsabgleich.
- **WebRTC-Signaling, P2P-Transport & Kollaborations-Sessions (`US-028`, `US-029` / `T-085` bis `T-088`, `T-094` bis `T-097`):**
  - Flüchtiges In-Memory-Signaling-Relay mit 5-Minuten-Hash-Einladungslinks (*Gast*/*Kollaborateur*) ohne Lobby oder Chat, STUN-Verbindungsaufbau mit Diagnose- und Resync-UI, DataChannel-Chunking mit Backpressure, Pflicht-Anzeigename, Namensmoderation/-sperre, „Hand heben“, hostseitiger Autorisierung und geschütztem Host-Handover (auch an Gäste) inklusive DSGVO-Hinweis.
- **Echtzeit-Synchronisation, Soft-Locking & benutzerbezogenes Undo/Redo (`US-030` / `T-098` bis `T-101`):**
  - Host-autoritative Revisions-Engine mit 200er-Ringpuffer-Catch-up, Optimistic UI mit Rollback, Quiesce-Handover und Projekt-Lade-Freeze, Soft-Locks mit TTL, Gast-Read-Only-Schutz (bei frei nutzbarem lokalem Bibliotheksmodus), MCP-KI-Highlights sowie konfliktfreiem benutzerbezogenem Undo/Redo.
- **Live-Präsenz, Cursor & unabhängige Navigation (`US-031` / `T-102` bis `T-105`):**
  - Einklappbares Teilnehmer-Panel mit lokaler `Name → Farbe`-Verwaltung, Schaltplan-Anzeige und Host-Link-Kopie, entkoppelte Live-Cursor mit konfigurierbarer Inaktivitäts-Ausblendung und Sichtbarkeits-Filtermodi, farbige Fremd-Selektionen und Soft-Locks, Paletten-Präsenzpunkte, unabhängige Navigation und „Teilnehmer folgen“.
- **Kollaborative Snapshot-Simulation mit Delta-Nachzug (`US-032` / `T-106`, `T-107`, `T-108`):**
  - Seiteneffektfreie lokale Snapshot-Simulation pro Teilnehmer (ohne RAM- oder Frequenz-Rückschreibung ins Team-Projekt) mit freier Sub-Schaltungsnavigation im eingefrorenen Snapshot, Hintergrund-Delta-Pufferung, Host-Kontinuität, automatischem Revisions-Nachzug bzw. Reconnect-Catch-up beim Stoppen sowie UI-Hinweisen mit Direktaktion zum Beenden & Übernehmen.
- **Behobene Bugs (`B-005` bis `B-008`):**
  - Saubere Trennung von benutzerdefinierten und festen Paletten-Kategorien (`B-005`), korrigierte Subschaltungs-Vorschau und Browser-DragImage (`B-006`), vollständiges Laden und Speichern im Bibliotheks-Metadaten-Dialog (`B-007`) sowie Ausblenden leerer Beschriftungen bei Schaltungen und Pins ohne Namens-Fallback (`B-008`).

---

## Release 1.1.0 – Analyse, Oszilloskop & HDL-Export

Im Minor-Release **1.1.0** wurde Logic Circuit Web um Analyse-, Debugging- und Export-Werkzeuge erweitert (`US-016`, `US-024`, `US-025`, `US-026` inklusive `T-068` bis `T-079` sowie Bugfix `B-002`):

- **Wahrheitstabelle, Verwendungsnachweis & Schaltungsbericht (`US-016` / `T-070`, `T-071`, `T-072`):**
  - **Verwendungsnachweis (`UsageDialog`):** Zeigt hierarchisch alle übergeordneten Schaltungen inklusive konkreter Subschaltungs-Fundstellen und direkter Sprungnavigation an.
  - **Schaltungsbericht (`ReportDialog`):** Erstellt eine strukturierte Projekt- und Schaltungsstatistik (Bauteile, Pins, Subschaltungs-Hierarchie, Beschreibungen) inklusive Markdown-Export und Zwischenablage-Kopie.
  - **Wahrheitstabelle (`CircuitTestSocket`, `ExpressionParser` & `TruthTableDialog`, `Strg+T`):** Vollständige bzw. gefilterte Auswertung kombinatorischer Schaltungen im WebWorker bis `4096` Zeilen inklusive referenzgetreuem `validators`-Ausdrucks-Parser, Sortierung, Filter-Verlauf und TSV-/CSV-Export.
- **Oszilloskop & zeitlicher Signalverlauf (`US-025` / `T-073`, `T-074`, `T-075`):**
  - **Signalhistorie im Worker (`OscilloscopeRecorder`):** Ringpuffer-Aufzeichnung aller `CircuitProbe`-Zustände (`0`, `1`, `Z`) je Simulationsschritt sowie benutzerdefinierter Trennmarkierungen.
  - **Einzelsonden-Verlauf (`ProbeHistoryDialog`):** Kontextmenü- und Doppelklick-Inspektion einzelner Messsonden inklusive Markieren und Kopieren des Signalverlaufs.
  - **Interaktives Oszilloskop (`OscilloscopeDialog`, `Strg+O`):** Schwebend und innerhalb des Viewports frei verschiebbares Timing-Diagramm mit Einzelbit-Rechteckkurven, Multi-Bit-Bus-Blöcken (`Hex`/`Dez`/`Bin`), aufklappbaren Einzelbit-Spuren, Zeitachsen-Zoom und Mess-Cursor.
- **HDL-Export für Verilog, VHDL & Nand2Tetris (`US-026` / `T-076`, `T-077`, `T-078`, `T-079`):**
  - **Gemeinsame HDL-Zwischendarstellung & Validierung (`T-076`):** Extraktion eines topologisch sortierten Netzlistengraphen inklusive `Splitter`-Bitbereichs-Propagation, Schleifen- und Jam-Kollisionserkennung, drei wählbaren Export-Umfängen (`Aktive Schaltung`, `inkl. Subschaltungen`, `mit exportToHDL markiert`) sowie Truth-Table-Vektorextraktion bis 16 Eingangsbits.
  - **Verilog/SystemVerilog & VHDL (`T-077`):** Generierung von `.sv`-Modulen inkl. RAM/ROM-Submodulen und `_TestBench.sv` sowie synthesiefähigem IEEE `std_logic_1164` / `numeric_std`-VHDL (`.vhd` inkl. VHDL-93-kompatibler Konkatenationssignale und `_tb.vhd`).
  - **Nand2Tetris HDL (`T-078`):** Referenzgetreue `.hdl`-, `.tst`- und `.cmp`-Generierung inklusive automatischer Baum-Zerlegung von Multi-Input-, `NOR`- und `XNOR`-Gattern (`FixBigGates`) sowie Abbildung auf `RAM8`–`RAM16K` und `ROM32K`.
  - **HDL-Export-Dialog (`ExportHdlDialog`, `T-079`):** Interaktiver Dialog unter *Datei / Projekt → Nach HDL exportieren...* mit Zielformat- und Umfangsauswahl, Live-Code-Vorschau mit Datei-Tabs, Diagnose-Log, Einzeldownload und Mehrdatei-Ordner-Export via File System Access API.
- **Datenschutz, Editor-Feinschliff & Desktop-Zwischenablage (`US-024` / `T-068`, `T-069` & `B-002`):**
  - Verzicht auf statische Betreiber-Pflichtangaben im DSGVO-Dialog (`PrivacyDialog`), Umstellung auf Non-Passive Wheel-Zoom-Listener (`T-069`) sowie Behebung von `B-002` (präfixloses Desktop-XML mit eingebettetem Base64-Web-JSON für durchgängiges Copy/Paste zwischen Logic Circuit Web und LogicCircuit Desktop `2.26.9.1`).

---

## Release 1.0.0 – Vollständiger Desktop-Port & Web-Plattform

### Projekt-Setup, Schematics-Canvas & Raster-Navigation (`US-001`, `US-002`)

- **Projekt-Setup & Toolchain (`US-001` / `T-001`):**
  - Initialisierung der Webanwendung mit TypeScript, React, Vite, Emotion (`@emotion/styled`) und Vitest.
  - Einbindung des C#-Originalprojekts von Eugene Lepekhin als Git-Submodul unter `reference/LogicCircuit` sowie der Referenzbeispiele unter `reference/OfficialSamples`.
  - Einrichtung strikter ESLint- und Dokumentations-Linter-Regeln (`yarn errorcheck`, `yarn lint`, `yarn lint-docs`, `yarn test`, `yarn build`).
- **Schematics-Canvas, Viewport & Navigation (`US-002` / `T-002`, `T-003`, `T-004`):**
  - Mathematisches Koordinatensystem mit Rastereinheiten (`GRID_SIZE = 18px`, `PIN_RADIUS = 3px`) analog zur C#-Referenz (`Symbol.cs`).
  - Stufenlose Pan- und Zoom-Steuerung (Mausrad-Zoom auf den Mauszeiger, mittlerer Mausklick / Leertaste zum Verschieben, Zoom-Buttons und Ursprung-Reset in der Statusleiste).
  - Rechteck-Auswahlrahmen (`SelectionBox`) und dreigeteilte `StatusBar` mit Simulationssteuerung, Live-Raster-/Pixelkoordinaten, Auswahlzähler und Zoom-Steuerung.

---

## Datenmodell, Logikgatter & Komponenten-Palette (`US-003`, `US-014`)

- **Referenzgetreues Schaltungs-Datenmodell (`T-008`):**
  - Trennung zwischen logischer Bauteil-Definition (`Circuit`: `Gate`, `LogicalCircuit`, `Pin`, `CircuitButton`, `Constant`, `CircuitProbe`, `Splitter`, `Memory`, `LedMatrix`, `Sensor`, `Sound`, `Synthesizer`, `GraphicsArray`), konkreter Platzierung (`CircuitSymbol`) und rotiertem Raster-Anschlusspunkt (`Jam`).
  - Deterministische Gate-GUIDs (`00000000-0000-0000-0000-000000<G><I><V>`) für sämtliche Primitiv-Gatter.
- **Authentische ANSI-Gattersymbole & Vektorglyphen (`T-005`, `T-014`, `T-015`):**
  - Präzise SVG-Darstellung für `NOT`, `AND`, `NAND`, `OR`, `NOR`, `XOR`, `XNOR` (mit variabler Eingangsanzahl bis 18 Eingänge), Taktgeber (`Clock`), Tri-State-Treiber (`TriState1` / `TriState2`), Taster/Schalter (`CircuitButton`), Konstanten (`Constant`), Messsonden (`CircuitProbe`), Einzel-LEDs (Rot, Grün, Gelb, Blau), 7-Segment-Anzeigen, LED-Matrizen (`Individual` & `Selector`, rund oder rechteckig) sowie Multi-Bit-Bus-Splitter (`2..32` Bit).
- **Komponenten-Palette, Platzierung & Bearbeitung (`T-006`, `T-007`, `T-009`, `T-010`, `T-011`, `T-012`, `T-013`):**
  - Kategorisierte Seitenleiste mit Live-SVG-Vorschau, Drag-and-Drop-Platzierung mit Snap-to-Grid und Kollisionsprüfung.
  - Rechteck-Mehrfachauswahl, 90°-Rotation um das paritätskorrekte Rotationszentrum (`getRotationCenter`), formatierbare Textnotizen (`TextNote`), Wechsel zwischen mehreren Schaltplänen (`LogicalCircuit`) und modale Eigenschaftendialoge (`F2` / Doppelklick).
- **Sensor-Baustein, Tastatur-Trigger & CleanUp-Visualisierung (`US-014` / `T-045`, `T-046`, `T-047`):**
  - Vollständiger `Sensor`-Baustein mit den Modi `Random`, `Manual`, `Series`, `Loop`, `ASCII`, `KeyCode`, `Sequence` und `Clock` inklusive Live-Werteingabe während der Simulation.
  - Tastatur-Shortcuts für `CircuitButton`-Instanzen (inkl. Modifikatoren und Anzeige des Tastenkürzels am Bauteil) sowie wählbares Anzeigeformat (`Hex`, `Dezimal`, `Binär`) für `CircuitProbe`.
  - Grafische CleanUp-Visualisierung im Editor und in der Simulation zur Hervorhebung ungenutzter Bauteile sowie ungenutzter oder nur teilweise genutzter Multi-Bit-Bus-Leitungen.

---

## Leitungsverlegung, Undo/Redo, Subschaltungen & Editor-Komfort (`US-004`, `US-010`, `US-011`, `US-013`, `US-015`)

- **Interaktive Leitungsverlegung & Signal-Knoten (`US-004` / `T-026`, `T-027`):**
  - Topologische Leitungsnetze (`Wire` → `Conductor` / `ConductorMap`) mit automatischer Erkennung von T-Kreuzungen (Lötpunkte ab 3 Segmenten) sowie manuellem Split & Merge von Leitungssegmenten.
  - Endpunkt-Bearbeitung, Rubberbanding beim Verschieben verbundener Bauteile, detaillierte Pin-/Jam-Tooltips und unmittelbare Bitbreiten- sowie Kurzschluss-Validierung.
- **Schaltungsspezifische Undo-/Redo-Historie (`US-010` / `T-025`, `T-028`):**
  - Reversibler Delta-basierter Undo-/Redo-Stack (`Strg+Z` / `Strg+Y`) mit eigenem Verlauf pro `LogicalCircuit`.
- **Hierarchische Subschaltungen, Symbolformen & Pin-Konfiguration (`US-011` / `T-034`, `T-035`, `T-036`, `T-049`):**
  - Pin-Bezeichnungen (`jamNotation`) am Symbol und erweiterter Pin-Eigenschaftendialog.
  - Wählbare Symbolformen für Subschaltungen: `Rechteck` (`rectangular`), `Anzeige` (`display` mit Live-Rendering aller eingebetteten Display- und Interaktions-Komponenten sowie konfigurierbarem `displayMargin`), `MUX`, `DEMUX`, `ALU` und `Flip-Flop`.
  - Visueller Pin-Reihenfolge-Editor je Symbolseite sowie Doppelklick-Navigation in laufende Subschaltungs-Instanzen während der Simulation.
- **Schwebendes Copy/Cut/Paste & Editor-Komfort (`US-013` / `T-042`, `T-043`, `T-044`):**
  - Interaktiver Schwebezustand (`Floating Paste` & `Floating Move`) mit Live-Kollisionsprüfung, Drehen (`R`/`L`), Rubberbanding-Umschaltung (`Shift`) und Ablegen per Klick oder `Enter`.
  - Kontextmenü per Rechtsklick, Ausrichten/Duplizieren und strukturierte Fehlerdialoge.
- **Projektweite Bauteil- & Signal-Suche (`US-015` / `T-048`):**
  - Such-Dialog (`Strg+F`) mit Volltext-Index über alle Schaltungen, Bauteile, Pins, Probes und Textnotizen, LRU-Suchverlauf, Schaltungswechsel und automatischem Viewport-Fokus samt Puls-Hervorhebung.

---

## Digitale Simulations-Engine & WebWorker-Laufzeit (`US-005`)

- **Zustands-Engine, Schaltungs-Compiler & Hierarchie-Abflachung (`T-029`, `T-030`):**
  - Ereignisgesteuerte Dreiwert-Logik (`State.Off` / Tri-State, `State.On0`, `State.On1`) mit `DirtyList`-Auswertung und Oszillationserkennung.
  - Vollständige Hierarchie-Abflachung (`CircuitMap`): Subschaltungs-Rahmen, `Pin`-Durchgänge und `Splitter` werden zur Compile-Zeit aufgelöst und verursachen zur Simulations-Laufzeit null Rechenaufwand.
- **Entkoppelte WebWorker-Laufzeit & Max-FPS-Modus (`T-031`, `T-032`, `T-033`, `T-037`):**
  - Ausführung der Simulation in einem dedizierten WebWorker mit konfigurierbarer Ziel-Taktfrequenz (`1 Hz` bis `60 Hz`), deterministischem Einzelschritt-Modus (`Step`) sowie ungedrosseltem `Max-FPS`-Modus mit entkoppeltem UI-Snapshot-Rendering (`requestAnimationFrame`).
  - Hierarchischer Schaltungs-Instanzbaum (`RunningTree`) in der Seitenleiste mit Live-Telemetrie (aktuelle Taktfrequenz, Schrittzähler, Status) zum Inspizieren jeder einzelnen Subschaltungs-Instanz zur Laufzeit.

---

## Speicherbausteine (RAM & ROM), Audio & Grafisches Display (`US-006`, `US-007`, `US-021`)

- **Digitale Speicherbausteine RAM & ROM (`US-006` / `T-016`, `T-061`):**
  - Konfigurierbare Adressbreite (`1..16` Bit) und Datenbreite (`1..32` Bit), Single-/Dual-Port, Flanken-/Pegelsteuerung (`writeOn1`) und Startbelegung (`Zeros`, `Ones`, `Random`, `Data`).
  - Integrierter Hex-/ASCII-Speichereditor mit Binärdatei-Import/Export sowie Live-Speicherinspektor zum Überwachen und Editieren von Speicherzellen während der laufenden Simulation.
- **Akustische Ausgabekomponenten (`US-021` / `T-022`):**
  - Standard-Summer (`Sound`) mit konfigurierbarer Frequenz und Wellenform sowie 8-Bit-Synthesizer (`Synthesizer` mit Frequenz-, Lautstärke- und Enable-Eingang sowie Wellenformen `Sine`, `Triangle`, `Square`, `Sawtooth`, `Noise`) auf Basis der Web Audio API inklusive globalem Mute-Schalter in der Statusleiste.
- **Grafisches Display (`GraphicsArray`, `US-007` / `T-023`, `T-067`):**
  - Speicherabgebildetes Pixel-Display (`1`, `2`, `4` oder `8` Bits pro Pixel, Auflösungen bis `640×480`, Zoom `1×`–`4×`) mit authentischen Farbpaletten, hochperformantem Canvas-Renderer, Delta-VRAM-Synchronisation zwischen WebWorker und UI, PNG-Bildexport und Live-VRAM-Inspektor.

---

## Projektverwaltung, Natives Web-Format (`.lcweb`) & Desktop-XML (`US-008`, `US-012`, `US-020`)

- **Hauptmenü, Persistenz, File System Access API & Bildexport (`US-012` / `T-040`, `T-041`, `T-050`):**
  - Strukturiertes Hamburger-Hauptmenü, Projekt-Einstellungsdialog, Systemeinstellungen (`DialogOptions` mit Startverhalten, Standard-Taktfrequenz, Sprache und verknüpften Projektordnern via `IndexedDB` + File System Access API).
  - Maßstabsgetreuer Bildexport (`PNG 1:1` und `SVG`) des gesamten Schaltplans oder des aktuellen Sichtbereichs – wahlweise mit dunklem Raster oder transparentem Hintergrund, auch live während der Simulation.
- **Natives Web-Projektformat (`*.lcweb`, `US-020` / `T-058`, `T-059`):**
  - Explizites, streng validiertes JSON-Schema (`logic-circuit-web-project` / `logic-circuit-web-snippet`, `schemaVersion: 1`) mit Dateiendung `.lcweb` ohne Desktop-Hex-GUID-Altlasten und mit zyklensicherem Referenz-Graph.
- **LogicCircuit Desktop-XML-Import & -Export (`*.CircuitProject`, `US-008` / `T-038`, `T-039`, `T-060`):**
  - Verlustfreier Import von Desktop-Projektdateien (`*.CircuitProject`, Schemata `2.0.0.1` bis `2.0.0.15` inklusive offizieller Beispielprojekte wie `Calc16.CircuitProject` und `Digital Clock.CircuitProject`).
  - Dedizierter Desktop-Export nach `*.CircuitProject` (Schema `2.0.0.14` für LogicCircuit Desktop `2.26.9.1`) mit deterministischer GUID-, Namens- und Koordinaten-Normalisierung sowie vorheriger Kompatibilitätsprüfung (`analyzeDesktopExportCompatibility`).

---

## Model Context Protocol (Lokal & Remote MCP) (`US-009`, `US-018`, `US-019`)

- **Lokale MCP-Bridge & Werkzeugkatalog (`US-009`, `US-019` / `T-017`–`T-021`, `T-024`, `T-055`–`T-057`):**
  - Bidirektionale Echtzeit-Kopplung zwischen KI-Assistenten (`server/bin/mcpCli.mjs`) und dem laufenden Browser-Frontend über den Vite-HMR-WebSocket (`MCP (Lokal)`).
  - Zentraler Komponentenkatalog (`get_component_catalog`) als Single Source of Truth sowie Werkzeuge zur Schaltungsinspektion (`get_circuit_summary`, `get_circuit_details`, `get_circuit_image` mit Ausschnitt-/Bauteil-Screenshots, `validate_circuit`), Konstruktion (`add_elements`, `update_element_properties`, `connect_wire`, `move_elements`, `rotate_symbols`, `delete_elements`, `create_circuits`, `delete_circuits`, `set_current_circuit`, `update_circuit_properties`) und frame-genauen Simulation (`step_simulation` mit zeitgesteuerten `events`, Memory-Zugriff und Live-Screenshots, `set_input_signal`).
- **Datenschutzfreundliches Remote-MCP-Relay & Multi-Tab `SharedWorker` (`US-018` / `T-051`–`T-054`):**
  - Zustandsloses Node.js-RAM-Relay (`server/standaloneServer.ts` / `Dockerfile.mcp`) ohne Datenbank, Cookies oder Log-Persistenz (DSGVO-konform auf Opt-in-Basis).
  - `SharedWorker`-Transport im Browser zur Bündelung mehrerer Tabs über eine einzige WebSocket-Verbindung inklusive Tab-Umschaltung und Pairing-Popover mit kopierbarem Session-Prompt.

---

## Mehrsprachigkeit (i18n) & Release 1.0 Abschluss (`US-022`, `US-023`)

- **Mehrsprachigkeit Deutsch & Englisch (`US-022` / `T-062`, `T-063`):**
  - Vollständige Lokalisierung aller Menüs, Dialoge, Komponenten-Kategorien, Tooltips, Statusanzeigen und Fehlermeldungen über `i18next` / `react-i18next` mit automatischer Browser-Spracherkennung, Schnell-Umschalter in der Statusleiste und Paritäts-Unit-Tests (`i18nParity.test.ts`).
- **Release 1.0 Abschluss, GitHub Pages & Branch-Strategie (`US-023` / `T-064`, `T-065`, `T-066`):**
  - Konsolidierung der 1.0-Chronik in `docs/history.md` und Bereinigung der Einzeldateien.
  - Zweisprachige globale Projektvorstellung (`README.md` & `README.de.md`), `package.json`-Release-Metadaten (`1.0.0`, `MIT`), MCP-freier Build-Modus (`VITE_DISABLE_MCP=true` / `yarn build:pages`) und automatisiertes GitHub-Pages-Deployment per GitHub Actions (`.github/workflows/deploy-pages.yml`).
  - Sauberer Release-1.0-Commit auf `stable`, Abzweigen des Release-Branches `1.0` und Neustart von `develop` auf Stand `1.0.0`.

---

## Behobene Fehlerberichte in Version 1.0 (`B-001`, `B-003`, `B-004`)

- **`B-001` (`step_simulation`: `eventsExecuted` bei sofortiger Oszillation):**
  - Behoben: Löst ein geplantes `atStep`-Event sofort eine Oszillation aus (`stepsCompleted === 0`), wird das bereits ausgeführte Eingabe-Event nun korrekt in `eventsExecuted` ausgewiesen.
- **`B-003` (Export zu `*.CircuitProject` für LogicCircuit Desktop `2.26.9.1`):**
  - Behoben in `T-060`: Umstellung des Desktop-Export-Namespaces auf `http://LogicCircuit.net/2.0.0.14/CircuitProject.xsd`, vollständige GUID-/Namens-/Geometrie-Normalisierung (`normalizeProjectForDesktopXml`), Entfernen von Web-only-Attributen beim Desktop-Export und vorherige Kompatibilitätswarnung bei verschobenen Pin-Layouts.
- **`B-004` (Display-Subschaltungen: Mindestgröße `2×2` statt `3×4`):**
  - Behoben: Gültige Display-Subschaltungen (`circuitShape: "display"`) nutzen nun analog zur C#-Referenz (`LogicalCircuit.cs`) die Mindestgröße `max(2, DisplayBounds + 2 * displayMargin)` statt `3×4`, sodass kompakte `2×2`-Display-Bausteine ohne überflüssigen Leerrand dargestellt werden.
