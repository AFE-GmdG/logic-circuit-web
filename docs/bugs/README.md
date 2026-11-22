# Bug-Tracking & Problemverfolgung (Logic Circuit Web)

[← Zurück zum Scrum-Board](../scrum-board.md)

In diesem Verzeichnis werden Fehlerberichte und Incident-Analysen nach folgendem Namensschema abgelegt:

`B-XXX-<kurzbeschreibung>.md`

## Erfasste Bugs

> 📚 Alle in Version 1.0 behobenen Fehlerberichte (`B-001`, `B-003`, `B-004`) sind in der Chronik **[Was bisher geschah – Release 1.0](../history-1.0.md)** dokumentiert.

| Bug | Titel | Schweregrad | Status |
| :--- | :--- | :--- | :--- |
| **[B-002](B-002-copy-web-paste-desktop-ignoriert.md)** | Copy (Web) → Paste (Desktop) wird in Desktop-App ignoriert | Mittel | 📋 Offen |

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

