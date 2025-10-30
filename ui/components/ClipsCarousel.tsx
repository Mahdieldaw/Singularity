import React from 'react';
import { LLMProvider, ProviderResponse } from '../types';

interface ClipsCarouselProps {
  providers: LLMProvider[];
  responsesMap: Record<string, ProviderResponse[]>;
  activeProviderId?: string;
  onClipClick: (providerId: string) => void;
}

const ClipsCarousel: React.FC<ClipsCarouselProps> = ({ providers, responsesMap, activeProviderId, onClipClick }) => {
  const getProviderState = (providerId: string): 'inactive' | 'available' | 'loading' => {
    const responses = responsesMap[providerId] || [];
    if (!responses || responses.length === 0) return 'inactive';
    const last = responses[responses.length - 1];
    if (last.status === 'pending' || last.status === 'streaming') return 'loading';
    return 'available';
  };

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {providers.map((p) => {
        const state = getProviderState(String(p.id));
        const isSelected = activeProviderId === p.id;
        const isDisabled = state === 'loading';
        const baseBg = state === 'inactive' ? '#0f172a' : 'rgba(255,255,255,0.06)';
        const borderColor = isSelected ? p.color : '#475569';
        const textColor = state === 'inactive' ? '#94a3b8' : '#e2e8f0';
        const cursor = isDisabled ? 'not-allowed' as const : 'pointer' as const;

        return (
          <button
            key={String(p.id)}
            onClick={() => !isDisabled && onClipClick(String(p.id))}
            disabled={isDisabled}
            title={state === 'inactive' ? `Run ${p.name}` : state === 'loading' ? `${p.name} (running...)` : `View ${p.name}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
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
            {state === 'loading' ? '⏳' : state === 'inactive' ? '○' : isSelected ? '●' : '◉'} {p.name}
          </button>
        );
      })}
    </div>
  );
};

export default ClipsCarousel;
