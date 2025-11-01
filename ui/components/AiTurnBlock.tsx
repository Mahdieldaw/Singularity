// ui/components/AiTurnBlock.tsx - HYBRID COLLAPSIBLE SOLUTION
import React from 'react';
import { AiTurn, ProviderResponse, AppStep } from '../types';
import ProviderResponseBlock from './ProviderResponseBlock';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMemo, useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { hasComposableContent } from '../utils/composerUtils';
import { LLM_PROVIDERS_CONFIG } from '../constants';
import ClipsCarousel from './ClipsCarousel';
import { ChevronDownIcon, ChevronUpIcon } from './Icons';
import { normalizeResponseArray, getLatestResponse } from '../utils/turn-helpers';

function parseSynthesisResponse(response?: string | null) {
  if (!response) return { synthesis: '', options: null };

  const separator = '===ALL AVAILABLE OPTIONS===';

  if (response.includes(separator)) {
    const [mainSynthesis, optionsSection] = response.split(separator);
    return {
      synthesis: mainSynthesis.trim(),
      options: optionsSection.trim(),
    };
  }

  const optionsPatterns = [
    /\*\*All Available Options:\*\*/i,
    /## All Available Options/i,
    /All Available Options:/i,
  ];

  for (const pattern of optionsPatterns) {
    const match = response.match(pattern);
    if (match && typeof match.index === 'number') {
      const splitIndex = match.index;
      return {
        synthesis: response.substring(0, splitIndex).trim(),
        options: response.substring(splitIndex).trim(),
      };
    }
  }

  return {
    synthesis: response,
    options: null,
  };
}

/**
 * Cooperative height measurement hook - pauses during user interaction
 */
const useShorterHeight = (
  hasSynthesis: boolean,
  hasMapping: boolean,
  synthesisVersion: string | number
) => {
  const synthRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  const [shorterHeight, setShorterHeight] = useState<number | null>(null);
  const [shorterSection, setShorterSection] = useState<'synthesis' | 'mapping' | null>(null);
  
  const isUserActive = useRef(false);
  const userActiveTimer = useRef<number | null>(null);
  const rafId = useRef<number | null>(null);

  const measureOnce = useCallback(() => {
    const s = synthRef.current;
    const m = mapRef.current;
    
    if (!hasSynthesis || !hasMapping || !s || !m) {
      setShorterHeight(null);
      setShorterSection(null);
      return;
    }

    // Skip measurement during user interaction to avoid thrash
    if (isUserActive.current) return;

    const synthH = s.scrollHeight;
    const mapH = m.scrollHeight;

    const isSynthShorter = synthH <= mapH;
    const h = isSynthShorter ? synthH : mapH;
    const sec = isSynthShorter ? 'synthesis' : 'mapping';

    // Only update if changed by more than 2px to avoid micro-adjustments
    setShorterHeight(prev => (prev === null || Math.abs(prev - h) > 2) ? h : prev);
    setShorterSection(prev => prev !== sec ? sec : prev);
  }, [hasSynthesis, hasMapping]);

  const scheduleMeasure = useCallback(() => {
    if (rafId.current !== null) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      measureOnce();
    });
  }, [measureOnce]);

  useEffect(() => {
    const s = synthRef.current;
    const m = mapRef.current;
    if (!s || !m) return;

    const ro = new ResizeObserver(() => scheduleMeasure());
    ro.observe(s);
    ro.observe(m);

    const markUserActive = () => {
      isUserActive.current = true;
      if (userActiveTimer.current !== null) {
        window.clearTimeout(userActiveTimer.current);
      }
      userActiveTimer.current = window.setTimeout(() => {
        isUserActive.current = false;
        userActiveTimer.current = null;
        scheduleMeasure();
      }, 300);
    };

    // Listen for user interactions
    const events = ['wheel', 'touchstart', 'pointerdown'];
    events.forEach(evt => {
      s.addEventListener(evt, markUserActive, { passive: true });
      m.addEventListener(evt, markUserActive, { passive: true });
    });

    scheduleMeasure(); // initial

    return () => {
      ro.disconnect();
      if (rafId.current) cancelAnimationFrame(rafId.current);
      if (userActiveTimer.current) window.clearTimeout(userActiveTimer.current);
      events.forEach(evt => {
        s.removeEventListener(evt, markUserActive as EventListener);
        m.removeEventListener(evt, markUserActive as EventListener);
      });
    };
  }, [scheduleMeasure]);

  useLayoutEffect(() => {
    if (!hasSynthesis || !hasMapping) return;
    const id = requestAnimationFrame(measureOnce);
    return () => cancelAnimationFrame(id);
  }, [synthesisVersion, hasSynthesis, hasMapping, measureOnce]);

  return { synthRef, mapRef, shorterHeight, shorterSection };
};

interface AiTurnBlockProps {
  aiTurn: AiTurn;
  isLive?: boolean;
  isReducedMotion?: boolean;
  isLoading?: boolean;
  currentAppStep?: AppStep;
  showSourceOutputs?: boolean;
  onToggleSourceOutputs?: () => void;
  onEnterComposerMode?: (aiTurn: AiTurn) => void;
  activeSynthesisClipProviderId?: string;
  activeMappingClipProviderId?: string;
  onClipClick?: (type: 'synthesis' | 'mapping', providerId: string) => void;
}

const AiTurnBlock: React.FC<AiTurnBlockProps> = ({
  aiTurn,
  onToggleSourceOutputs,
  showSourceOutputs = false,
  onEnterComposerMode,
  isReducedMotion = false,
  isLoading = false,
  currentAppStep,
  activeSynthesisClipProviderId,
  activeMappingClipProviderId,
  onClipClick,
}) => {
  const [isSynthesisExpanded, setIsSynthesisExpanded] = useState(true);
  const [isMappingExpanded, setIsMappingExpanded] = useState(true);
  const [mappingTab, setMappingTab] = useState<'map' | 'options'>('map');
  
  // Track which section is manually expanded (if truncated)
  const [synthExpanded, setSynthExpanded] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);

  // ✅ CRITICAL: Move all hooks to top level (before any conditional logic)
  const handleEnterComposerMode = useCallback(() => {
    onEnterComposerMode?.(aiTurn);
  }, [onEnterComposerMode, aiTurn]);

  const synthesisResponses = useMemo(() => {
    if (!aiTurn.synthesisResponses) aiTurn.synthesisResponses = {};
    const out: Record<string, ProviderResponse[]> = {};
    LLM_PROVIDERS_CONFIG.forEach(p => (out[String(p.id)] = []));
    Object.entries(aiTurn.synthesisResponses).forEach(([pid, resp]) => {
      out[pid] = normalizeResponseArray(resp);
    });
    return out;
  }, [aiTurn.id, JSON.stringify(aiTurn.synthesisResponses)]);

  const mappingResponses = useMemo(() => {
    const map = aiTurn.mappingResponses || {};
    const out: Record<string, ProviderResponse[]> = {};
    LLM_PROVIDERS_CONFIG.forEach(p => (out[String(p.id)] = []));
    Object.entries(map).forEach(([pid, resp]) => {
      out[pid] = normalizeResponseArray(resp);
    });
    return out;
  }, [aiTurn.id, JSON.stringify(aiTurn.mappingResponses)]);

  const allSources = useMemo(() => {
    const sources: Record<string, ProviderResponse> = { ...(aiTurn.batchResponses || {}) };
    if (aiTurn.hiddenBatchOutputs) {
      Object.entries(aiTurn.hiddenBatchOutputs).forEach(([providerId, response]) => {
        if (!sources[providerId]) {
          const typedResponse = response as ProviderResponse;
          sources[providerId] = {
            providerId,
            text: typedResponse.text || '',
            status: 'completed' as const,
            createdAt: typedResponse.createdAt || Date.now(),
            updatedAt: typedResponse.updatedAt || Date.now(),
          } as ProviderResponse;
        }
      });
    }
    return sources;
  }, [aiTurn.batchResponses, aiTurn.hiddenBatchOutputs]);

  const hasSources = Object.keys(allSources).length > 0;

  const providerIds = useMemo(() => LLM_PROVIDERS_CONFIG.map(p => String(p.id)), []);

  const computeActiveProvider = useCallback((
    explicit: string | undefined,
    map: Record<string, ProviderResponse[]>
  ): string | undefined => {
    if (explicit) return explicit;
    for (const pid of providerIds) {
      const arr = map[pid];
      if (arr && arr.length > 0) return pid;
    }
    return undefined;
  }, [providerIds]);

  const activeSynthPid = computeActiveProvider(activeSynthesisClipProviderId, synthesisResponses);
  const activeMappingPid = computeActiveProvider(activeMappingClipProviderId, mappingResponses);

  const getSynthesisAndOptions = useCallback((take: ProviderResponse | undefined) => {
    if (!take?.text) return { synthesis: '', options: null };
    return parseSynthesisResponse(String(take.text));
  }, []);

  const getOptions = useCallback((): string | null => {
    if (!activeSynthPid) return null;
    const take = getLatestResponse(synthesisResponses[activeSynthPid]);
    const { options } = getSynthesisAndOptions(take);
    return options;
  }, [activeSynthPid, synthesisResponses, getSynthesisAndOptions]);

  const displayedSynthesisTake = useMemo(() => {
    if (!activeSynthPid) return undefined;
    return getLatestResponse(synthesisResponses[activeSynthPid]);
  }, [activeSynthPid, synthesisResponses]);

  const displayedSynthesisText = useMemo(() => {
    if (!displayedSynthesisTake?.text) return '';
    return String(getSynthesisAndOptions(displayedSynthesisTake).synthesis ?? '');
  }, [displayedSynthesisTake, getSynthesisAndOptions]);

  const hasSynthesis = !!(activeSynthPid && displayedSynthesisTake?.text);
  const hasMapping = !!(activeMappingPid && getLatestResponse(mappingResponses[activeMappingPid])?.text);

  const { synthRef, mapRef, shorterHeight, shorterSection } = useShorterHeight(hasSynthesis, hasMapping, displayedSynthesisText);

  // Determine if sections are truncated
  const synthTruncated = hasSynthesis && hasMapping && shorterHeight && shorterSection === 'mapping';
  const mapTruncated = hasSynthesis && hasMapping && shorterHeight && shorterSection === 'synthesis';

  const getSectionStyle = (section: 'synthesis' | 'mapping', isExpanded: boolean): React.CSSProperties => {
    const isTruncated = section === 'synthesis' ? synthTruncated : mapTruncated;
    
    return {
      border: '1px solid #475569',
      borderRadius: 8,
      padding: 12,
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 150,
      height: 'auto',
      boxSizing: 'border-box',
      maxHeight: (isTruncated && !isExpanded) ? `${shorterHeight}px` : 'none',
      overflow: 'visible',
      position: 'relative'
    };
  };

  const userPrompt: string | null = ((): string | null => {
    const maybe = (aiTurn as any);
    return maybe?.userPrompt ?? maybe?.prompt ?? maybe?.input ?? null;
  })();

  return (
    <div className="turn-block" style={{ paddingBottom: '1rem', borderBottom: '1px solid #334155' }}>
      {userPrompt && (
        <div className="user-prompt-block" style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>User</div>
          <div style={{ background: '#0b1220', border: '1px solid #334155', borderRadius: 8, padding: 8, color: '#cbd5e1' }}>
            {userPrompt}
          </div>
        </div>
      )}

      <div className="ai-turn-block" style={{ border: '1px solid #334155', borderRadius: 12, padding: 12 }}>
        <div className="ai-turn-content" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="primaries" style={{ marginBottom: '1rem', position: 'relative' }}>
            <div style={{ display: 'flex', flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>

              {/* Synthesis Section */}
              <div 
                ref={synthRef}
                className="synthesis-section" 
                style={getSectionStyle('synthesis', synthExpanded)}
              >
                <div className="section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexShrink: 0 }}>
                  <h4 style={{ margin: 0, fontSize: 14, color: '#e2e8f0' }}>Synthesis</h4>
                  <button onClick={() => setIsSynthesisExpanded(p => !p)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}>
                    {isSynthesisExpanded ? <ChevronUpIcon style={{width: 16, height: 16}} /> : <ChevronDownIcon style={{width: 16, height: 16}} />}
                  </button>
                </div>
                
                {!hasSynthesis && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b', fontStyle: 'italic' }}>
                    No synthesis available
                  </div>
                )}
                
                {isSynthesisExpanded && hasSynthesis && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: synthTruncated && !synthExpanded ? 'hidden' : 'visible' }}>
                    <div style={{ flexShrink: 0 }}>
                      <ClipsCarousel
                        providers={LLM_PROVIDERS_CONFIG}
                        responsesMap={synthesisResponses}
                        activeProviderId={activeSynthPid}
                        onClipClick={(pid) => onClipClick?.('synthesis', pid)}
                      />
                    </div>

                    <div 
                      className="clip-content" 
                      style={{ 
                        marginTop: 12, 
                        background: '#0f172a', 
                        border: '1px solid #334155', 
                        borderRadius: 8, 
                        padding: 12,
                        flex: 1,
                        overflowY: 'visible'
                      }}
                    >
                      {activeSynthPid ? (
                        (() => {
                          const take = displayedSynthesisTake;
                          if (!take) return <div style={{ color: '#64748b' }}>No synthesis yet for this model.</div>;

                          const handleCopy = async (e: React.MouseEvent) => {
                            e.stopPropagation();
                            try { await navigator.clipboard.writeText(displayedSynthesisText); } catch (err) { console.error('Copy failed', err); }
                          };

                          return (
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                                <div style={{ fontSize: 12, color: '#94a3b8' }}>{activeSynthPid} · {take.status}</div>
                                <button onClick={handleCopy} style={{ background: '#334155', border: '1px solid #475569', borderRadius: 6, padding: '4px 8px', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>📋 Copy</button>
                              </div>
                              <div className="prose prose-sm max-w-none dark:prose-invert" style={{ lineHeight: 1.7, fontSize: 16 }}>
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {displayedSynthesisText}
                                </ReactMarkdown>
                              </div>
                            </div>
                          );
                        })()
                      ) : (
                        <div style={{ color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontStyle: 'italic' }}>Choose a model to synthesize.</div>
                      )}
                    </div>

                    {/* Expand button for truncated content */}
                    {synthTruncated && !synthExpanded && (
                      <>
                        <div style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          height: 60,
                          background: 'linear-gradient(transparent, #1e293b)',
                          pointerEvents: 'none',
                          borderRadius: '0 0 8px 8px'
                        }} />
                        <button
                          onClick={() => setSynthExpanded(true)}
                          style={{
                            position: 'absolute',
                            bottom: 12,
                            left: '50%',
                            transform: 'translateX(-50%)',
                            padding: '6px 12px',
                            background: '#334155',
                            border: '1px solid #475569',
                            borderRadius: 6,
                            color: '#e2e8f0',
                            cursor: 'pointer',
                            fontSize: 12,
                            zIndex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4
                          }}
                        >
                          Show full response <ChevronDownIcon style={{ width: 14, height: 14 }} />
                        </button>
                      </>
                    )}
                    
                    {synthExpanded && synthTruncated && (
                      <button
                        onClick={() => setSynthExpanded(false)}
                        style={{
                          marginTop: 12,
                          padding: '6px 12px',
                          background: '#334155',
                          border: '1px solid #475569',
                          borderRadius: 6,
                          color: '#94a3b8',
                          cursor: 'pointer',
                          fontSize: 12,
                          alignSelf: 'center',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                      >
                        <ChevronUpIcon style={{ width: 14, height: 14 }} /> Collapse
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Mapping Section */}
              <div 
                ref={mapRef}
                className="mapping-section" 
                style={getSectionStyle('mapping', mapExpanded)}
              >
                <div className="section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexShrink: 0 }}>
                  <h4 style={{ margin: 0, fontSize: 14, color: '#e2e8f0' }}>Mapping</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button 
                      onClick={() => setMappingTab('map')}
                      title="Conflict Map"
                      style={{ 
                        padding: 4,
                        background: mappingTab === 'map' ? '#334155' : 'transparent',
                        border: 'none',
                        borderRadius: 4,
                        color: mappingTab === 'map' ? '#e2e8f0' : '#64748b',
                        cursor: 'pointer'
                      }}
                    >
                      🗺️
                    </button>
                    <button 
                      onClick={() => setMappingTab('options')}
                      title="All Options"
                      style={{ 
                        padding: 4,
                        background: mappingTab === 'options' ? '#334155' : 'transparent',
                        border: 'none',
                        borderRadius: 4,
                        color: mappingTab === 'options' ? '#e2e8f0' : '#64748b',
                        cursor: 'pointer'
                      }}
                    >
                      📋
                    </button>
                    <div style={{ width: 1, height: 16, background: '#475569', margin: '0 4px' }} />
                    <button onClick={() => setIsMappingExpanded(p => !p)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}>
                      {isMappingExpanded ? <ChevronUpIcon style={{width: 16, height: 16}} /> : <ChevronDownIcon style={{width: 16, height: 16}} />}
                    </button>
                  </div>
                </div>
                
                {!hasMapping && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b', fontStyle: 'italic' }}>
                    No mapping available
                  </div>
                )}
                
                {isMappingExpanded && hasMapping && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: mapTruncated && !mapExpanded ? 'hidden' : 'visible', minHeight: 0 }}>
                    {mappingTab === 'map' && (
                      <ClipsCarousel
                        providers={LLM_PROVIDERS_CONFIG}
                        responsesMap={mappingResponses}
                        activeProviderId={activeMappingPid}
                        onClipClick={(pid) => onClipClick?.('mapping', pid)}
                      />
                    )}
                    
                    <div 
                      className="clip-content" 
                      style={{ 
                        marginTop: 12, 
                        background: '#0f172a', 
                        border: '1px solid #334155', 
                        borderRadius: 8, 
                        padding: 12,
                        flex: 1,
                        overflowY: 'visible'
                      }}
                    >
                      {mappingTab === 'options' ? (
                        (() => {
                          const options = getOptions();
                          if (!options) return (
                            <div style={{ color: '#64748b' }}>
                              {!activeSynthPid 
                                ? 'Select a synthesis provider to see options.' 
                                : 'No options found. Run synthesis first.'}
                            </div>
                          );
                          return (
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                                  All Available Options • via {activeSynthPid}
                                </div>
                              </div>
                              <div className="prose prose-sm max-w-none dark:prose-invert" style={{ lineHeight: 1.7, fontSize: 14 }}>
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {String(options ?? '')}
                                </ReactMarkdown>
                              </div>
                            </div>
                          );
                        })()
                      ) : activeMappingPid ? (
                        (() => {
                          const take = getLatestResponse(mappingResponses[activeMappingPid]);
                          if (!take) return <div style={{ color: '#64748b' }}>No mapping yet for this model.</div>;
                          const handleCopy = async (e: React.MouseEvent) => {
                            e.stopPropagation();
                            try { await navigator.clipboard.writeText(String(take.text || '')); } catch (err) { console.error('Copy failed', err); }
                          };
                          return (
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                                <div style={{ fontSize: 12, color: '#94a3b8' }}>{activeMappingPid} · {take.status}</div>
                                <button onClick={handleCopy} style={{ background: '#334155', border: '1px solid #475569', borderRadius: 6, padding: '4px 8px', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>📋 Copy</button>
                              </div>
                              <div className="prose prose-sm max-w-none dark:prose-invert" style={{ lineHeight: 1.7, fontSize: 16 }}>
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {String(take.text || '')}
                                </ReactMarkdown>
                              </div>
                            </div>
                          );
                        })()
                      ) : (
                        <div style={{ color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontStyle: 'italic' }}>Choose a model to map.</div>
                      )}
                    </div>

                    {/* Expand button for truncated content */}
                    {mapTruncated && !mapExpanded && (
                      <>
                        <div style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          height: 60,
                          background: 'linear-gradient(transparent, #1e293b)',
                          pointerEvents: 'none',
                          borderRadius: '0 0 8px 8px'
                        }} />
                        <button
                          onClick={() => setMapExpanded(true)}
                          style={{
                            position: 'absolute',
                            bottom: 12,
                            left: '50%',
                            transform: 'translateX(-50%)',
                            padding: '6px 12px',
                            background: '#334155',
                            border: '1px solid #475569',
                            borderRadius: 6,
                            color: '#e2e8f0',
                            cursor: 'pointer',
                            fontSize: 12,
                            zIndex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4
                          }}
                        >
                          Show full response <ChevronDownIcon style={{ width: 14, height: 14 }} />
                        </button>
                      </>
                    )}
                    
                    {mapExpanded && mapTruncated && (
                      <button
                        onClick={() => setMapExpanded(false)}
                        style={{
                          marginTop: 12,
                          padding: '6px 12px',
                          background: '#334155',
                          border: '1px solid #475569',
                          borderRadius: 6,
                          color: '#94a3b8',
                          cursor: 'pointer',
                          fontSize: 12,
                          alignSelf: 'center',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                      >
                        <ChevronUpIcon style={{ width: 14, height: 14 }} /> Collapse
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {hasSources && (
            <div 
              className="batch-filler" 
              style={{ 
                border: '1px solid #475569', 
                borderRadius: 8, 
                padding: 12 
              }}
            >
              <div className="sources-wrapper">
                <div className="sources-toggle" style={{ textAlign: 'center', marginBottom: 8 }}>
                  <button
                    onClick={() => onToggleSourceOutputs?.()}
                    style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #334155', background: '#0b1220', color: '#e2e8f0', cursor: 'pointer' }}
                  >
                    {showSourceOutputs ? 'Hide Sources' : 'Show Sources'}
                  </button>
                </div>
                {showSourceOutputs && (
                  <div className="sources-content">
                    <ProviderResponseBlock
                      providerResponses={allSources}
                      isLoading={isLoading}
                      currentAppStep={currentAppStep as AppStep}
                      isReducedMotion={isReducedMotion}
                      aiTurnId={aiTurn.id}
                      sessionId={aiTurn.sessionId ?? undefined}
                      onEnterComposerMode={handleEnterComposerMode}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {hasComposableContent(aiTurn) && (
            <div className="composer-entry" style={{ textAlign: 'center' }}>
              <button
                onClick={handleEnterComposerMode}
                style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #334155', background: '#1d4ed8', color: '#fff', cursor: 'pointer' }}
              >
                Open in Composer
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default React.memo(AiTurnBlock);