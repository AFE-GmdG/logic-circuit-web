# US-016: Post-1.0 Analyse- & Export-Werkzeuge

[← Zurück zum Scrum-Board](../scrum-board.md)

**Status:** Geplant  
**Priorität:** Niedrig  

## Beschreibung
Als fortgeschrittener Schaltungsentwickler möchte ich nach Version 1.0 weiterführende Analyse-, Verifikations- und Export-Werkzeuge aus der C#-Desktopanwendung im Browser nutzen können, um Schaltungen systematisch zu testen, Signalverläufe zeitlich auszuwerten und Schaltungslogik weiterzuverarbeiten.

## Akzeptanzkriterien (Post-1.0 Roadmap)
- **Wahrheitstabelle (`DialogTruthTable`):**
  - Automatische Generierung und Überprüfung von Wahrheitstabellen für testbare `LogicalCircuit`s inklusive Unterstützung des `validators`-Filterausdrucks.
- **Oszilloskop & Signalverlauf (`DialogOscilloscope` / `DialogProbeHistory`):**
  - Zeitliche Aufzeichnung und interaktive Darstellung von Probe-Signalverläufen (Timing-Diagramm) während der Simulation.
- **Verwendungsnachweis & Schaltungsbericht (`DialogUsage` / `DialogReport`):**
  - Übersicht, in welchen übergeordneten Schaltungen eine Subschaltung instanziiert ist, sowie strukturierter Bauteil- und Hierarchiebericht.
- **HDL-Export (`DialogExportHdl`):**
  - Export von `LogicalCircuit`s (mit aktivem Flag `exportToHDL` aus [Release 1.0 (`US-011`)](../history-1.0.md)) nach Verilog / VHDL.

## Zugeordnete Tasks
- *(Werden nach Release von Version 1.0 bei Aktivierung der jeweiligen Teilfunktionen detailliert geschnitten)*
