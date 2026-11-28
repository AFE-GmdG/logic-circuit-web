import React from "react";

import styled from "@emotion/styled";

import CircuitContext from "../../contexts/circuitContext";
import CollabContext from "../../contexts/collabContext";

import type ViewportTransform from "../../types/canvas/viewportTransform";
import type CollabCursorVisibilityMode from "../../types/settings/collabCursorVisibilityMode";

import {
  type CollabPresenceCursorMap,
  type CollabRemoteCursorEntry,
  isRemoteCursorIdle,
  shouldShowRemoteCursor,
} from "../../collab/collabPresenceController";
import {
  resolveCollabCursorIdleTimeoutSec,
  resolveCollabCursorVisibilityMode,
} from "../../utils/appSettingsStorage";
import {
  getParticipantContrastTextColor,
  pickAutoParticipantColor,
} from "../../utils/collabParticipantColors";
import { canvasToScreen } from "../../utils/coordinateSystem";

export type CollabCursorOverlayProps = Omit<React.ComponentPropsWithoutRef<"div">, "children"> & {
  viewport: ViewportTransform;
  activeCircuitId: string | null;
  isEditingLibrary?: boolean;
  idleTimeoutSec?: number;
  visibilityMode?: CollabCursorVisibilityMode;
  now?: () => number;
};

const EMPTY_CURSORS: CollabPresenceCursorMap = {};

function noopSubscribe(): () => void {
  return () => undefined;
}

function getEmptyCursors(): CollabPresenceCursorMap {
  return EMPTY_CURSORS;
}

function formatCursorLabel(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 22) {
    return trimmed;
  }
  return `${trimmed.slice(0, 21)}…`;
}

// Eigenständiges HTML-Overlay für fremde Live-Cursor (entkoppelt vom Schaltungs-SVG ohne SVG-Re-Renders)
const CollabCursorOverlay = styled(({
  viewport,
  activeCircuitId,
  isEditingLibrary = false,
  idleTimeoutSec,
  visibilityMode,
  now = () => Date.now(),
  ...other
}: CollabCursorOverlayProps) => {
  const collabContext = React.useContext(CollabContext);
  const circuitContext = React.useContext(CircuitContext);
  const [idleTick, setIdleTick] = React.useState(0);

  const subscribeCursors = collabContext?.subscribeRemoteCursors ?? noopSubscribe;
  const getCursorsSnapshot = collabContext?.getRemoteCursors ?? getEmptyCursors;
  const cursors = React.useSyncExternalStore(subscribeCursors, getCursorsSnapshot, getCursorsSnapshot);

  const effectiveIdleTimeoutSec = resolveCollabCursorIdleTimeoutSec(
    idleTimeoutSec ?? circuitContext?.appSettings?.collabCursorIdleTimeoutSec,
  );
  const effectiveVisibilityMode = resolveCollabCursorVisibilityMode(
    visibilityMode ?? circuitContext?.appSettings?.collabCursorVisibilityMode,
  );

  const isOverlayActive = Boolean(collabContext?.isInSession && !isEditingLibrary && activeCircuitId);
  const nowMs = now();

  const visibleCursors: CollabRemoteCursorEntry[] = [];
  let earliestExpireDelayMs: number | null = null;

  if (isOverlayActive) {
    const selfPeerId = collabContext?.selfPeerId;
    const peerStates = collabContext?.presenceState?.peers;
    const followingPeerId = collabContext?.followingPeerId ?? null;
    for (const entry of Object.values(cursors)) {
      if (selfPeerId && entry.peerId === selfPeerId) {
        continue;
      }
      if (entry.logicalCircuitId !== activeCircuitId) {
        continue;
      }
      if (peerStates?.[entry.peerId]?.inLibraryMode) {
        continue;
      }
      const participant = collabContext?.participants.find((p) => p.peerId === entry.peerId);
      if (
        !shouldShowRemoteCursor({
          mode: effectiveVisibilityMode,
          participantRole: participant?.role ?? null,
          handRaised: participant?.handRaised ?? false,
          isFollowed: followingPeerId === entry.peerId,
        })
      ) {
        continue;
      }
      if (isRemoteCursorIdle(entry, nowMs, effectiveIdleTimeoutSec)) {
        continue;
      }
      visibleCursors.push(entry);
      if (effectiveIdleTimeoutSec > 0) {
        const remainingMs = entry.lastMovedAt + effectiveIdleTimeoutSec * 1000 - nowMs;
        earliestExpireDelayMs = earliestExpireDelayMs === null
          ? Math.max(16, remainingMs)
          : Math.min(earliestExpireDelayMs, Math.max(16, remainingMs));
      }
    }
  }

  React.useEffect(
    () => {
      if (earliestExpireDelayMs === null) {
        return undefined;
      }
      const timer = setTimeout(() => {
        setIdleTick((prev) => prev + 1);
      }, earliestExpireDelayMs);
      return () => clearTimeout(timer);
    },
    [earliestExpireDelayMs, idleTick],
  );

  if (!isOverlayActive) {
    return null;
  }

  return (
    <div
      {...other}
      data-component="CollabCursorOverlay"
      data-testid="collab-cursor-overlay"
      aria-hidden="true"
    >
      {visibleCursors.map((entry) => {
        const participant = collabContext?.participants.find((p) => p.peerId === entry.peerId);
        const displayName = participant?.displayName ?? entry.peerId;
        const color = collabContext?.getParticipantColor?.(entry.peerId, displayName)
          ?? pickAutoParticipantColor(new Set(), displayName);
        const textColor = getParticipantContrastTextColor(color);
        const screen = canvasToScreen({ x: entry.x, y: entry.y }, viewport);

        return (
          <div
            key={entry.peerId}
            className="remote-cursor"
            data-testid={`collab-remote-cursor-${entry.peerId}`}
            data-peer-id={entry.peerId}
            data-color={color}
            style={{
              transform: `translate3d(${screen.x}px, ${screen.y}px, 0)`,
            }}
          >
            <svg
              className="remote-cursor-arrow"
              viewBox="0 0 18 20"
              width="16"
              height="18"
              aria-hidden="true"
            >
              <path
                d="M1.5 1.5L15.5 9.2L9.2 11.2L6.2 17.5L1.5 1.5Z"
                fill={color}
                stroke="#ffffff"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            <span
              className="remote-cursor-label"
              style={{
                backgroundColor: color,
                color: textColor,
              }}
            >
              {formatCursorLabel(displayName)}
            </span>
          </div>
        );
      })}
    </div>
  );
})({
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  overflow: "hidden",
  zIndex: 20,

  "& > .remote-cursor": {
    position: "absolute",
    top: 0,
    left: 0,
    display: "inline-flex",
    alignItems: "flex-start",
    gap: "0.2rem",
    willChange: "transform",
    transition: "transform 65ms linear",
    pointerEvents: "none",
    userSelect: "none",

    "& > .remote-cursor-arrow": {
      display: "block",
      flexShrink: 0,
      filter: "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45))",
    },

    "& > .remote-cursor-label": {
      marginTop: "0.75rem",
      padding: "0.1rem 0.4rem",
      borderRadius: "0.25rem",
      fontSize: "0.6875rem",
      fontWeight: 700,
      lineHeight: 1.25,
      whiteSpace: "nowrap",
      boxShadow: "0 1px 4px rgba(0, 0, 0, 0.35)",
    },
  },
});

export default CollabCursorOverlay;
