# US-027: Umfassendes Benutzerhandbuch & interaktive Online-Hilfe (F1)

[← Zurück zum Scrum-Board](../scrum-board.md)

**Status:** Backlog  
**Ziel-Release:** Post 1.2.0  
**Priorität:** Mittel  

## Beschreibung
Als Anwender möchte ich direkt aus Logic Circuit Web jederzeit (über Menüeintrag, `F1`-Shortcut oder kontextsensitive Dialog-Hilfe) auf ein vollständiges, lokal gebündeltes Benutzerhandbuch samt interaktiven Beispielen zugreifen können — angefangen bei der Grundbedienung und einfachen Schaltungen über Diagnose-, Berichts- und Wahrheitstabellen-Filterfunktionen bis hin zu MCP-Einrichtung und KI-Prompt-Beispielen.

## Akzeptanzkriterien
- **Multi-Page Vite-Entry-Point, Dokumentations-Shell & `F1`-Integration:**
  - Zweiter Vite-Entry-Point (`help.html` + `src/help/main.tsx` über `build.rollupOptions.input` in `vite.config.ts`), relativ verlinkt (`./help.html#<anker>`), vollständig statisch, offline-fähig und kompatibel mit GitHub Pages.
  - Eigenständige Dokumentations-Oberfläche im dunklen App-Theme mit Kapitel-Sidebar, Volltextsuche über alle Abschnitte, DE/EN-Sprachumschaltung (synchron zur App-Einstellung), URL-Hash-Navigation und Kopier-Buttons für Ausdrücke, Snippets und Konfigurationen.
  - Menüeintrag *Benutzerhandbuch / Online-Hilfe...* (`F1`) in Kategorie *Hilfe* des `MainMenu`, globales Tastenkürzel **`F1`** mit kontextsensitivem Ziel-Anker (z. B. direkt zum passenden Abschnitt, wenn `TruthTableDialog`, `ReportDialog`, `UsageDialog`, `MemoryEditor`, `PropertyDialog` oder `OptionsDialog` geöffnet ist) sowie direkte `?`-Hilfe-Links in den jeweiligen Dialogen.
- **Bedienung, Editor-Workflows & Dateiformate:**
  - Geführte Übersicht über Benutzeroberfläche (Header, Komponentenpalette, Canvas, StatusBar, Projekt-Suche `Strg+F`, CleanUp-Visualisierung).
  - Dokumentation aller Editor-Interaktionen: Bauteile platzieren, konfigurieren (Bitbreite, Pin-Seite, Farbe, Sensor-Modi), Leitungen ziehen/auftrennen/bündeln, Auto-Routing und Rubberbanding, Schwebemodus (`Shift` ohne Rubberbanding), Rotation (`R`/`L`), Undo/Redo pro Schaltung und vollständige Tastaturkürzel-Referenz.
  - Erklärung von `.lcweb` vs. `.CircuitProject`, Dual-Format-Zwischenablage (verlustfreier Web-Copy/Paste inklusive LED-Farben + direkter `Strg+V`-Import in LogicCircuit Desktop) sowie Projektverzeichnissen via File System Access API.
- **Bauteil-Referenz & Schritt-für-Schritt-Schaltungsbeispiele:**
  - Illustrierter Katalog sämtlicher Bauteilgruppen (Ein-/Ausgabe, Logikgatter & Tri-State, Bus-Splitter, Anzeigen inklusive 7-Segment, LED-Matrix und GraphicsArray-VRAM, Audio/Synthesizer, ROM/RAM inklusive Live-Speicherinspektor) mit live gerenderten SVG-Symbolen.
  - Nachvollziehbare Einsteiger- und Aufbau-Tutorials: von einfachen Schaltungen (*LED-Schalter*, *Halbaddierer*, *1-Bit-Volladdierer*, *2-zu-4-Decoder*) über modulare Subschaltungen (*Display-Shape*, *Display-Margins*, Pin-Reihenfolge) bis zu sequenziellen Schaltungen (*RS-Latch*, *D-Flip-Flop*, *2-Bit-Zähler mit RAM und Anzeige*).
- **Wahrheitstabellen, Kombinatorik-Check & interaktiver Filter-Playground:**
  - Verständliche Erklärung der Wahrheitstabellen-Generierung, der Warnung bei nicht rein kombinatorischen Schaltungen (Rückkopplungen/Flip-Flops oder RAM/Clock/Sensor/Button) sowie der Umkehrlogik von *Filter invertieren* (*Schaltungs-Test auf `0` Fehlerzeilen* vs. *normale Filterung*).
  - Vollständige Syntax- und Präzedenz-Referenz für `validators`-Filter (Pin-Variablen inklusive Anführungszeichen wie `"0"` / `"c'"`, Zahlenliterale in `0b`/`0x`/`0`/Dezimal, Operator-Präzedenz inklusive höherer Bindung bitweiser Operatoren, benutzerdefinierte Hilfsfunktionen mit/ohne Parameter).
  - Eingebetteter interaktiver **Filter-Playground** auf der Hilfeseite auf Basis des echten `ExpressionParser` und `CircuitTestSocket`, in dem Nutzer Beispiel-Schaltungen (z. B. *2-zu-4-Decoder*, *Volladdierer*, *4-Bit-Addierer*) mit vorbereiteten oder eigenen Filterausdrücken live gegen die Tabelle testen können.
- **Simulation, Diagnose-, Berichts- & Export-Werkzeuge:**
  - Dokumentation von Echtzeit-Simulation, Einzelschritt (`F10`), Max-Speed-Modus, Oszillations-Diagnose inklusive Bauteil-Sprung, `RunningCircuitTree` für Subschaltungs-Instanzen, Verwendungsnachweis (`UsageDialog`), Schaltungsbericht (`ReportDialog` + Markdown-Export), Oszilloskop/Timing-Diagramm (`US-025`), HDL-Export (`US-026`) und Schaltungs-Bibliothek (`US-017`).
- **KI-Anbindung & Model Context Protocol (MCP-Handbuch & Prompt-Beispiele):**
  - Schritt-für-Schritt-Einrichtung für lokale MCP-Nutzung (Vite-Dev-Middleware / SSE & JSON-RPC) sowie Remote-MCP über Relay-Server (StatusBar-Popover, Session-URL, optionaler Access-Key) samt kopierbaren Konfigurations-Snippets für Claude Code, Cursor, VS Code und Antigravity.
  - Referenz der verfügbaren MCP-Tools (`get_component_catalog`, `get_circuit_summary`, `get_circuit_details`, `get_circuit_image`, `create_circuits`, `add_elements`, `connect_wire`, `validate_circuit`, `set_input_signal`, `step_simulation`, etc.).
  - Praktische Prompt- und Workflow-Beispiele (*„Baue mir einen 4-Bit-Volladdierer als Subschaltung“*, *„Prüfe die aktuelle Schaltung auf Verdrahtungsfehler und teste sie mit Eingangsvektoren“*, *„Erkläre oder optimiere eine bestehende Schaltung“*).

## Geplante Task-Aufteilung
Die Umsetzung kann schrittweise in eigenständige Tasks unterteilt werden:
- **Multi-Page Vite-Entry-Point, Dokumentations-Shell & `F1`-Anbindung:** `help.html` und `src/help/main.tsx` in `vite.config.ts` einbinden, responsive Handbuch-Shell mit Sidebar, Suche, DE/EN-Umschaltung und Hash-Deep-Linking bauen, Menüpunkt in `MainMenu`, globales `F1`-Kürzel in `AppHeader` (kontextsensitiv) sowie `?`-Hilfe-Buttons in Dialogen integrieren.
- **Kapitel Bedienung, Editor-Workflows & Dateiformate:** Inhalte, Tastaturkürzel-Übersichten und Schritt-für-Schritt-Erklärungen für Canvas, Drahtziehen, Schwebemodus, Suche, CleanUp, `.lcweb`/`.CircuitProject` und Dual-Format-Copy/Paste ausarbeiten.
- **Kapitel Bauteil-Enzyklopädie & Schaltungs-Tutorials:** Vollständige Bauteil-Referenz mit eingebetteten SVG-Bauteilsymbolen sowie einsteigerfreundliche Tutorials (*Grundgatter* -> *Volladdierer & 2-zu-4-Decoder* -> *Subschaltungen* -> *sequenzielle Zähler*) inklusive direkt kopierbarer bzw. ladbarer Beispielschaltungen umsetzen.
- **Kapitel Wahrheitstabellen & interaktiver Filter-Playground:** Ausführliche Filter-Dokumentation (`validators`) mit operativer Grammatik-Tabelle und integriertem Live-Playground auf Basis von `ExpressionParser` + `CircuitTestSocket`.
- **Kapitel Simulation, Diagnose, Berichte & Werkzeuge:** Dokumentation für Taktsteuerung, Max-Speed, Oszillationsanalyse, `RunningCircuitTree`, Verwendungsnachweis, Schaltungsbericht sowie Erweiterungsmodule (Oszilloskop, HDL-Export, Bibliothek).
- **Kapitel MCP-Integration, Tool-Referenz & KI-Prompt-Beispiele:** Setup-Anleitungen (lokal & Remote-Relay), Tool-Übersicht, JSON-Konfigurationsvorlagen und erprobte Prompt-Beispiele inkl. Verifikation durch i18n- und Build-Tests (`help.html` + `index.html`).

## Zugeordnete Tasks
- *(noch nicht definiert — geplante Aufteilung siehe oben)*
