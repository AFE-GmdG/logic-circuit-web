# T-001: Projekt-Setup, Toolchain und Referenz-Submodul

[← Zurück zum Scrum-Board](../scrum-board.md)

**Status:** Done  
**Typ:** Setup | Architektur  
**Zugehörige User Story:** [US-001](../user_stories/US-001-projekt-setup-und-grundgeruest.md)  

## Ziel
Einrichten des vollständigen Projekt-Grundgerüsts für Logic Circuit Web analog zur Vorlage aus CrunchyList. Einbinden des C#-Quellcodes als Submodul und Konfiguration aller Build-, Lint-, Test- und Typisierungs-Tools.

## Betroffene Dateien
- `package.json` (Projektdefinition, Skripte und Dependencies)
- `tsconfig.json` & `tsconfig.eslint.json` (Strikte TypeScript-Konfiguration)
- `eslint.config.js` (Linter mit projektspezifischen Richtlinien und Stylistic-Regeln)
- `vite.config.ts` & `vitest.config.ts` (Build- und Test-Runner)
- `scripts/lint-docs.mjs` (Linter zur Durchsetzung von unnummerierten Markdown-Dokumenten)
- `logiccircuit.code-workspace` (Workspace-Konfiguration und VS-Code-Tasks)
- `index.html` (Zentrales HTML-Dokument mit CSS-Designvariablen für Schaltungs-CAD)
- `docs/**` (Scrum-Board, User Stories, Coding Rules, Task-Dokumente)
- `src/**` (React-Einstiegspunkt, App-Layout mit Header, Workspace und Typdefinitionen)
- `.gitmodules` (Submodul-Einbindung von LogicCircuit C# unter `reference/LogicCircuit`)

## Aufgaben
- Git Repository initialisieren und C#-Repository von Eugene Lepekhin als Git-Submodul in `reference/LogicCircuit` einbinden.
- `package.json` mit Vite, React 19, Emotion, Vitest und ESLint konfigurieren.
- TypeScript (`tsconfig.json`, `tsconfig.eslint.json`) mit strengen Compiler-Flags einrichten.
- ESLint Flat Config mit `@stylistic`, `tseslint`, `import-x` und dem lokalen Plugin gegen nummerierte Kommentare aufsetzen.
- Dokumentationsstruktur nach Scrum- und Kanban-Methodik inklusive Markdown-Linter erstellen.
- Erste React-App-Struktur mit Emotion-Styling und Typsicherheit aufbauen.
- Verifikation mit `yarn errorcheck`, `yarn lint`, `yarn test` und `yarn build` durchführen.

## Testkriterien
- TypeScript-Prüfung (`yarn errorcheck`) läuft fehlerfrei ohne Typfehler.
- Linter (`yarn lint`) inklusive `lint-docs.mjs` läuft ohne Warnungen oder Fehler durch.
- Test-Runner (`yarn test`) führt Unit-Tests erfolgreich aus.
- Production Build (`yarn build`) erzeugt erfolgreich das Bundle in `dist/`.

