# Coding Rules & Guidelines (Logic Circuit Web)

Dieses Dokument definiert die verbindlichen Entwicklungs- und Formatierungsrichtlinien für den TypeScript- und React-Code im Projekt Logic Circuit Web.

---

## React-Komponenten & Architektur

- **Direkte Emotion-Styled-Komponenten:**
  Alle UI-Komponenten werden direkt als Emotion-Styled-Komponenten über `styled(...)({ ... })` bzw. `styled(...)((props) => ({ ... }))` umgesetzt. Das Root-Element der Komponente wird dabei direkt mit dem Styling verknüpft, wodurch separate Wrapper-Komponenten entfallen.
- **Verzicht auf `React.FC` bei Komponenten:**
  Auf die Typisierung der Konstante mit `React.FC<Props>` wird verzichtet. Stattdessen wird der Typ der Props direkt am Parameter der inneren Render-Funktion deklariert:
  `const CircuitCanvas = styled(({ zoom, ...other }: CircuitCanvasProps) => { ... })({ ... });`
  TypeScript und Emotion leiten daraus automatisch den vollständigen Typ der Styled Component ab.
  *(Hinweis: Für reine Provider/Context-Wrapper wie `CircuitContextProvider`, die kein DOM-Element und kein Emotion-Styling besitzen, kann weiterhin eine Standard-Funktion oder `React.FC` genutzt werden).*
- **Vererbung nativer HTML-Props (`React.ComponentPropsWithoutRef<"tag">`):**
  Komponenten-Props erweitern standardmäßig die nativen HTML-Attribute des jeweiligen Root-Elements über `React.ComponentPropsWithoutRef<"tag">`. Werden `children` durch feste Props ersetzt (wie z. B. bei reinen Aktionsbuttons mit eigenem `label`), wird `children` via `Omit<React.ComponentPropsWithoutRef<"tag">, "children"> & { ... }` ausgeschlossen.
- **Weiterleitung nativer Props (`{...other}`):**
  Alle nicht explizit konsumierten Props werden via `{...other}` auf das Root-DOM-Element gespreizt. Dadurch wird auch die von Emotion generierte `className` sowie native Attribute (`id`, `aria-*`, Event-Handler) zuverlässig an das DOM weitergegeben.
- **Konsumierte Steuerungs-Props aus `other` herausfiltern:**
  Eigene Steuerungs- und Styling-Props (z. B. `isActive`, `zoom`, `gateType`) müssen in den Komponenten-Parametern destrukturiert werden (`{ zoom, isActive, ...other }`), damit sie nicht in `other` verbleiben und nicht als ungültige Attribute auf dem nativen DOM-Element gerendert werden.
- **Dateibenennung & Komponenten-Verzeichnisse:**
  - Jede Hauptkomponente erhält ein eigenes Unterverzeichnis in `camelCase` unter `src/components/<componentName>/` mit einer `index.tsx` als Einstiegspunkt (z. B. `src/components/circuitCanvas/index.tsx`).
  - Zugehörige Subkomponenten werden im selben Verzeichnis als separate `camelCase.tsx`-Dateien angelegt (z. B. `canvasGrid.tsx`, `canvasOverlay.tsx`).
  - Komponenten-Bezeichner im Code sind `PascalCase` (z. B. `CircuitCanvas`, `CanvasGrid`).
  - Einstiegspunkte wie `index.tsx` exportieren die Komponente direkt als Default-Export (kein Barrel-File).
- **Default-Export für Komponenten:**
  Komponenten-Dateien stellen ihre Komponente immer als Default-Export bereit.
- **Kurzschreibweise ohne Hooks:**
  Komponenten ohne eigene State-Logik oder Hooks können eine kompakte Arrow-Syntax mit implizitem Return verwenden.
- **Modulare Komponenten-Architektur:**
  Komplexe Schematics, Canvas-Overlays und Symbol-Renderer werden in kleine, fokussierte Subkomponenten aufgeteilt.
- **Keine Barrel-Files (`index.ts` mit Re-Exports):**
  Komponenten, Hooks und Module müssen immer direkt aus ihrer konkreten Quelldatei bzw. ihrem Komponentenverzeichnis importiert werden. Sammel-Dateien, die lediglich mehrere fremde Module aggregieren und re-exportieren, sind nicht gestattet.
- **Verzicht auf `React.StrictMode`:**
  Auf den Einsatz von `<React.StrictMode>` wird verzichtet, um unerwünschte doppelte Ausführungen bei Simulations-Loops, Canvas-Initialisierungen und Event-Listenern zu vermeiden.
- **Kennzeichnung im DOM (`data-component`):**
  Zur vereinfachten Fehlersuche und Inspektion im Browser-Inspektor erhält das Root-Element jeder Komponente das Attribut `data-component="ComponentName"`.

---

## React-Contexte & Provider

Zur Verwaltung von Schaltungsdaten, Editor-Werkzeugen und Simulations-Zuständen folgen Contexte einem einheitlichen Verzeichnis- und Dateimuster:

- **Ein Kontext pro Verzeichnis:**
  Jeder Kontext wird in einem eigenen Unterverzeichnis unter `src/contexts/<contextName>/` geführt.
- **Dateiaufteilung (`index.ts` und `provider.tsx`):**
  - **`index.ts` (Kontext-Definition & Typ):**
    Definiert den Typ für den Kontextwert sowie das eigentliche Context-Objekt mittels `React.createContext(...)`. Das Context-Objekt wird als **Default-Export** bereitgestellt.
  - **`provider.tsx` (Provider-Komponente):**
    Implementiert die funktionale Provider-Komponente (`React.FC<ProviderProps>`), kapselt State-Logik und Hook-Aufrufe und stellt den Kontext über `<Context.Provider value={...}>` zur Verfügung. Der Provider wird ebenfalls als **Default-Export** exportiert.
- **Import-Konvention für Contexte und Provider:**
  - Der **Kontext** (für `React.useContext`) wird direkt über den Verzeichnisnamen importiert (`import CircuitContext from "../contexts/circuit";`).
  - Der **Provider** wird explizit über den `provider`-Pfad importiert (`import CircuitProvider from "./contexts/circuit/provider";`).

---

## TypeScript-Klassen & Schaltungs-Engines

- **Verwendung für Logik, Solver & Simulations-Engine:**
  Die digitale Logiksimulation (Signal-Propagation, Gatter-Evaluation, Takt-Oszillatoren, Bus-Splitter, RAM/ROM-Zellen) und Dateiformat-Parser werden als modulare TypeScript-Klassen realisiert.
- **Default-Export für primäre Klassen:**
  Dateien, die eine primäre Klasse exportieren, stellen diese als Default-Export bereit.
- **Native Private Felder (`#field`):**
  Für interne Klassenvariablen und -methoden sind bevorzugt native ECMAScript Private Fields (`#field` bzw. `readonly #roField`) statt des reinen TypeScript-Keywords `private` zu verwenden.
- **Ausnahme: Hilfsmodule (`common.ts` / `utils.ts`):**
  Dateien, die eine Sammlung eigenständiger mathematischer Helfer (Vektorberechnung, Wire-Routing, Box-Collision) oder Bit-Operationen bereitstellen, exportieren diese als benannte Exporte (`export const ...`, `export function ...`). In solchen Sammlungen wird kein Default-Export verwendet.

---

## React Hooks & Formatierung (`useMemo`, `useCallback`, `useEffect`)

Um das Ein- und Ausklappen der Funktionsrümpfe in Code-Editoren zu unterstützen und die Dependency-Liste dauerhaft sichtbar zu halten, folgen alle React-Hooks einer strikten Formatierung.

### React-Namespace (`React.xyz`)
- React wird ausnahmslos als Default-Import importiert: `import React from "react";`.
- Alle React-Funktionen, Hooks und Typen müssen über den Namespace `React.` aufgerufen werden (z. B. `React.useState`, `React.useMemo`, `React.useCallback`, `React.useEffect`, `React.useRef`, `React.useContext`, `React.FC`).
- Benannte Imports aus `"react"` (wie `import { useState } from "react";`) sind nicht zulässig.

### Strukturregeln für Hooks
- Die Callback-Funktion beginnt auf einer eigenen eingerückten Zeile.
- Der schließende Block `},` wird auf eine eigene Zeile gesetzt.
- Das Dependency-Array folgt direkt darunter:
  - **Weniger als 3 Abhängigkeiten (< 3, d. h. 0, 1 oder 2):** Einzeiliges Array mit abschließendem Komma (z. B. `[],`, `[circuitId],`).
  - **3 oder mehr Abhängigkeiten ($\ge$ 3):** Mehrzeiliges Array mit genau einem Eintrag pro Zeile und abschließendem Komma.

---

## Styling mit Emotion (`@emotion/styled`)

- **CSS-in-JS via Emotion:**
  Das Styling von UI-Komponenten erfolgt über `@emotion/styled`.
- **CSS-Variablen für Farben & Themes:**
  Farben, Schaltungsstati und Dimensionen werden als semantische CSS-Variablen in `:root` (in `index.html`) definiert und in Emotion über `var(--color-...)` verwendet.
- **`rem`-Einheiten für Skalierbarkeit:**
  Für Abstände, Border-Radii und UI-Dimensionen sind konsequent `rem`-Einheiten statt fester `px`-Werte einzusetzen (Canvas-Koordinaten für Schaltungsgitter können als relative Einheiten berechnet werden).
- **Zentrale Kind-Element-Selektoren statt Micro-Components:**
  Sub-Elemente werden innerhalb des Root-Styles über verschachtelte Selektoren mit Kind-Kombinatoren (`& > ...`) definiert.

---

## Imports & Import-Organisation

Imports werden in logischen Gruppen organisiert, die durch Leerzeilen getrennt sind. Innerhalb jeder Gruppe werden die Import-Statements alphabetisch sortiert:

- **Standard- & Core-Bibliotheken** (z. B. `react`, `react-dom`)
- **Externe Bibliotheken & Frameworks** (z. B. `@emotion/styled`)
- **Interne Contexte & Hooks** (z. B. `../contexts/circuitContext`, `../hooks/useSimulation`)
- **Interne Typdefinitionen** (z. B. `../types/circuit`, `../types/gate`)
- **Interne Klassen, Engines & Hilfsmodule** (z. B. `../engine/SimulationEngine`, `../utils/wireRouter`)
- **Interne Komponenten** (z. B. `../components/circuitCanvas`, `../components/componentPalette`)
- **Statische Ressourcen & Assets** (z. B. Icons, SVG-Symbole)

---

## Kommentare & Sprache

- **Sprache (Deutsch erlaubt):**
  Kommentare im Quellcode dürfen und sollen auf Deutsch verfasst werden. Technische Fachbegriffe der Digitaltechnik (Clock, Flip-Flop, Truth Table, Bus, Tri-State) bleiben auf Englisch.
- **Keine nummerierten Listen in Kommentaren:**
  Sowohl in einzeiligen Kommentaren (`// ...`) als auch in JSX-Kommentaren (`{/* ... */}`) sind Aufzählungsnummern verboten. Stattdessen sind präzise, deskriptive Kommentare zu nutzen.
- **Keine nummerierten Listen oder Überschriften in Markdown-Dokumentationen:**
  Auch in Markdown-Dateien (`docs/**`) dürfen keine nummerierten Listen (`1. `, `2) `) oder nummerierten Überschriften (`### 1. `) verwendet werden. Stattdessen ungeordnete Listen (`- `) und aussagekräftige Zwischenüberschriften nutzen.

---

## Zeilenlänge (`max-len`)

- Codezeilen sollten vor der 160. Spalte umgebrochen werden (`max-len: 160`).
- Wird die Zeilenlänge für lange String-Literale oder Pfade überschritten, kann die Zeile mit `// eslint-disable-next-line max-len` freigegeben werden.

---

## Typdefinitionen ("type over interface")

Für alle Datenstrukturen (Komponenten-Props, Schaltungsmodelle, Gatter-Definitionen, Wire-Knoten und Utility-Typen) sind TypeScript-`type`-Aliase statt `interface`-Deklarationen zu verwenden.

---

## Verifikation & Qualitätssicherung

Nach Änderungen am Code müssen alle Validierungsschritte mit Exit Code 0 durchlaufen:

- **TypeScript Typecheck:**
  ```bash
  yarn errorcheck
  ```
- **ESLint Linter & Docs-Linter:**
  ```bash
  yarn lint
  ```
- **Vitest Run:**
  ```bash
  yarn test
  ```
- **Production Build:**
  ```bash
  yarn build
  ```

