import React from "react";
import { LLMProvider, ProviderResponse } from "../types";

interface ClipsCarouselProps {
  providers: LLMProvider[];
  responsesMap: Record<string, ProviderResponse[]>;
  activeProviderId?: string;
  onClipClick: (providerId: string) => void;
  type?: "synthesis" | "mapping";
}

const ClipsCarousel: React.FC<ClipsCarouselProps> = ({
  providers,
  responsesMap,
  activeProviderId,
  onClipClick,
  type = "synthesis",
}) => {
  // In ClipsCarousel.tsx - Simplified for historical-only usage
  const getProviderState = (
    providerId: string,
  ): "never-run" | "available" | "loading" => {
    const responses = responsesMap[providerId];

    if (responses === undefined) {
      return "never-run";
    }

    if (!Array.isArray(responses) || responses.length === 0) {
      return "never-run";
    }

    const last = responses[responses.length - 1];
    if (last.status === "pending" || last.status === "streaming") {
      return "loading";
    }

    return "available";
  };

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {providers.map((p) => {
        const state = getProviderState(String(p.id));
        const isSelected = activeProviderId === p.id;
        const isDisabled = state === "loading"; // ← ONLY disable when loading
        const isNeverRun = state === "never-run";

        const baseBg = isNeverRun ? "#0f172a" : "rgba(255,255,255,0.06)";
        const borderColor = isSelected
          ? p.color
          : isNeverRun
            ? "#334155"
            : "#475569";
        const textColor = isNeverRun ? "#64748b" : "#e2e8f0";
        const cursor = isDisabled
          ? ("not-allowed" as const)
          : ("pointer" as const);

        return (
          <button
            type="button"
            key={String(p.id)}
            onClick={() => !isDisabled && onClipClick(String(p.id))}
            disabled={isDisabled}
            title={
              isNeverRun
                ? `Run ${p.name} ${type}`
                : state === "loading"
                  ? `${p.name} (${type} running...)`
                  : `View ${p.name} ${type}`
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 999,
              border: `1px solid ${borderColor}`,
              background: baseBg,
              color: textColor,
              opacity: isDisabled ? 0.7 : 1,
              fontSize: 12,
              cursor,
              boxShadow: isSelected ? `0 0 0 2px ${p.color}20` : undefined,
            }}
          >
            {state === "loading"
              ? "⏳"
              : isNeverRun
                ? "○"
                : isSelected
                  ? "●"
                  : "◉"}
            {p.name}
          </button>
        );
      })}
    </div>
  );
};

export default ClipsCarousel;
