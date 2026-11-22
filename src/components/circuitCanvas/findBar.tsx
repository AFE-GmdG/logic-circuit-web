import React from "react";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import type CircuitProject from "../../types/circuit/circuitProject";
import type FindItemKind from "../../types/find/findItemKind";
import type FindPreferences from "../../types/find/findPreferences";
import type FindResult from "../../types/find/findResult";
import type FindScope from "../../types/find/findScope";

import {
  loadFindPreferences,
  pushRecentFindQuery,
  removeRecentFindQuery,
  saveFindPreferences,
} from "../../utils/findPreferencesStorage";
import { searchProject, splitHighlightSegments } from "../../utils/projectSearch";

const MAX_RENDERED_RESULTS = 200;

export type FindBarProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  focusSignal: number;
  project: CircuitProject;
  currentCircuitId: string;
  initialQuery?: string;
  onNavigateToResult: (result: FindResult) => void;
  onClose: () => void;
};

function getItemKindLabel(kind: FindItemKind, t: (key: string) => string): string {
  switch (kind) {
    case "circuit":
      return t("find.types.circuit");
    case "subCircuit":
      return t("find.types.subCircuit");
    case "pinIn":
      return t("find.types.pinIn");
    case "pinOut":
      return t("find.types.pinOut");
    case "probe":
      return t("find.types.probe");
    case "button":
      return t("find.types.button");
    case "gate":
      return t("find.types.gate");
    case "clock":
      return t("find.types.clock");
    case "led":
      return t("find.types.led");
    case "sevenSegment":
      return t("find.types.sevenSegment");
    case "ledMatrix":
      return t("find.types.ledMatrix");
    case "constant":
      return t("find.types.constant");
    case "memory":
      return t("find.types.memory");
    case "sensor":
      return t("find.types.sensor");
    case "splitter":
      return t("find.types.splitter");
    case "sound":
      return t("find.types.sound");
    case "synthesizer":
      return t("find.types.synthesizer");
    case "graphicsArray":
      return t("find.types.graphicsArray");
    case "textNote":
      return t("find.types.textNote");
  }
}

function renderHighlightedText(
  text: string,
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
): React.ReactNode {
  const segments = splitHighlightSegments(text, query, matchCase, wholeWord);
  if (segments.length === 0) {
    return text;
  }

  return segments.map((segment, index) =>
    segment.matched ? (
      <mark key={index} className="find-highlight">
        {segment.text}
      </mark>
    ) : (
      <React.Fragment key={index}>{segment.text}</React.Fragment>
    ),
  );
}

// Schwebende VS-Code-artige Such-Leiste oben mittig im Canvas für Projekt- und Schaltungssuche (Strg+F)
const FindBar = styled(({
  isOpen,
  focusSignal,
  project,
  currentCircuitId,
  initialQuery = "",
  onNavigateToResult,
  onClose,
  ...other
}: FindBarProps) => {
  const { t } = useTranslation();
  const [query, setQuery] = React.useState<string>(() => initialQuery);
  const [preferences, setPreferences] = React.useState<FindPreferences>(
    () => loadFindPreferences(),
  );
  const [activeIndex, setActiveIndex] = React.useState<number>(0);
  const [recentActiveIndex, setRecentActiveIndex] = React.useState<number>(0);

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const resultItemRefs = React.useRef<Record<number, HTMLButtonElement | null>>({});

  const updatePreferences = React.useCallback(
    (updater: (prev: FindPreferences) => FindPreferences) => {
      setPreferences((prev) => {
        const next = updater(prev);
        saveFindPreferences(next);
        return next;
      });
    },
    [],
  );

  // Fokussiert und markiert das Suchfeld beim Öffnen oder erneuten Strg+F
  React.useEffect(
    () => {
      if (!isOpen) {
        return;
      }
      const rafId = requestAnimationFrame(() => {
        const input = inputRef.current;
        if (input) {
          input.focus();
          input.select();
        }
      });
      return () => cancelAnimationFrame(rafId);
    },
    [focusSignal, isOpen],
  );

  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;

  const results = React.useMemo(
    () =>
      searchProject(project, query, {
        scope: preferences.scope,
        currentCircuitId,
        matchCase: preferences.matchCase,
        wholeWord: preferences.wholeWord,
        includeNotes: preferences.includeNotes,
      }),
    [
      currentCircuitId,
      preferences.includeNotes,
      preferences.matchCase,
      preferences.scope,
      preferences.wholeWord,
      project,
      query,
    ],
  );

  const visibleResults = React.useMemo(
    () => results.slice(0, MAX_RENDERED_RESULTS),
    [results],
  );

  // Aktiven Trefferindex bei neuer Trefferliste zurücksetzen bzw. gültig halten
  React.useEffect(
    () => {
      setActiveIndex(visibleResults.length > 0 ? 0 : -1);
    },
    [visibleResults],
  );

  React.useEffect(
    () => {
      const len = preferences.recentQueries.length;
      setRecentActiveIndex((prev) => {
        if (len === 0) {
          return -1;
        }
        if (prev < 0 || prev >= len) {
          return 0;
        }
        return prev;
      });
    },
    [preferences.recentQueries.length],
  );

  const commitRecentQuery = React.useCallback(
    (term: string) => {
      if (!term.trim()) {
        return;
      }
      updatePreferences((prev) => ({
        ...prev,
        recentQueries: pushRecentFindQuery(prev.recentQueries, term),
      }));
    },
    [updatePreferences],
  );

  const navigateToIndex = React.useCallback(
    (index: number, closeAfter = false) => {
      const target = visibleResults[index];
      if (!target) {
        return;
      }
      setActiveIndex(index);
      commitRecentQuery(query);
      onNavigateToResult(target);
      resultItemRefs.current[index]?.scrollIntoView?.({ block: "nearest" });
      if (closeAfter) {
        onClose();
      }
    },
    [
      commitRecentQuery,
      onClose,
      onNavigateToResult,
      query,
      visibleResults,
    ],
  );

  const handleStepMatch = React.useCallback(
    (delta: 1 | -1) => {
      if (visibleResults.length === 0) {
        return;
      }
      const baseIndex = activeIndex >= 0 ? activeIndex : 0;
      const nextIndex = (baseIndex + delta + visibleResults.length) % visibleResults.length;
      navigateToIndex(nextIndex, false);
    },
    [
      activeIndex,
      navigateToIndex,
      visibleResults.length,
    ],
  );

  const handleSelectRecentQuery = React.useCallback(
    (term: string) => {
      setQuery(term);
      commitRecentQuery(term);
      inputRef.current?.focus();
    },
    [commitRecentQuery],
  );

  const handleToggleMatchCase = React.useCallback(
    () => {
      updatePreferences((prev) => ({ ...prev, matchCase: !prev.matchCase }));
    },
    [updatePreferences],
  );

  const handleToggleWholeWord = React.useCallback(
    () => {
      updatePreferences((prev) => ({ ...prev, wholeWord: !prev.wholeWord }));
    },
    [updatePreferences],
  );

  const handleToggleIncludeNotes = React.useCallback(
    () => {
      updatePreferences((prev) => ({ ...prev, includeNotes: !prev.includeNotes }));
    },
    [updatePreferences],
  );

  const handleChangeScope = React.useCallback(
    (scope: FindScope) => {
      updatePreferences((prev) => ({ ...prev, scope }));
    },
    [updatePreferences],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key === "F3") {
      event.preventDefault();
      event.stopPropagation();
      handleStepMatch(event.shiftKey ? -1 : 1);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (hasQuery && visibleResults.length > 0) {
        const nextIndex =
          activeIndex < 0 ? 0 : (activeIndex + 1) % visibleResults.length;
        setActiveIndex(nextIndex);
        resultItemRefs.current[nextIndex]?.scrollIntoView?.({ block: "nearest" });
      } else if (!hasQuery && preferences.recentQueries.length > 0) {
        const len = preferences.recentQueries.length;
        setRecentActiveIndex((prev) => (prev < 0 ? 0 : (prev + 1) % len));
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (hasQuery && visibleResults.length > 0) {
        const nextIndex =
          activeIndex < 0
            ? visibleResults.length - 1
            : (activeIndex - 1 + visibleResults.length) % visibleResults.length;
        setActiveIndex(nextIndex);
        resultItemRefs.current[nextIndex]?.scrollIntoView?.({ block: "nearest" });
      } else if (!hasQuery && preferences.recentQueries.length > 0) {
        const len = preferences.recentQueries.length;
        setRecentActiveIndex((prev) => (prev < 0 ? len - 1 : (prev - 1 + len) % len));
      }
      return;
    }

    if (event.key === "Enter") {
      if (hasQuery) {
        event.preventDefault();
        if (visibleResults.length > 0) {
          const targetIndex = activeIndex >= 0 ? activeIndex : 0;
          navigateToIndex(targetIndex, false);
        }
      } else if (
        recentActiveIndex >= 0 &&
        preferences.recentQueries[recentActiveIndex]
      ) {
        event.preventDefault();
        handleSelectRecentQuery(preferences.recentQueries[recentActiveIndex]);
      }
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      {...other}
      data-component="FindBar"
      role="search"
      aria-label={t("find.ariaLabel")}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <div className="find-input-row">
        <div className="find-input-box">
          <svg
            viewBox="0 0 16 16"
            className="search-icon"
            aria-hidden="true"
          >
            <path
              d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85zm-5.242.656a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"
              fill="currentColor"
            />
          </svg>

          <input
            ref={inputRef}
            type="text"
            className="find-input"
            data-testid="find-bar-input"
            value={query}
            placeholder={t("find.placeholder")}
            aria-label={t("find.placeholder")}
            autoFocus={true}
            onChange={(event) => setQuery(event.target.value)}
          />

          {query !== "" && (
            <button
              type="button"
              className="clear-input-btn"
              data-testid="find-clear-input"
              aria-label={t("find.clearQueryAriaLabel")}
              title={t("find.clearQueryAriaLabel")}
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              ×
            </button>
          )}

          <div className="input-toggles" role="group" aria-label={t("find.ariaLabel")}>
            <button
              type="button"
              className={`toggle-btn${preferences.matchCase ? " active" : ""}`}
              data-testid="find-toggle-case"
              aria-pressed={preferences.matchCase}
              aria-label={t("find.matchCaseAriaLabel")}
              title={t("find.matchCaseTitle")}
              onClick={handleToggleMatchCase}
            >
              <span className="case-glyph" aria-hidden="true">Aa</span>
            </button>

            <button
              type="button"
              className={`toggle-btn${preferences.wholeWord ? " active" : ""}`}
              data-testid="find-toggle-word"
              aria-pressed={preferences.wholeWord}
              aria-label={t("find.wholeWordAriaLabel")}
              title={t("find.wholeWordTitle")}
              onClick={handleToggleWholeWord}
            >
              <span className="word-glyph" aria-hidden="true">
                <span>ab</span>
                <svg viewBox="0 0 16 4" className="word-bracket">
                  <path d="M1.5 0.5V3H14.5V0.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </span>
            </button>

            <button
              type="button"
              className={`toggle-btn${preferences.includeNotes ? " active" : ""}`}
              data-testid="find-toggle-notes"
              aria-pressed={preferences.includeNotes}
              aria-label={t("find.includeNotesAriaLabel")}
              title={t("find.includeNotesTitle")}
              onClick={handleToggleIncludeNotes}
            >
              <svg viewBox="0 0 16 16" className="notes-glyph" aria-hidden="true">
                <path
                  d="M3 2h7.5L13 4.5V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm1 4v1h7V6H4zm0 2.5v1h7v-1H4zm0 2.5v1h5v-1H4z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        </div>

        <button
          type="button"
          className="close-bar-btn"
          data-testid="find-close-button"
          aria-label={t("find.closeAriaLabel")}
          title={t("find.closeAriaLabel")}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="find-toolbar-row">
        <div className="scope-switch" role="group" aria-label={t("find.ariaLabel")}>
          <button
            type="button"
            className={`scope-btn${preferences.scope === "project" ? " active" : ""}`}
            data-testid="find-scope-project"
            aria-pressed={preferences.scope === "project"}
            onClick={() => handleChangeScope("project")}
          >
            {t("find.scopeProject")}
          </button>
          <button
            type="button"
            className={`scope-btn${preferences.scope === "current" ? " active" : ""}`}
            data-testid="find-scope-current"
            aria-pressed={preferences.scope === "current"}
            onClick={() => handleChangeScope("current")}
          >
            {t("find.scopeCurrent")}
          </button>
        </div>

        <div className="match-controls">
          <span className="match-count" data-testid="find-match-count">
            {hasQuery
              ? t("find.matchCount", { count: results.length })
              : preferences.recentQueries.length > 0
                ? t("find.recentTitle")
                : ""}
          </span>

          {hasQuery && visibleResults.length > 0 && (
            <div className="step-buttons">
              <button
                type="button"
                className="step-btn"
                data-testid="find-prev-match"
                aria-label={t("find.prevMatchTitle")}
                title={t("find.prevMatchTitle")}
                onClick={() => handleStepMatch(-1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="step-btn"
                data-testid="find-next-match"
                aria-label={t("find.nextMatchTitle")}
                title={t("find.nextMatchTitle")}
                onClick={() => handleStepMatch(1)}
              >
                ↓
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="find-dropdown">
        {hasQuery ? (
          visibleResults.length === 0 ? (
            <div className="empty-state" data-testid="find-no-matches">
              {t("find.noMatches")}
            </div>
          ) : (
            <>
              <div className="result-list" role="listbox" aria-label={t("find.ariaLabel")}>
                {visibleResults.map((result, index) => {
                  const isActive = index === activeIndex;
                  const typeLabel = getItemKindLabel(result.itemKind, t);
                  const coordsText = result.gridPoint
                    ? `(${result.gridPoint.x}, ${result.gridPoint.y})`
                    : "";
                  return (
                    <button
                      key={result.id}
                      ref={(el) => {
                        resultItemRefs.current[index] = el;
                      }}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      data-testid={`find-result-${index}`}
                      className={`result-row${isActive ? " active" : ""}`}
                      onClick={() => navigateToIndex(index, false)}
                      onDoubleClick={() => navigateToIndex(index, true)}
                    >
                      <div className="result-main">
                        <span className={`type-badge kind-${result.itemKind}`}>
                          {typeLabel}
                        </span>
                        <div className="result-texts">
                          <div className="result-title-line">
                            <span className="result-label">
                              {renderHighlightedText(
                                result.label,
                                trimmedQuery,
                                preferences.matchCase,
                                preferences.wholeWord,
                              )}
                            </span>
                            {result.secondaryLabel && (
                              <span className="result-secondary">
                                {renderHighlightedText(
                                  result.secondaryLabel,
                                  trimmedQuery,
                                  preferences.matchCase,
                                  preferences.wholeWord,
                                )}
                              </span>
                            )}
                          </div>
                          {result.matchedNoteSnippet && (
                            <div className="result-note-snippet">
                              <span className="note-prefix">{t("find.notePrefix")}</span>{" "}
                              {renderHighlightedText(
                                result.matchedNoteSnippet,
                                trimmedQuery,
                                preferences.matchCase,
                                preferences.wholeWord,
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="result-meta">
                        {preferences.scope === "project" && result.entityType !== "circuit" && (
                          <span className="result-circuit">{result.circuitName}</span>
                        )}
                        {coordsText && <span className="result-coords">{coordsText}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
              {results.length > MAX_RENDERED_RESULTS && (
                <div className="truncated-hint">
                  {t("find.truncatedHint", {
                    shown: MAX_RENDERED_RESULTS,
                    total: results.length,
                  })}
                </div>
              )}
            </>
          )
        ) : preferences.recentQueries.length > 0 ? (
          <div className="recent-section" data-testid="find-recent-list">
            <div className="recent-header">
              <span>{t("find.recentTitle")}</span>
              <button
                type="button"
                className="clear-history-btn"
                data-testid="find-clear-history"
                onClick={() =>
                  updatePreferences((prev) => ({
                    ...prev,
                    recentQueries: [],
                  }))
                }
              >
                {t("find.clearHistoryButton")}
              </button>
            </div>
            <div className="recent-list" role="listbox" aria-label={t("find.recentTitle")}>
              {preferences.recentQueries.map((term, index) => (
                <div
                  key={term}
                  className={`recent-row${index === recentActiveIndex ? " active" : ""}`}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === recentActiveIndex}
                    className="recent-select-btn"
                    data-testid={`find-recent-${index}`}
                    onClick={() => handleSelectRecentQuery(term)}
                  >
                    <span className="recent-icon" aria-hidden="true">↺</span>
                    <span className="recent-term">{term}</span>
                  </button>
                  <button
                    type="button"
                    className="recent-remove-btn"
                    aria-label={t("find.removeHistoryItemAriaLabel", { query: term })}
                    onClick={() =>
                      updatePreferences((prev) => ({
                        ...prev,
                        recentQueries: removeRecentFindQuery(prev.recentQueries, term),
                      }))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-state">{t("find.emptyHint")}</div>
        )}
      </div>
    </div>
  );
})({
  position: "absolute",
  top: "0.75rem",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 60,
  width: "min(36rem, calc(100% - 2rem))",
  backgroundColor: "var(--color-bg-surface)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.5rem",
  boxShadow: "0 0.9rem 2.25rem rgba(0, 0, 0, 0.58)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  color: "var(--color-text-primary)",

  "& > .find-input-row": {
    display: "flex",
    alignItems: "center",
    gap: "0.35rem",
    padding: "0.5rem 0.6rem 0.4rem",
    backgroundColor: "var(--color-bg-elevated)",

    "& > .find-input-box": {
      flex: 1,
      display: "flex",
      alignItems: "center",
      gap: "0.35rem",
      padding: "0.2rem 0.3rem 0.2rem 0.5rem",
      backgroundColor: "var(--color-bg-base)",
      border: "1px solid var(--color-border-strong)",
      borderRadius: "0.32rem",
      minWidth: 0,

      "&:focus-within": {
        borderColor: "var(--color-accent-primary)",
      },

      "& > .search-icon": {
        width: "0.85rem",
        height: "0.85rem",
        color: "var(--color-text-muted)",
        flexShrink: 0,
      },

      "& > .find-input": {
        flex: 1,
        minWidth: 0,
        border: "none",
        background: "transparent",
        color: "var(--color-text-primary)",
        fontSize: "0.84rem",
        lineHeight: 1.4,
        outline: "none",

        "&::placeholder": {
          color: "var(--color-text-muted)",
        },
      },

      "& > .clear-input-btn": {
        appearance: "none",
        border: "none",
        background: "transparent",
        color: "var(--color-text-muted)",
        fontSize: "0.95rem",
        lineHeight: 1,
        padding: "0.1rem 0.25rem",
        borderRadius: "0.2rem",
        cursor: "pointer",

        "&:hover": {
          color: "var(--color-text-primary)",
          backgroundColor: "var(--color-bg-elevated)",
        },
      },

      "& > .input-toggles": {
        display: "flex",
        alignItems: "center",
        gap: "0.15rem",
        flexShrink: 0,

        "& > .toggle-btn": {
          appearance: "none",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "1.55rem",
          height: "1.45rem",
          padding: "0 0.25rem",
          borderRadius: "0.22rem",
          border: "1px solid transparent",
          backgroundColor: "transparent",
          color: "var(--color-text-secondary)",
          fontSize: "0.75rem",
          fontWeight: 600,
          cursor: "pointer",
          transition: "background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease",

          "&:hover": {
            backgroundColor: "var(--color-bg-elevated)",
            color: "var(--color-text-primary)",
          },

          "&.active": {
            backgroundColor: "var(--color-accent-primary-bg)",
            borderColor: "var(--color-accent-primary)",
            color: "var(--color-text-primary)",
          },

          "& > .case-glyph": {
            fontFamily: "var(--font-family-mono)",
            fontSize: "0.74rem",
            lineHeight: 1,
          },

          "& > .word-glyph": {
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            fontFamily: "var(--font-family-mono)",
            fontSize: "0.72rem",
            lineHeight: 0.95,

            "& > .word-bracket": {
              width: "0.95rem",
              height: "0.22rem",
            },
          },

          "& > .notes-glyph": {
            width: "0.85rem",
            height: "0.85rem",
          },
        },
      },
    },

    "& > .close-bar-btn": {
      appearance: "none",
      border: "none",
      background: "transparent",
      color: "var(--color-text-secondary)",
      fontSize: "0.88rem",
      lineHeight: 1,
      padding: "0.3rem 0.42rem",
      borderRadius: "0.25rem",
      cursor: "pointer",

      "&:hover": {
        backgroundColor: "var(--color-bg-surface)",
        color: "var(--color-text-primary)",
      },
    },
  },

  "& > .find-toolbar-row": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
    padding: "0.3rem 0.65rem 0.4rem",
    backgroundColor: "var(--color-bg-elevated)",
    borderBottom: "1px solid var(--color-border-subtle)",

    "& > .scope-switch": {
      display: "inline-flex",
      alignItems: "center",
      gap: "0.2rem",

      "& > .scope-btn": {
        appearance: "none",
        padding: "0.18rem 0.5rem",
        borderRadius: "0.22rem",
        border: "1px solid transparent",
        backgroundColor: "transparent",
        color: "var(--color-text-secondary)",
        fontSize: "0.73rem",
        fontWeight: 500,
        cursor: "pointer",

        "&:hover": {
          backgroundColor: "var(--color-bg-surface)",
          color: "var(--color-text-primary)",
        },

        "&.active": {
          backgroundColor: "var(--color-accent-primary-bg)",
          borderColor: "var(--color-accent-primary)",
          color: "var(--color-text-primary)",
          fontWeight: 600,
        },
      },
    },

    "& > .match-controls": {
      display: "inline-flex",
      alignItems: "center",
      gap: "0.4rem",

      "& > .match-count": {
        fontSize: "0.73rem",
        color: "var(--color-text-muted)",
      },

      "& > .step-buttons": {
        display: "inline-flex",
        alignItems: "center",
        gap: "0.15rem",

        "& > .step-btn": {
          appearance: "none",
          width: "1.35rem",
          height: "1.35rem",
          borderRadius: "0.22rem",
          border: "1px solid var(--color-border-subtle)",
          backgroundColor: "var(--color-bg-surface)",
          color: "var(--color-text-secondary)",
          fontSize: "0.74rem",
          lineHeight: 1,
          cursor: "pointer",

          "&:hover": {
            borderColor: "var(--color-accent-primary)",
            color: "var(--color-text-primary)",
          },
        },
      },
    },
  },

  "& > .find-dropdown": {
    maxHeight: "20rem",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",

    "& .find-highlight": {
      backgroundColor: "var(--color-accent-highlight)",
      color: "var(--color-text-primary)",
      borderRadius: "0.15rem",
      padding: "0 0.08rem",
    },

    "& > .empty-state": {
      padding: "0.75rem 0.9rem",
      fontSize: "0.8rem",
      color: "var(--color-text-muted)",
    },

    "& > .truncated-hint": {
      padding: "0.45rem 0.75rem",
      fontSize: "0.74rem",
      color: "var(--color-text-muted)",
      borderTop: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-bg-elevated)",
    },

    "& > .result-list": {
      display: "flex",
      flexDirection: "column",
      padding: "0.25rem",
      gap: "0.12rem",

      "& > .result-row": {
        appearance: "none",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.65rem",
        padding: "0.38rem 0.5rem",
        borderRadius: "0.28rem",
        border: "1px solid transparent",
        backgroundColor: "transparent",
        color: "var(--color-text-primary)",
        textAlign: "left",
        cursor: "pointer",

        "&:hover": {
          backgroundColor: "var(--color-bg-elevated)",
        },

        "&.active": {
          backgroundColor: "var(--color-accent-primary-bg)",
          borderColor: "var(--color-accent-primary)",
        },

        "& > .result-main": {
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          minWidth: 0,
          flex: 1,

          "& > .type-badge": {
            flexShrink: 0,
            fontSize: "0.68rem",
            fontWeight: 600,
            padding: "0.12rem 0.38rem",
            borderRadius: "0.22rem",
            backgroundColor: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border-subtle)",
            color: "var(--color-text-secondary)",
            whiteSpace: "nowrap",
          },

          "& > .result-texts": {
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            gap: "0.12rem",

            "& > .result-title-line": {
              display: "flex",
              alignItems: "baseline",
              gap: "0.4rem",
              minWidth: 0,

              "& > .result-label": {
                fontSize: "0.82rem",
                fontWeight: 600,
                color: "var(--color-text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              },

              "& > .result-secondary": {
                fontSize: "0.73rem",
                color: "var(--color-text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              },
            },

            "& > .result-note-snippet": {
              fontSize: "0.73rem",
              color: "var(--color-text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",

              "& > .note-prefix": {
                color: "var(--color-text-muted)",
              },
            },
          },
        },

        "& > .result-meta": {
          display: "inline-flex",
          alignItems: "center",
          gap: "0.45rem",
          flexShrink: 0,

          "& > .result-circuit": {
            fontSize: "0.73rem",
            color: "var(--color-text-secondary)",
            maxWidth: "8.5rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          },

          "& > .result-coords": {
            fontFamily: "var(--font-family-mono)",
            fontSize: "0.72rem",
            color: "var(--color-text-muted)",
          },
        },
      },
    },

    "& > .recent-section": {
      display: "flex",
      flexDirection: "column",
      padding: "0.3rem",
      gap: "0.2rem",

      "& > .recent-header": {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.15rem 0.45rem",
        fontSize: "0.72rem",
        fontWeight: 600,
        color: "var(--color-text-muted)",

        "& > .clear-history-btn": {
          appearance: "none",
          border: "none",
          background: "transparent",
          color: "var(--color-accent-primary)",
          fontSize: "0.72rem",
          cursor: "pointer",
          padding: "0.1rem 0.25rem",

          "&:hover": {
            textDecoration: "underline",
          },
        },
      },

      "& > .recent-list": {
        display: "flex",
        flexDirection: "column",
        gap: "0.1rem",

        "& > .recent-row": {
          display: "flex",
          alignItems: "center",
          borderRadius: "0.25rem",

          "&:hover": {
            backgroundColor: "var(--color-bg-elevated)",
          },

          "&.active": {
            backgroundColor: "var(--color-accent-primary-bg)",
          },

          "& > .recent-select-btn": {
            appearance: "none",
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: "0.45rem",
            border: "none",
            background: "transparent",
            color: "var(--color-text-primary)",
            padding: "0.32rem 0.5rem",
            fontSize: "0.8rem",
            textAlign: "left",
            cursor: "pointer",
            minWidth: 0,

            "& > .recent-icon": {
              color: "var(--color-text-muted)",
              fontSize: "0.78rem",
            },

            "& > .recent-term": {
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            },
          },

          "& > .recent-remove-btn": {
            appearance: "none",
            border: "none",
            background: "transparent",
            color: "var(--color-text-muted)",
            fontSize: "0.9rem",
            padding: "0.22rem 0.45rem",
            cursor: "pointer",

            "&:hover": {
              color: "var(--color-text-primary)",
            },
          },
        },
      },
    },
  },
});

export default FindBar;
