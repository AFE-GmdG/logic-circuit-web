# US-033: Host-autoritative Live-Simulation für Gäste

[← Zurück zum Scrum-Board](../scrum-board.md)

**Status:** Backlog  
**Ziel-Release:** Post 1.2.0  
**Priorität:** Niedrig  

## Beschreibung
Als Besitzer einer Schaltung möchte ich eine Live-Simulation auf meinem Rechner starten können, bei der verbundene Gäste die Signalzustände in Echtzeit über beliebige Sub-Schaltungen hinweg mitverfolgen und (nach Freigabe) interaktive Taster oder Sensoren betätigen können, um Fehlerbilder und Testläufe gemeinsam live zu analysieren.

## Akzeptanzkriterien
- **Host-autoritative Simulation & Signal-Streaming:**
  - Die Simulationsberechnung (`CircuitRunner`) läuft ausschließlich im Browser des Besitzers; die UI aller verbundenen Teilnehmer wechselt synchron in den gemeinsamen Live-Simulationsmodus (Editieren ist währenddessen einheitlich gesperrt).
  - Der Host überträgt gedrosselte `SimulationSnapshot`- bzw. Delta-Pakete (`stateArray`, `probes`, `buttons`, `sensors`, `ledMatrices`, `graphicsArrays`, `telemetry`) mit Backpressure-Steuerung (`bufferedAmount`-Drop-Frame), sodass langsame Verbindungen nicht verstopfen.
- **Freie Sub-Schaltungs-Inspektion bei Gästen:**
  - Jeder Gast kompiliert lokal aus der gemeinsamen Schaltung eine `CircuitMap` und kann unabhängig vom Viewport des Hosts in beliebigen Sub-Schaltungen live die Leitungs- und Sonden-Zustände aus dem empfangenen `stateArray` inspizieren.
  - Anzeige für Gäste, welche Top-Level-Schaltung der Host aktuell simuliert (inkl. Schnellwechsel-Link, falls der Gast eine nicht zum Simulationsbaum gehörende Schaltung betrachtet).
- **Interaktive Eingaben durch freigegebene Kollaborateure:**
  - Teilnehmer mit Rolle *Kollaborateur* können `CircuitButton`- und `Sensor`-Eingaben auslösen; diese werden über den DataChannel an den Host gesendet, dort gegen die Berechtigung geprüft und direkt in die laufende Host-Simulation eingespeist.
  - Teilnehmer mit Rolle *Gast* sehen alle Live-Signale im Read-Only-Modus, ohne Eingaben auslösen zu können.
- **Abschluss & Speicher-Synchronisation:**
  - Beim Beenden (`STOP`) der Live-Simulation durch den Host werden eventuelle persistente RAM-Änderungen (`PersistentMemoryDump`) vom Host als reguläre Projekt-Revision an alle Gäste verteilt.

## Zugeordnete Tasks
- *(Werden bei Aufnahme in die aktive Bearbeitung geschnitten)*
