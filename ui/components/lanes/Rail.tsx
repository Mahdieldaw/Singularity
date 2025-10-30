import React from 'react';
import { tokens } from '../../theme/tokens';
import { getProviderById } from '../../providers/providerRegistry';

export type RailPosition = 'left' | 'right';

export interface RailCardState {
  streaming?: boolean;
  unread?: boolean;
  error?: boolean;
}

interface RailProps {
  providerIds: string[]; // overflow providers in the rail
  position?: RailPosition; // default 'left'
  collapsedWidth?: number; // default 4
  expandedWidth?: number;  // default ~40
  getStateFor?: (providerId: string) => RailCardState;
  onCardClick?: (providerId: string) => void;
}

export const Rail: React.FC<RailProps> = ({
  providerIds,
  position = 'left',
  collapsedWidth = 4,
  expandedWidth = 40,
  getStateFor,
  onCardClick,
}) => {
  if (!providerIds || providerIds.length === 0) return null;

  const isLeft = position === 'left';
  const sideStyleKey = isLeft ? 'left' : 'right';

  return (
    <div
      aria-label="Overflow providers"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        [sideStyleKey]: 0,
        width: expandedWidth, // Fixed width to avoid layout jitter
        background: tokens.rail.bg,
        borderRight: isLeft ? `1px solid ${tokens.rail.border}` : undefined,
        borderLeft: !isLeft ? `1px solid ${tokens.rail.border}` : undefined,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      } as React.CSSProperties}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          padding: 6,
        }}
      >
        {providerIds.map((pid) => {
          const p = getProviderById(pid);
          if (!p) return null;
          const state = getStateFor?.(pid) || {};
          const Icon = p.icon;
          return (
            <button
              key={pid}
              title={p.name}
              aria-label={`Show ${p.name}`}
              onClick={() => onCardClick?.(pid)}
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: tokens.rail.cardBg,
                border: `1px solid ${tokens.rail.border}`,
                boxShadow: tokens.rail.cardShadow,
                cursor: 'pointer',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 150ms ease, transform 150ms ease',
                contentVisibility: 'auto' as any,
                contain: 'layout paint' as any,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = tokens.rail.cardBgHover;
                // Reduce hover transform to avoid extra repaints during streaming
                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-0.5px)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = tokens.rail.cardBg;
                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
              }}
            >
              {/* 16px icon */}
              {Icon ? (
                <Icon size={16} />
              ) : (
                <div style={{ width: 16, height: 16, borderRadius: 4, background: p.color }} />
              )}

              {/* 6px status dot */}
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  right: 2,
                  bottom: 2,
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: state.error
                    ? tokens.status.error
                    : state.streaming
                      ? tokens.status.streaming
                      : state.unread
                        ? tokens.status.unread
                        : 'transparent',
                  // Quiet offscreen streaming: remove pulse animation to reduce work
                  boxShadow: undefined,
                  animation: undefined,
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};