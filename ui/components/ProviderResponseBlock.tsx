// ProviderResponseBlock.tsx - COMPLETE FIXED VERSION
import React from 'react';
import { LLMProvider, AppStep, ProviderResponse } from '../types';
import { LLM_PROVIDERS_CONFIG } from '../constants';
import { BotIcon } from './Icons';
import { useState, useCallback, useMemo } from 'react';
import { ProviderPill } from './ProviderPill';
import { useAtomValue } from 'jotai';
import { providerContextsAtom } from '../state/atoms';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ProviderState {
  text: string;
  status: 'pending' | 'streaming' | 'completed' | 'error';
}

type ProviderStates = Record<string, ProviderState>;

interface ProviderResponseBlockProps {
  providerResponses?: Record<string, ProviderResponse>;
  providerStates?: ProviderStates;
  isLoading: boolean;
  currentAppStep: AppStep;
  isReducedMotion?: boolean;
  aiTurnId?: string;
  sessionId?: string;
  onEnterComposerMode?: () => void;
}

const CopyButton = ({ text, label }: { text: string; label: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy text:', error);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      aria-label={label}
      style={{
        background: '#334155',
        border: '1px solid #475569',
        borderRadius: '6px',
        padding: '4px 8px',
        color: '#94a3b8',
        fontSize: '12px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
      }}
    >
      {copied ? '✓' : '📋'} {copied ? 'Copied' : 'Copy'}
    </button>
  );
};

const ProviderResponseBlock = ({ 
  providerResponses,
  providerStates, 
  isLoading, 
  isReducedMotion = false,
  aiTurnId,
  sessionId,
  onEnterComposerMode
}: ProviderResponseBlockProps) => {
  const providerContexts = useAtomValue(providerContextsAtom);
  
  // Normalize responses
  const effectiveProviderResponses = providerResponses 
    ? { ...providerResponses }
    : Object.fromEntries(
      Object.entries(providerStates || {}).map(([id, s]) => [
        id,
        { text: s.text, status: s.status, meta: undefined },
      ])
    );

  const effectiveProviderStates = Object.entries(effectiveProviderResponses).reduce((acc, [providerId, response]) => {
    acc[providerId] = {
      text: (response as any).text || '',
      status: (response as any).status,
    };
    return acc;
  }, {} as ProviderStates);


  
  // Get all provider IDs in order (excluding 'system')
  const allProviderIds = useMemo(() => 
    LLM_PROVIDERS_CONFIG
      .map(p => p.id)
      .filter(id => Object.keys(effectiveProviderStates).includes(id) && id !== 'system'),
    [effectiveProviderStates]
  );

  // Visible slots state (shows 3 providers at a time)
  const [visibleSlots, setVisibleSlots] = useState<string[]>(() => 
    allProviderIds.slice(0, Math.min(3, allProviderIds.length))
  );

  // Calculate hidden providers (left and right)
  const hiddenProviders = useMemo(() => {
    const hidden = allProviderIds.filter(id => !visibleSlots.includes(id));
    return {
      left: hidden[0] || null,
      right: hidden[1] || null,
    };
  }, [allProviderIds, visibleSlots]);

  const getProviderConfig = (providerId: string): LLMProvider | undefined => {
    return LLM_PROVIDERS_CONFIG.find(p => p.id === providerId);
  };



  // Swap a hidden provider into the first visible slot
  const swapProviderIn = useCallback((hiddenProviderId: string) => {
    setVisibleSlots(prev => {
      const newSlots = [...prev];
      // Replace the first slot with the clicked provider
      newSlots[0] = hiddenProviderId;
      return newSlots;
    });
  }, []);





  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return '#f59e0b';
      case 'streaming': return '#f59e0b';
      case 'completed': return '#10b981';
      case 'error': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return 'Waiting...';
      case 'streaming': return 'Generating...';
      case 'completed': return 'Complete';
      case 'error': return 'Error';
      default: return 'Unknown';
    }
  };

  if (allProviderIds.length === 0) {
    return null;
  }

  const renderProviderCard = (providerId: string, isVisible: boolean) => {
    const state = effectiveProviderStates[providerId];
    const provider = getProviderConfig(providerId);
    const context = providerContexts[providerId];
    const isStreaming = state?.status === 'streaming';
    const isError = state?.status === 'error';

    const displayText = isError 
      ? (context?.errorMessage || state?.text || 'Provider error') 
      : (state?.text || getStatusText(state?.status));

    return (
      <div 
        key={providerId}
        style={{
          flex: '1 1 320px',
          minWidth: '260px',
          maxWidth: '380px',
          width: '100%',
          height: '220px',
          display: isVisible ? 'flex' : 'none',
          flexDirection: 'column',
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '12px',
          padding: '12px',
          flexShrink: 0,
          overflow: 'hidden',
        }}
        aria-live="polite"
      >
        {/* Fixed Header */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px', 
          marginBottom: '12px',
          flexShrink: 0,
          height: '24px'
        }}>
          {provider && (
            <div className={`model-logo ${provider.logoBgClass}`} style={{ width: '16px', height: '16px', borderRadius: '3px' }} />
          )}
          <div style={{ fontWeight: 500, fontSize: '12px', color: '#94a3b8' }}>
            {provider?.name || providerId}
          </div>
          {context && (
            <div style={{ fontSize: '10px', color: '#64748b', marginLeft: '4px' }}>
              {context.rateLimitRemaining && `(${context.rateLimitRemaining} left)`}
              {context.modelName && ` • ${context.modelName}`}
            </div>
          )}
          <div style={{ 
            marginLeft: 'auto', 
            width: '8px', 
            height: '8px', 
            borderRadius: '50%', 
            background: getStatusColor(state?.status),
            ...(isStreaming && !isReducedMotion && { animation: 'pulse 1.5s ease-in-out infinite' })
          }} />
        </div>

        {/* Scrollable Content Area */}
        <div
          className="provider-card-scroll"
          onWheelCapture={(e: React.WheelEvent<HTMLDivElement>) => {
            const el = e.currentTarget;
            const dy = e.deltaY ?? 0;
            const canDown = el.scrollTop + el.clientHeight < el.scrollHeight;
            const canUp = el.scrollTop > 0;
            if ((dy > 0 && canDown) || (dy < 0 && canUp)) {
              // keep wheel within the card when it can scroll
              e.stopPropagation();
            }
          }}
          onWheel={(e: React.WheelEvent<HTMLDivElement>) => {
            const el = e.currentTarget;
            const dy = e.deltaY ?? 0;
            const canDown = el.scrollTop + el.clientHeight < el.scrollHeight;
            const canUp = el.scrollTop > 0;
            if ((dy > 0 && canDown) || (dy < 0 && canUp)) {
              e.stopPropagation();
            }
          }}
          onTouchStartCapture={(e: React.TouchEvent<HTMLDivElement>) => {
            // hint to keep gesture inside this element
            e.stopPropagation();
          }}
          onTouchMove={(e: React.TouchEvent<HTMLDivElement>) => {
            const el = e.currentTarget;
            const canDown = el.scrollTop + el.clientHeight < el.scrollHeight;
            const canUp = el.scrollTop > 0;
            if (canDown || canUp) {
              e.stopPropagation();
            }
          }}
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '12px',
            background: 'rgba(0, 0, 0, 0.18)',
            borderRadius: '8px',
            minHeight: 0,
            overscrollBehavior: 'contain'
          }}
        >
          <div className="prose prose-sm max-w-none dark:prose-invert" style={{ 
            fontSize: '13px', 
            lineHeight: '1.5', 
            color: '#e2e8f0' 
          }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {String(displayText || '')}
            </ReactMarkdown>
            {isStreaming && <span className="streaming-dots" />}
          </div>
        </div>

        {/* Fixed Footer with actions */}
        <div style={{ 
          marginTop: '12px',
          display: 'flex', 
          justifyContent: 'flex-end', 
          gap: '8px',
          flexShrink: 0,
          height: '32px'
        }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              try {
                onEnterComposerMode?.();
                const provenance = {
                  providerId,
                  aiTurnId: aiTurnId,
                  sessionId: sessionId,
                  granularity: 'full',
                  sourceText: state?.text || '',
                  responseType: 'batch',
                  timestamp: Date.now()
                } as any;
                setTimeout(() => {
                  document.dispatchEvent(new CustomEvent('extract-to-canvas', { detail: { text: state?.text || '', provenance }, bubbles: true }));
                }, 50);
              } catch (err) { console.error('Copy to canvas failed', err); }
            }}
            aria-label={`Send ${provider?.name || providerId} to Canvas`}
            style={{
              background: '#1d4ed8',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '4px 8px',
              color: '#ffffff',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            ↘ Canvas
          </button>
          <CopyButton text={state?.text} label={`Copy ${provider?.name || providerId}`} />
          <ProviderPill id={providerId as any} />
        </div>
      </div>
    );
  };

  // Render side indicator button (mimics ClipsCarousel style)
  const renderSideIndicator = (providerId: string) => {
    const state = effectiveProviderStates[providerId];
    const provider = getProviderConfig(providerId);
    const isStreaming = state?.status === 'streaming';
    const isCompleted = state?.status === 'completed';
    
    // State indicator similar to ClipsCarousel
    const statusIcon = isStreaming ? '⏳' : isCompleted ? '◉' : '○';
    const borderColor = isCompleted ? (provider?.color || '#475569') : '#475569';
    const bgColor = isCompleted ? 'rgba(255,255,255,0.06)' : '#0f172a';

    return (
      <button
        key={providerId}
        onClick={() => swapProviderIn(providerId)}
        title={`Click to view ${provider?.name || providerId}`}
        disabled={isStreaming}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          padding: '12px 8px',
          minWidth: '80px',
          borderRadius: '12px',
          background: bgColor,
          border: `1px solid ${borderColor}`,
          cursor: isStreaming ? 'not-allowed' : 'pointer',
          flexShrink: 0,
          transition: isReducedMotion ? 'none' : 'all 0.2s ease',
          opacity: isStreaming ? 0.7 : 1,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
        }}
        onMouseEnter={(e) => {
          if (!isStreaming) {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isStreaming) {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.2)';
          }
        }}
      >
        {/* Provider Logo */}
        {provider && (
          <div 
            className={`model-logo ${provider.logoBgClass}`} 
            style={{ 
              width: '20px', 
              height: '20px', 
              borderRadius: '4px',
            }} 
          />
        )}
        
        {/* Status + Name */}
        <div style={{
          fontSize: '10px',
          fontWeight: 500,
          color: '#e2e8f0',
          textAlign: 'center',
          lineHeight: 1.2,
          display: 'flex',
          alignItems: 'center',
          gap: '3px'
        }}>
          <span style={{ fontSize: '12px' }}>{statusIcon}</span>
          <span>{provider?.name || providerId}</span>
        </div>

        {/* Streaming indicator dot */}
        {isStreaming && (
          <div style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: getStatusColor(state?.status),
            animation: isReducedMotion ? 'none' : 'pulse 1.5s ease-in-out infinite',
          }} />
        )}
      </button>
    );
  };

  return (
    <div className="response-container" style={{ marginBottom: '24px', display: 'flex' }}>
      <BotIcon style={{
          width: '32px', height: '32px', color: '#a78bfa', marginRight: '12px', flexShrink: 0, marginTop:'4px'
      }} />
      <div style={{flexGrow: 1}}>
        {/* Global Controls Header */}
        <div className="global-controls" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '12px',
          padding: '8px 12px',
          background: '#1e293b',
          borderRadius: '8px',
          border: '1px solid #334155'
        }}>
          <div style={{ fontSize: '14px', fontWeight: 500, color: '#94a3b8' }}>
            AI Responses ({allProviderIds.length})
          </div>
          <CopyButton 
              text={allProviderIds.map(id => {
                const state = effectiveProviderStates[id];
                const provider = getProviderConfig(id);
                return `${provider?.name || id}:\n${state.text}`;
              }).join('\n\n---\n\n')} 
              label="Copy all responses"
            />
        </div>

        {/* CAROUSEL LAYOUT: [Left Indicator] [3 Main Cards] [Right Indicator] */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}>
          {/* Left Side Indicator */}
          {hiddenProviders.left && (
            <div style={{ flexShrink: 0 }}>
              {renderSideIndicator(hiddenProviders.left)}
            </div>
          )}

          {/* Main Cards Container (3 slots) */}
          <div style={{
            display: 'flex',
            gap: '8px',
            flex: 1,
            justifyContent: 'flex-start',
            minWidth: 0,
            flexWrap: 'wrap',
            width: '100%',
          }}>
            {/* Render ALL providers, control visibility via display:none */}
            {allProviderIds.map(id => renderProviderCard(id, visibleSlots.includes(id)))}
          </div>

          {/* Right Side Indicator */}
          {hiddenProviders.right && (
            <div style={{ flexShrink: 0 }}>
              {renderSideIndicator(hiddenProviders.right)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default React.memo(ProviderResponseBlock);