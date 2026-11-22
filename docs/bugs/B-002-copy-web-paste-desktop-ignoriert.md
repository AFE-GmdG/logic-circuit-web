# B-002: Copy (Web) → Paste (Desktop) wird in Desktop-App ignoriert

[← Zurück zum Scrum-Board](../scrum-board.md)

**Status:** Offen  
**Schweregrad:** Mittel  
**Betroffene Komponenten:** `src/utils/xml/logicCircuitXmlConstants.ts`, `src/utils/xml/logicCircuitXmlWriter.ts`, `src/utils/clipboardUtils.ts`, `src/components/circuitCanvas/index.tsx`, `src/components/circuitCanvas/canvasContextMenu.tsx`, `src/components/app/mainMenu.tsx`

## Fehlerbeschreibung
Wird in der Webanwendung eine Auswahl (Bauteile, Leitungen, Textnotizen) per `Strg+C` oder Menü *Bearbeiten → Kopieren* kopiert und anschließend in der C#-Desktop-Anwendung (`2.26.9.1`) per `Strg+V` eingefügt, reagiert die Desktop-Anwendung nicht und zeigt auch keinen Fehlerdialog (`CanPaste()` bleibt `false` bzw. der Paste wird still ignoriert).

Die umgekehrte Richtung (*Copy (Desktop) → Paste (Web)*) sowie *Copy/Paste innerhalb der WebApp* funktionieren.

## Schritte zur Reproduktion
- In der WebApp eine Schaltung öffnen und ein oder mehrere Bauteile auswählen.
- `Strg+C` drücken (oder *Bearbeiten → Kopieren* ausführen).
- In die Windows-Desktop-App *LogicCircuit* (`2.26.9.1`) wechseln und in einer geöffneten Schaltung `Strg+V` drücken / *Bearbeiten → Einfügen* prüfen.
- **Beobachtetes Verhalten:** Die Elemente werden in Desktop nicht eingefügt; der Einfüge-Vorgang bleibt ohne sichtbare Wirkung.
- **Erwartetes Verhalten:** Aus der WebApp im Desktop-Format kopierte Elemente lassen sich in LogicCircuit Desktop (`2.26.9.1`) über `Strg+V` einfügen.

## Analyse & aktueller Befund
- **Zwischenstand aus T-060:** Die Umstellung von `LOGIC_CIRCUIT_CURRENT_NAMESPACE` auf `http://LogicCircuit.net/2.0.0.14/CircuitProject.xsd`, die Normalisierung via `normalizeProjectForDesktopXml` (GUIDs, eindeutige Namen, nicht-negative Koordinaten, Entfernen von Web-only-Attributen, `SensorType="ASCII"`) sowie die Aktion *„Für Desktop kopieren (XML)“* haben `Copy (Web) → Paste (Desktop 2.26.9.1)` **noch nicht** behoben (`Copy (Desktop) → Paste (Web)` und `Web ↔ Web` funktionieren).
- **Original-Clipboard-XML von LogicCircuit Desktop (`2.26.9.1`):**
  - Deklaration `<?xml version="1.0" encoding="utf-16"?>` (statt `encoding="utf-8"`)
  - Default-Namespace ohne Präfix `<CircuitProject xmlns="http://LogicCircuit.net/2.0.0.14/CircuitProject.xsd">` (statt `lc:`-Präfix `<lc:CircuitProject xmlns:lc="...">`)
  - Referenz-Snippet direkt aus der Windows-Zwischenablage von LogicCircuit Desktop (`2.26.9.1`):

```xml
<?xml version="1.0" encoding="utf-16"?>
<CircuitProject xmlns="http://LogicCircuit.net/2.0.0.14/CircuitProject.xsd">
	<Project ProjectId="678616c2-719d-4e37-8319-1844375e1e21" Frequency="5" LogicalCircuitId="fa00901e-735e-4983-a207-49d83213eccd" />
	<LogicalCircuit LogicalCircuitId="fa00901e-735e-4983-a207-49d83213eccd" Notation="Main" />
	<CircuitButton CircuitButtonId="dd6c30bd-c68a-4ef5-9871-344cb182ec48" />
	<CircuitSymbol CircuitSymbolId="c6f165b7-21c1-4faa-8926-96e08cc8e4db" CircuitId="00000000-0000-0000-0000-000000010000" LogicalCircuitId="fa00901e-735e-4983-a207-49d83213eccd" X="20" Y="18" />
	<CircuitSymbol CircuitSymbolId="bdf82bd8-e7f2-4031-8645-4f49f53a9657" CircuitId="dd6c30bd-c68a-4ef5-9871-344cb182ec48" LogicalCircuitId="fa00901e-735e-4983-a207-49d83213eccd" X="20" Y="22" />
	<CircuitSymbol CircuitSymbolId="fd61e1cc-3c1e-4ae6-9307-7a9acdf51150" CircuitId="00000000-0000-0000-0000-000000040200" LogicalCircuitId="fa00901e-735e-4983-a207-49d83213eccd" X="24" Y="19" />
	<CircuitSymbol CircuitSymbolId="3c3807a2-9b4a-408d-b31d-489ca45077f8" CircuitId="00000000-0000-0000-0000-000000080100" LogicalCircuitId="fa00901e-735e-4983-a207-49d83213eccd" X="28" Y="20" />
	<Wire WireId="e3c0f594-2c7d-43d3-8bb9-03492f4f0280" LogicalCircuitId="fa00901e-735e-4983-a207-49d83213eccd" X1="22" Y1="19" X2="24" Y2="20" />
	<Wire WireId="370dc49f-376f-4c97-b885-55720029b651" LogicalCircuitId="fa00901e-735e-4983-a207-49d83213eccd" X1="22" Y1="23" X2="24" Y2="22" />
	<Wire WireId="ed90e574-8d46-4917-8a7b-ab879f170f04" LogicalCircuitId="fa00901e-735e-4983-a207-49d83213eccd" X1="27" Y1="21" X2="28" Y2="21" />
</CircuitProject>
```

- **Offene Prüfpunkte für die weitere Analyse:**
  - Abweichende XML-Deklaration (`encoding="utf-16"` vs. `encoding="utf-8"`) und deren Behandlung im .NET-`XmlReader` / `DataSet.ReadXml`.
  - Default-Namespace ohne Präfix (`xmlns="..."`) vs. `lc:`-Präfix (`xmlns:lc="..."`) sowie Element-/Attributstruktur im Clipboard-Snippet (`Pin`, `LogicalCircuit`, `CircuitSymbol`).
  - Windows-Zwischenablageformat über `navigator.clipboard.writeText` im Vergleich zu `Clipboard.SetDataObject` / `TextDataFormat.UnicodeText` in WPF (`LogicCircuit.exe`).

## Behebung & Verifikation
- [x] XML-Namespace auf `2.0.0.14` (`Release_2.26.09.01`) umgestellt und Basis-Normalisierung via *„Für Desktop kopieren (XML)“* bereitgestellt
- [ ] Unterschied zwischen Web-Clipboard-XML (`utf-8` + `lc:`-Präfix) und Desktop-Referenz (`utf-16` + Default-Namespace ohne Präfix) bzw. Windows-Clipboard-Format beheben
- [ ] Manueller Test Web (*Für Desktop kopieren (XML)*) → Desktop (`2.26.9.1`, `Strg+V`) erfolgreich durchgeführt (bisher weiterhin fehlgeschlagen, Bug bleibt offen)
