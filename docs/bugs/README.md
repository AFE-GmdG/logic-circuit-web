# Bug-Tracking & Problemverfolgung (Logic Circuit Web)

[← Zurück zum Scrum-Board](../scrum-board.md)

In diesem Verzeichnis werden Fehlerberichte und Incident-Analysen nach folgendem Namensschema abgelegt:

`B-XXX-<kurzbeschreibung>.md`

## Erfasste Bugs

| Bug | Titel | Schweregrad | Status |
| :--- | :--- | :--- | :--- |

## Vorlage für Bug-Reports

```markdown
# B-XXX: [Kurztitel des Fehlers]

[← Zurück zum Scrum-Board](../scrum-board.md)

**Status:** Offen | In Bearbeitung | Behoben | Geschlossen  
**Schweregrad:** Kritisch | Hoch | Mittel | Niedrig  
**Betroffene Komponenten:** z. B. SimulationEngine, CircuitCanvas, WireRouter  

## Fehlerbeschreibung
Präzise Beschreibung des Fehlverhaltens oder der unerwarteten Fehlermeldung.

## Schritte zur Reproduktion
- Schritt A
- Schritt B
- Beobachtetes Verhalten vs. erwartetes Verhalten

## Fehleranalyse & Ursache
Technische Ursachenforschung (z. B. Gatter-Timing, Oszillationserkennung, SVG-Rendern).

## Behebung & Verifikation
- [ ] Durchgeführte Code-Änderungen
- [ ] Verifikation mit `yarn errorcheck` & `yarn lint`
- [ ] Test im Browser
```

