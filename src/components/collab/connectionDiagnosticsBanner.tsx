import React from "react";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import type CollabTransportState from "../../types/collab/transportState";

import { DEFAULT_COLLAB_GRACE_PERIOD_MS } from "../../collab/collabEvents";
import { type CollabConnectionDiagnostic, isCollabDisabledByEnv } from "../../utils/collabIceConfig";

export type ConnectionDiagnosticsBannerProps = Omit<React.ComponentPropsWithoutRef<"div">, "children"> & {
  transportState: CollabTransportState;
  diagnostic: CollabConnectionDiagnostic;
  gracePeriodMs?: number;
  onManualResync?: () => void;
  onDismiss?: () => void;
  disabledOverride?: boolean;
};

type BannerTone = "info" | "warning" | "error";

function resolveBannerTone(
  transportState: CollabTransportState,
  diagnostic: CollabConnectionDiagnostic,
): BannerTone {
  if (
    transportState === "failed" ||
    diagnostic.code === "stun-unreachable" ||
    diagnostic.code === "symmetric-nat-or-udp-blocked" ||
    diagnostic.code === "host-migration-unreachable"
  ) {
    return "error";
  }
  if (
    transportState === "degraded" ||
    transportState === "reconnecting" ||
    transportState === "disconnected" ||
    diagnostic.code === "signaling-unavailable"
  ) {
    return "warning";
  }
  return "info";
}

function getDiagnosticSummaryKey(
  transportState: CollabTransportState,
  diagnostic: CollabConnectionDiagnostic,
): { titleKey: string; descriptionKey: string } {
  switch (diagnostic.code) {
    case "stun-unreachable":
      return {
        titleKey: "collabDiagnostics.stunUnreachableTitle",
        descriptionKey: "collabDiagnostics.stunUnreachableBody",
      };
    case "symmetric-nat-or-udp-blocked":
      return {
        titleKey: "collabDiagnostics.symmetricNatTitle",
        descriptionKey: "collabDiagnostics.symmetricNatBody",
      };
    case "host-migration-unreachable":
      return {
        titleKey: "collabDiagnostics.hostMigrationFailedTitle",
        descriptionKey: "collabDiagnostics.hostMigrationFailedBody",
      };
    case "signaling-unavailable":
      return {
        titleKey: "collabDiagnostics.signalingUnavailableTitle",
        descriptionKey: "collabDiagnostics.signalingUnavailableBody",
      };
    default:
      break;
  }

  switch (transportState) {
    case "degraded":
      return {
        titleKey: "collabDiagnostics.degradedTitle",
        descriptionKey: "collabDiagnostics.degradedBody",
      };
    case "reconnecting":
      return {
        titleKey: "collabDiagnostics.reconnectingTitle",
        descriptionKey: "collabDiagnostics.reconnectingBody",
      };
    case "migrating-host":
      return {
        titleKey: "collabDiagnostics.migratingHostTitle",
        descriptionKey: "collabDiagnostics.migratingHostBody",
      };
    case "disconnected":
      return {
        titleKey: "collabDiagnostics.disconnectedTitle",
        descriptionKey: "collabDiagnostics.disconnectedBody",
      };
    case "failed":
      return {
        titleKey: "collabDiagnostics.symmetricNatTitle",
        descriptionKey: "collabDiagnostics.symmetricNatBody",
      };
    default:
      return {
        titleKey: "collabDiagnostics.connectingTitle",
        descriptionKey: "collabDiagnostics.connectingBody",
      };
  }
}

// Kompakte Status- und NAT-/Firewall-Diagnoseanzeige für WebRTC-P2P-Verbindungen (ohne TURN in v1)
const ConnectionDiagnosticsBanner = styled(({
  transportState,
  diagnostic,
  gracePeriodMs = DEFAULT_COLLAB_GRACE_PERIOD_MS,
  onManualResync,
  onDismiss,
  disabledOverride,
  ...other
}: ConnectionDiagnosticsBannerProps) => {
  const { t } = useTranslation();
  const isDisabled = disabledOverride !== undefined ? disabledOverride : isCollabDisabledByEnv();

  if (isDisabled || transportState === "idle" || (transportState === "connected" && diagnostic.code === "none")) {
    return null;
  }

  const tone = resolveBannerTone(transportState, diagnostic);
  const { titleKey, descriptionKey } = getDiagnosticSummaryKey(transportState, diagnostic);
  const gracePeriodSeconds = Math.max(1, Math.round(gracePeriodMs / 1000));

  return (
    <div
      {...other}
      data-component="ConnectionDiagnosticsBanner"
      data-tone={tone}
      data-state={transportState}
      data-diagnostic-code={diagnostic.code}
      role={tone === "error" ? "alert" : "status"}
    >
      <div className="banner-content">
        <div className="banner-title">{t(titleKey)}</div>
        <p className="banner-description">
          {t(descriptionKey, { seconds: gracePeriodSeconds })}
        </p>
        {diagnostic.turnPlannedHint && (
          <p className="turn-planned-hint" data-testid="collab-turn-planned-hint">
            {t("collabDiagnostics.turnPlannedHint")}
          </p>
        )}
      </div>

      {(onManualResync || onDismiss) && (
        <div className="banner-actions">
          {onManualResync && (
            <button
              type="button"
              className="action-btn resync-btn"
              data-testid="collab-manual-resync-btn"
              onClick={onManualResync}
            >
              {t("collabDiagnostics.manualResyncButton")}
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              className="action-btn dismiss-btn"
              aria-label={t("common.close")}
              onClick={onDismiss}
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
})({
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "0.75rem",
  padding: "0.65rem 0.85rem",
  borderRadius: "0.35rem",
  fontSize: "0.8rem",
  lineHeight: 1.45,
  backgroundColor: "var(--color-info-bg)",
  border: "1px solid var(--color-info-border)",
  color: "var(--color-text-primary)",

  "&[data-tone=\"warning\"]": {
    backgroundColor: "var(--color-warning-bg)",
    borderColor: "var(--color-warning-border)",
  },

  "&[data-tone=\"error\"]": {
    backgroundColor: "var(--color-error-bg)",
    borderColor: "var(--color-error-border)",
  },

  "& > .banner-content": {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    minWidth: 0,
    flex: 1,

    "& > .banner-title": {
      fontWeight: 600,
      color: "var(--color-text-primary)",
    },

    "& > .banner-description": {
      margin: 0,
      color: "var(--color-text-secondary)",
    },

    "& > .turn-planned-hint": {
      margin: "0.15rem 0 0",
      padding: "0.35rem 0.55rem",
      borderRadius: "0.25rem",
      backgroundColor: "var(--color-bg-elevated)",
      border: "1px solid var(--color-border-subtle)",
      color: "var(--color-text-secondary)",
      fontSize: "0.75rem",
    },
  },

  "& > .banner-actions": {
    display: "flex",
    alignItems: "center",
    gap: "0.35rem",
    flexShrink: 0,

    "& > .action-btn": {
      padding: "0.28rem 0.6rem",
      borderRadius: "0.25rem",
      fontSize: "0.75rem",
      fontWeight: 600,
      cursor: "pointer",
      border: "1px solid var(--color-border-strong)",
      backgroundColor: "var(--color-bg-elevated)",
      color: "var(--color-text-primary)",

      "&:hover": {
        borderColor: "var(--color-accent-primary)",
      },

      "&.dismiss-btn": {
        padding: "0.2rem 0.45rem",
        backgroundColor: "transparent",
        borderColor: "transparent",
        color: "var(--color-text-secondary)",

        "&:hover": {
          color: "var(--color-text-primary)",
          backgroundColor: "var(--color-bg-surface)",
        },
      },
    },
  },
});

export default ConnectionDiagnosticsBanner;
