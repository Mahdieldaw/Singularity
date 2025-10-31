// ui/components/AiTurnBlock.tsx - SAFE RESPONSE RENDERING
import { AiTurn, ProviderResponse, AppStep } from '../types';
import ProviderResponseBlock from './ProviderResponseBlock';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
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

// In AiTurnBlock.tsx - Smart height calculation that handles failures
const useEqualHeightSections = (hasSynthesis: boolean, hasMapping: boolean) => {
  const [containerHeight, setContainerHeight] = useState<number | null>(null);
  const synthRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const shorterSectionRef = useRef<'synthesis' | 'mapping' | null>(null);

  useEffect(() => {
    const updateHeights = () => {
      if (!hasSynthesis || !hasMapping || !synthRef.current || !mapRef.current) {
        setContainerHeight(null);
        shorterSectionRef.current = null;
        return;
      }
      
      const synthHeight = synthRef.current.scrollHeight;
      const mapHeight = mapRef.current.scrollHeight;
      
      const newShorterSection = synthHeight <= mapHeight ? 'synthesis' : 'mapping';
      const shorterHeight = Math.min(synthHeight, mapHeight);
      
      if (shorterSectionRef.current === null || newShorterSection !== shorterSectionRef.current) {
        const maxAllowedHeight = Math.min(window.innerHeight * 0.6, 500);
        const finalHeight = Math.min(shorterHeight, maxAllowedHeight);
        setContainerHeight(finalHeight);
        shorterSectionRef.current = newShorterSection;
      }
    };

    updateHeights();
    
    const resizeObserver = new ResizeObserver(updateHeights);
    if (synthRef.current) resizeObserver.observe(synthRef.current);
    if (mapRef.current) resizeObserver.observe(mapRef.current);

    return () => resizeObserver.disconnect();
  }, [hasSynthesis, hasMapping]);

  return { containerHeight, synthRef, mapRef };
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

  /**
   * ✅ CRITICAL FIX: Safely normalize responses to arrays
   */
  const synthesisResponses = useMemo(() => {
  if (!aiTurn.synthesisResponses) aiTurn.synthesisResponses = {};
  
  const out: Record<string, ProviderResponse[]> = {};
  
  // ✅ CRITICAL: Initialize ALL providers first
  LLM_PROVIDERS_CONFIG.forEach(p => {
    out[String(p.id)] = [];
  });
  
  // ✅ Then overlay actual data
  Object.entries(aiTurn.synthesisResponses).forEach(([pid, resp]) => {
    out[pid] = normalizeResponseArray(resp);
  });
  
  return out;
}, [aiTurn.id, JSON.stringify(aiTurn.synthesisResponses)]);

  const mappingResponses = useMemo(() => {
  const map = aiTurn.mappingResponses || {};
  const out: Record<string, ProviderResponse[]> = {};
  
  // ✅ Initialize complete domain
  LLM_PROVIDERS_CONFIG.forEach(p => {
    out[String(p.id)] = [];
  });
  
  // ✅ Overlay data
  Object.entries(map).forEach(([pid, resp]) => {
    out[pid] = normalizeResponseArray(resp);
  });
  
  return out;
}, [aiTurn.id, JSON.stringify(aiTurn.mappingResponses)]);


  // Prepare source content (batch + hidden)
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

  const computeActiveProvider = (
    explicit: string | undefined,
    map: Record<string, ProviderResponse[]>
  ): string | undefined => {
    if (explicit) return explicit;
    for (const pid of providerIds) {
      const arr = map[pid];
      if (arr && arr.length > 0) return pid;
    }
    return undefined;
  };

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

  // ✅ Determine if we have valid content in each section
  const hasSynthesis = !!(activeSynthPid && displayedSynthesisTake?.text);
  const hasMapping = !!(activeMappingPid && getLatestResponse(mappingResponses[activeMappingPid])?.text);
  
  const { containerHeight, synthRef, mapRef } = useEqualHeightSections(hasSynthesis, hasMapping);

  // Adjust container styles based on content availability
  // Replace the getSectionStyle function with this:
const getSectionStyle = (hasContent: boolean): React.CSSProperties => ({
  border: '1px solid #475569', 
  borderRadius: 8, 
  padding: 12, 
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  // ✅ Handle null case properly
  height: (hasSynthesis && hasMapping && containerHeight) ? containerHeight : 'auto',
  overflowY: (hasSynthesis && hasMapping) ? 'auto' : 'visible',
  minHeight: '150px'
});

  // Safely resolve a user prompt string from possible shapes without relying on AiTurn type
  const userPrompt: string | null = ((): string | null => {
    const maybe = (aiTurn as any);
    return maybe?.userPrompt ?? maybe?.prompt ?? maybe?.input ?? null;
  })();

  return (
    // Bounded turn unit: Virtuoso will treat this entire block as a single item.
    <div className="turn-block" style={{ paddingBottom: '1rem', borderBottom: '1px solid #334155' }}>
      {/* Optional: show the user prompt at the top of the turn */}
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
          {/* Primaries: smart height based on content availability */}
          <div className="primaries" style={{ marginBottom: '1rem', position: 'relative' }}>
            <div style={{ display: 'flex', flexDirection: 'row', gap: 12, alignItems: 'stretch' }}>
              
              {/* Synthesis Section */}
              <div 
                ref={synthRef}
                className="synthesis-section" 
                style={getSectionStyle(hasSynthesis)}
              >
                <div className="section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexShrink: 0 }}>
                  <h4 style={{ margin: 0, fontSize: 14, color: '#e2e8f0' }}>Synthesis</h4>
                  <button onClick={() => setIsSynthesisExpanded(p => !p)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}>
                    {isSynthesisExpanded ? <ChevronUpIcon style={{width: 16, height: 16}} /> : <ChevronDownIcon style={{width: 16, height: 16}} />}
                  </button>
                </div>
                {isSynthesisExpanded && (
  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
    <div style={{ flexShrink: 0 }}> {/* Wrap ClipsCarousel */}
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
        overflowY: 'auto'
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
                  </div>
                )}
              </div>

              {/* Mapping Section */}
              <div 
                ref={mapRef}
                className="mapping-section" 
                style={getSectionStyle(hasMapping)}
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
                {isMappingExpanded && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
                        overflowY: 'auto' // Content area scrolls if needed
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
                  </div>
                )}
                 {!hasMapping && (
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    height: '100%',
                    color: '#64748b',
                    fontStyle: 'italic'
                  }}>
                    No mapping available
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Batch - bounded and scrollable so it doesn't push primaries off-screen */}
         
{hasSources && (
  <div 
    className="batch-filler" 
    style={{ 
      // ✅ REMOVED: maxHeight and overflowY - let it flow naturally
      paddingRight: 6,
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
            onEnterComposerMode={() => onEnterComposerMode?.(aiTurn)}
          />
        </div>
      )}
    </div>
  </div>
)}

          {/* Composer Mode Entry Button */}
          {hasComposableContent(aiTurn) && (
            <div className="composer-entry" style={{ textAlign: 'center' }}>
              <button
                onClick={() => onEnterComposerMode?.(aiTurn)}
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

export default AiTurnBlock;