# US-001: Projekt-Setup und Toolchain-Grundgerüst

[← Zurück zum Scrum-Board](../scrum-board.md)

**Status:** In Bearbeitung  
**Priorität:** Hoch  

## Beschreibung
Als Entwickler möchte ich eine moderne, robuste Entwicklungs- und Testumgebung auf Basis von React 19, TypeScript und Vite vorfinden, inklusive Anbindung des Original-C#-Quellcodes als Git-Submodul, damit neue Features schnell, typsicher und nach einheitlichen Qualitätsstandards entwickelt werden können.

## Akzeptanzkriterien
- **Vollständige Toolchain:**
  - Build-Pipeline (`yarn build`) und Dev-Server (`yarn dev`) mit Vite und React 19 funktionieren einwandfrei.
  - Strenger TypeScript-Compiler (`yarn errorcheck`) läuft fehlerfrei.
  - Linter (`yarn lint`) mit ESLint, Stylistic-Regeln und Markdown-Docs-Linter ist aktiv und schützt die Codequalität.
  - Test-Runner Vitest (`yarn test`) ist konfiguriert und führt Basistests aus.
- **C#-Referenzsubmodul:**
  - Das Original-Repository von Eugene Lepekhin ist als Git-Submodul unter `reference/LogicCircuit` eingebunden und für Analysen verfügbar.
- **Dokumentation und Scrum-Board:**
  - Verbindliche Coding Rules (`docs/coding-rules.md`), Intro (`docs/intro.md`) und ein Markdown-basiertes Kanban-Board (`docs/scrum-board.md`) steuern den Entwicklungsprozess.
- **VS-Code Workspace:**
  - Eine konfigurierte Workspace-Datei (`logiccircuit.code-workspace`) bietet Zugriff auf Tasks und Formatierungseinstellungen.

## Zugeordnete Tasks
- 🔍 [T-001: Projekt-Setup, Toolchain und Referenz-Submodul](../tasks/T-001-projekt-setup-und-toolchain.md)

