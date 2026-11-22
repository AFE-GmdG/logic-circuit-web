# T-069: Non-Passive Wheel-Zoom-Listener auf dem Canvas

[← Zurück zum Scrum-Board](../scrum-board.md)

**Status:** Done  
**Typ:** UI  
**Zugehörige User Story:** [US-024](../user_stories/US-024-dsgvo-github-pages-und-passive-wheel-zoom-fix.md)  

## Ziel
Behebung der Browser-Konsolenwarnung `Unable to preventDefault inside passive event listener invocation.` beim Zoomen per Mausrad auf dem Schaltungs-Canvas.

## Betroffene Dateien
- `src/components/circuitCanvas/index.tsx` (Nativer `wheel`-Event-Listener mit `{ passive: false }` auf `containerRef.current` statt React-`onWheel`-Synthetic-Handler)

## Aufgaben
- `handleWheel` auf das native DOM-`WheelEvent` umstellen.
- Den `wheel`-Listener via `React.useEffect` explizit mit `{ passive: false }` an `containerRef.current` registrieren und beim Unmount/Update sauber deregistrieren.
- Das `onWheel={handleWheel}`-Prop vom `<svg>`-Element entfernen.

## Testkriterien
- Typecheck (`yarn errorcheck`), Linter (`yarn lint`) und Docs-Linter (`yarn lint-docs`) laufen fehlerfrei durch.
- Automatisierte Unit-Tests (`yarn test`) und Production Build (`yarn build`) laufen fehlerfrei durch.
