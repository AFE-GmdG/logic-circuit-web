# Logic Circuit Web

**[🇬🇧 English](README.md)** | **🇩🇪 Deutsch**

**Logic Circuit Web** bringt den bewährten digitalen Schaltungssimulator [Logic Circuit](https://www.logiccircuit.org/) von Eugene Lepekhin als moderne, plattformunabhängige Webanwendung in den Browser – entwickelt mit TypeScript, React, Vite, Emotion und WebWorkern.

👉 **[🚀 Live-Demo auf GitHub Pages öffnen](https://afe-gmdg.github.io/logic-circuit-web/)**

---

## ✨ Funktionsübersicht

- **Interaktiver Schematics-Editor:**
  - Stufenlos zoom- und verschiebbarer Schaltplan-Canvas mit festem Raster (`18px` Rastereinheit) und authentischen ANSI-Logikgattern (`NOT`, `AND`, `NAND`, `OR`, `NOR`, `XOR`, `XNOR` mit 2–18 Eingängen, `Clock`, `Tri-State`).
  - Intelligente Leitungsführung (`Wire` & `ConductorMap`) mit automatischen Lötpunkten an T-Kreuzungen, manuellem Teilen und Zusammenführen von Leitungen, Endpunkt-Bearbeitung, Rubberbanding sowie sofortiger Bitbreiten- und Kurzschluss-Validierung.
  - Schwebendes Copy/Cut/Paste und Verschieben mit Live-Kollisionsprüfung, paritätstreuer `90°`-Rotation (`R` / `L`), schaltungsspezifischer Undo/Redo-Historie (`Strg+Z` / `Strg+Y`), CleanUp-Visualisierung für ungenutzte Leitungen/Bus-Bits und projektweiter Bauteil- & Signalsuche (`Strg+F`).
- **Hierarchische Subschaltungen:**
  - Jede Schaltung (`LogicalCircuit`) lässt sich als wiederverwendbarer Baustein mit wählbarer Symbolform (`Rechteck`, `Anzeige`, `MUX`, `DEMUX`, `ALU`, `Flip-Flop`), frei konfigurierbarer Pin-Reihenfolge je Seite, `jamNotation`-Pin-Beschriftungen und interaktiver `Display`-Live-Vorschau einbetten.
  - Per Doppelklick auf eine Subschaltung während der laufenden Simulation lässt sich jede konkrete Instanz über den hierarchischen `RunningTree` live inspizieren.
- **Umfangreiche I/O-, Speicher-, Audio- & Grafik-Komponenten:**
  - **Eingänge & Messsonden:** Taster und Schalter (`CircuitButton`) mit Tastatur-Triggern, Multi-Bit-Konstanten (`Constant`), Messsonden (`CircuitProbe` in Hex/Dez/Bin), Bus-Splitter (`Splitter`, 2–32 Bit) sowie programmierbare `Sensor`-Bausteine (`Random`, `Manual`, `Series`, `Loop`, `ASCII`, `KeyCode`, `Sequence`, `Clock`).
  - **Optische Anzeigen:** Einzel-LEDs, 7-Segment-Anzeigen, konfigurierbare LED-Matrizen (`Individual` & `Selector`) sowie speicherabgebildete **`GraphicsArray`**-Grafikdisplays (`1`, `2`, `4` oder `8` Bits pro Pixel bis `640×480` mit Delta-VRAM-Sync, PNG-Export und Live-VRAM-Inspektor).
  - **Speicher (`RAM` & `ROM`):** Bis zu 16 Bit Adress- und 32 Bit Datenbreite, Single-/Dual-Port, integrierter Hex-/ASCII-Editor, Binärdatei-Import/Export und Live-Speicherinspektor während der Simulation.
  - **Audio:** Standard-Summer (`Sound`) und 8-Bit-`Synthesizer` (Frequenz-, Lautstärke- und Wellenform-Steuerung über die Web Audio API) inklusive globalem Mute-Schalter.
- **Hochperformante WebWorker-Simulations-Engine:**
  - Ereignisgesteuerte Dreiwert-Logik (`Off`/Tri-State, `On0`, `On1`) mit schneller `DirtyList`-Auswertung in einem dedizierten WebWorker.
  - Null Laufzeit-Overhead für Subschaltungs-Rahmen, Pins und Splitter durch vollständige Hierarchie-Abflachung zur Compile-Zeit (`CircuitMap`).
  - Unterstützt Einzelschritt-Modus (`F10`), Ziel-Taktfrequenzen (`1 Hz` – `60 Hz`) sowie einen ungedrosselten **Max-FPS**-Modus mit entkoppeltem UI-Rendering (`requestAnimationFrame`).
- **Natives `.lcweb`-Projektformat & Desktop-Kompatibilität (`.CircuitProject`):**
  - Natives, strikt validiertes JSON-Projektformat (`*.lcweb`) mit direktem Dateisystemzugriff über die File System Access API (`IndexedDB`-Verzeichnis- und Dateihandles).
  - Nahtloser XML-Import und normalisierter Export für LogicCircuit Desktop (`*.CircuitProject`, Schema `2.0.0.14`).
  - Maßstabsgetreuer `PNG (1:1)`- und `SVG`-Bildexport (dunkles Raster oder transparenter Hintergrund, auch live während der Simulation).
- **Mehrsprachigkeit (i18n):**
  - Vollständige Lokalisierung auf Deutsch und Englisch (`i18next` / `react-i18next`) mit automatischer Browser-Spracherkennung und Direktumschalter in der Statusleiste.
- **Model Context Protocol (MCP) für KI-Assistenten:**
  - Integrierte bidirektionale MCP-Bridge, über die KI-Assistenten (wie Antigravity oder Claude Desktop) Schaltungen in Echtzeit analysieren, aufbauen, validieren und simulieren können – lokal über Vite HMR oder remote über ein zustandsloses, DSGVO-konformes RAM-Relay und einen Multi-Tab-`SharedWorker` *(im statischen GitHub-Pages-Build deaktiviert)*.

---

## 🚀 Schnellstart & Entwicklung

### Voraussetzungen
- **Node.js** `>= 22`
- **Yarn** `1.x`

### Klonen & Installieren
```bash
git clone --recurse-submodules https://github.com/AFE-GmdG/logic-circuit-web.git
cd logic-circuit-web
yarn install
```

### Entwicklungs- und Build-Befehle

| Befehl | Beschreibung |
| :--- | :--- |
| `yarn dev` | Startet den Vite-Entwicklungsserver unter `http://localhost:5173` (inkl. lokaler MCP-Bridge) |
| `yarn build` | Erstellt den Production-Build in `dist/` (inkl. Opt-in Remote-MCP-Unterstützung) |
| `yarn build:pages` | Erstellt den statischen, MCP-freien Build in `dist/` (`VITE_DISABLE_MCP=true` für GitHub Pages) |
| `yarn preview` | Startet eine lokale Vorschau des Production-Builds |
| `yarn test` | Führt alle automatisierten Vitest-Unit- und Integrationstests aus |
| `yarn errorcheck` | Prüft die TypeScript-Typen für Frontend (`tsconfig.json`) und Server (`tsconfig.server.json`) |
| `yarn lint` | Führt ESLint über alle TypeScript- und React-Dateien aus |
| `yarn lint-docs` | Prüft die Markdown-Dokumentation unter `docs/` auf Formatierungsregeln |

---

## ⌨️ Wichtige Tastaturkürzel

| Tastenkürzel | Aktion |
| :--- | :--- |
| `Strg+S` | Projekt speichern (`*.lcweb`) |
| `Strg+Z` / `Strg+Y` | Rückgängig / Wiederherstellen (je Schaltplan) |
| `Strg+C` / `Strg+X` / `Strg+V` | Kopieren / Ausschneiden / Schwebendes Einfügen |
| `Strg+A` / `Entf` | Alles auswählen / Auswahl löschen |
| `R` / `L` (oder `Shift+R`) | Auswahl um `90°` im / gegen den Uhrzeigersinn drehen |
| `F2` / Doppelklick | Eigenschaftendialog für Bauteil oder aktive Schaltung öffnen |
| `Strg+F` | Projektweite Bauteil- & Signalsuche öffnen |
| `F5` / `Shift+F5` | Simulation starten oder pausieren / Simulation stoppen |
| `F10` | Einzelschritt-Simulation (Step) |

---

## 📚 Projektdokumentation

Die weiterführende Architektur- und Entwicklerdokumentation befindet sich im Verzeichnis [`docs/`](docs/):

- **[`docs/intro.md`](docs/intro.md):** Projektvision, Dokumentationsstruktur und Scrum-/Kanban-Workflow.
- **[`docs/data-model.md`](docs/data-model.md):** Tiefgehende Spezifikation des Schaltungs-Datenmodells (`CircuitProject`, `Circuit`, `CircuitSymbol`, `Jam`, `ConductorMap`, `CircuitMap`, `CircuitState`).
- **[`docs/mcp.md`](docs/mcp.md):** Architektur, Werkzeugkatalog und Deployment-Leitfaden für die lokale und Remote-MCP-Integration.
- **[`docs/coding-rules.md`](docs/coding-rules.md):** Verbindliche Entwicklungs-, Styling- und Formatierungsrichtlinien.
- **[`docs/history.md`](docs/history.md):** Chronik „Was bisher geschah“ mit allen abgeschlossenen Releases, User Stories, Tasks und Bugfixes.
- **[`docs/scrum-board.md`](docs/scrum-board.md):** Entwickler-Board und Post-1.0-Roadmap.

---

## 🙏 Credits & Lizenz

- **Originalkonzept & Desktop-Referenz:** [Logic Circuit](https://www.logiccircuit.org/) von **Eugene Lepekhin** ([GitHub-Repository](https://github.com/eugenelepekhin/LogicCircuit)), eingebunden als Referenz-Submodul unter `reference/LogicCircuit`.
- **Autor Logic Circuit Web:** Andreas Friedel
- **KI-Co-Autor:** Antigravity (Google DeepMind)
- **Lizenz:** Veröffentlicht unter der **[MIT-Lizenz](LICENSE)**.
