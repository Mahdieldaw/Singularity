import { useState, useRef, useEffect } from 'react';
import { LLMProvider } from '../types';
import { LLM_PROVIDERS_CONFIG } from '../constants';

interface CompactModelTrayProps {
  selectedModels: Record<string, boolean>;
  onToggleModel: (providerId: string) => void;
  isLoading?: boolean;
  thinkOnChatGPT?: boolean;
  onToggleThinkChatGPT?: () => void;
  synthesisProvider?: string | null;
  onSetSynthesisProvider?: (providerId: string | null) => void;
  mappingEnabled?: boolean;
  onToggleMapping?: (enabled: boolean) => void;
  mappingProvider?: string | null;
  onSetMappingProvider?: (providerId: string | null) => void;
  powerUserMode?: boolean;
  synthesisProviders?: string[];
  onToggleSynthesisProvider?: (providerId: string) => void;
  isFirstLoad?: boolean;
  onAcknowledgeFirstLoad?: () => void;
  chatInputHeight?: number;
  refineModel: string;
  onSetRefineModel: (model: string) => void;
}

const CompactModelTray = ({ 
  selectedModels, 
  onToggleModel, 
  isLoading = false, 
  thinkOnChatGPT = false, 
  onToggleThinkChatGPT, 
  synthesisProvider, 
  onSetSynthesisProvider,
  mappingEnabled = false,
  onToggleMapping,
  mappingProvider,
  onSetMappingProvider,
  powerUserMode = false,
  synthesisProviders = [],
  onToggleSynthesisProvider,
  isFirstLoad = false,
  onAcknowledgeFirstLoad,
  chatInputHeight = 80,
  refineModel,
  onSetRefineModel,
}: CompactModelTrayProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showModelsDropdown, setShowModelsDropdown] = useState(false);
  const [showMapDropdown, setShowMapDropdown] = useState(false);
  const [showUnifyDropdown, setShowUnifyDropdown] = useState(false);
  const [showRefineDropdown, setShowRefineDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const activeCount = Object.values(selectedModels).filter(Boolean).length;
  const selectedProviderIds = Object.keys(selectedModels).filter(id => selectedModels[id]);
  const selectedProviders = LLM_PROVIDERS_CONFIG.filter(provider => selectedProviderIds.includes(provider.id));
  const canRefine = activeCount >= 2;
  const mapProviderId = mappingProvider || '';
  const unifyProviderId = synthesisProvider || '';
  const isMapEnabled = mappingEnabled && !!mapProviderId;
  const isUnifyEnabled = !!unifyProviderId;

  useEffect(() => {
    try {
      const activeCount = Object.values(selectedModels || {}).filter(Boolean).length;
      if (activeCount === 0 && typeof onToggleModel === 'function') {
        const keys = ['htos_selected_models', 'htos_last_selected_models', 'htos_last_used_selected_models'];
        for (const k of keys) {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          let parsed: any = null;
          try { parsed = JSON.parse(raw); } catch (_) { continue; }
          if (parsed && typeof parsed === 'object') {
            LLM_PROVIDERS_CONFIG.forEach(p => {
              const shouldBeSelected = !!parsed[p.id];
              const currentlySelected = !!selectedModels[p.id];
              if (shouldBeSelected && !currentlySelected) onToggleModel(p.id);
              else if (!shouldBeSelected && currentlySelected) onToggleModel(p.id);
            });
            break;
          }
        }
      }

      if (!mappingProvider && typeof onSetMappingProvider === 'function') {
        const keys = ['htos_mapping_provider', 'htos_last_turn_mapping_provider', 'htos_last_used_mapping_provider'];
        for (const k of keys) {
          const val = localStorage.getItem(k);
          if (val) {
            onSetMappingProvider(val);
            try { onToggleMapping?.(true); } catch (_) {}
            break;
          }
        }
      }

      if (!synthesisProvider && typeof onSetSynthesisProvider === 'function') {
        const keys = ['htos_synthesis_provider', 'htos_last_turn_synthesis_provider', 'htos_last_used_synthesis_provider'];
        for (const k of keys) {
          const val = localStorage.getItem(k);
          if (val) {
            onSetSynthesisProvider(val);
            break;
          }
        }
      }
    } catch (err) {
      console.warn('[CompactModelTray] failed to restore last-used providers/selection', err);
    }
  }, []);

  useEffect(() => {
    try {
      const savedRefineModel = localStorage.getItem('htos_refine_model');
      if (savedRefineModel) {
        onSetRefineModel(savedRefineModel);
      }
    } catch (err) {
      console.warn('[CompactModelTray] failed to restore refine model', err);
    }
  }, []);

  const getWitnessLabel = () => {
    if (activeCount === 0) return '[No Models]';
    if (activeCount === LLM_PROVIDERS_CONFIG.length) return '[All Models]';
    if (activeCount === 1) return `[${selectedProviders[0]?.name}]`;
    return `[${activeCount} Models]`;
  };
  
  const getProviderName = (id: string | null | undefined) => {
    if (!id) return '';
    const match = LLM_PROVIDERS_CONFIG.find(p => p.id === id);
    return match?.name || id;
  };

  const getMapLabel = () => {
    if (!isMapEnabled) return '[Map]';
    const name = getProviderName(mapProviderId);
    const inactive = activeCount < 2;
    const hint = inactive ? ' • inactive' : '';
    return `[Map: ${name || 'None'}${hint}]`;
  };

  const getUnifyLabel = () => {
    if (!isUnifyEnabled) return '[Unify]';
    const name = getProviderName(unifyProviderId);
    const inactive = activeCount < 2;
    const hint = inactive ? ' • inactive' : '';
    return `[Unify: ${name || 'None'}${hint}]`;
  };

  const getRefineLabel = () => {
    const name = getProviderName(refineModel);
    return `[Refine: ${name || 'Auto'}]`;
  };
  
  useEffect(() => {
    const shouldListen = isExpanded || showModelsDropdown || showMapDropdown || showUnifyDropdown || showRefineDropdown;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
        setShowModelsDropdown(false);
        setShowMapDropdown(false);
        setShowUnifyDropdown(false);
        setShowRefineDropdown(false);
      }
    };
    if (shouldListen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isExpanded, showModelsDropdown, showMapDropdown, showUnifyDropdown, showRefineDropdown]);

  useEffect(() => {
    if (isFirstLoad) {
      onAcknowledgeFirstLoad?.();
    }
  }, [isFirstLoad, onAcknowledgeFirstLoad]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        bottom: `${chatInputHeight + 24}px`,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(800px, calc(100% - 32px))',
        maxHeight: 'calc(100vh - 120px)',
        zIndex: 2000,
        transition: 'bottom 0.2s ease-out',
      }}
    >
      {!isExpanded && (
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.08)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '12px',
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            fontSize: '13px',
            color: '#e2e8f0',
            position: 'relative',
          }}
        >
          {/* Models Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }} onClick={() => {
            const opening = !showModelsDropdown;
            setShowModelsDropdown(opening);
            if (opening) {
              setShowMapDropdown(false);
              setShowUnifyDropdown(false);
            }
          }}>
            <span>{getWitnessLabel()}</span>
            <span style={{ fontSize: '10px', color: '#94a3b8' }}>▼</span>
          </div>
          {showModelsDropdown && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                background: 'rgba(255, 255, 255, 0.08)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                padding: '8px',
                minWidth: '200px',
                zIndex: 1000,
              }}
              role="menu"
              aria-label="Model selection"
            >
              {LLM_PROVIDERS_CONFIG.map((provider) => {
                const isSelected = selectedModels[provider.id];
                return (
                  <label
                    key={provider.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      borderRadius: '4px',
                      background: isSelected ? 'rgba(99, 102, 241, 0.3)' : 'transparent',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (isSelected) e.currentTarget.style.boxShadow = '0 0 8px rgba(99, 102, 241, 0.5)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => !isLoading && onToggleModel(provider.id)}
                      disabled={isLoading}
                      style={{ width: '14px', height: '14px', accentColor: '#6366f1' }}
                    />
                    <span style={{ fontSize: '12px', color: isSelected ? '#a5b4fc' : '#94a3b8' }}>
                      {provider.name}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          <span style={{ color: '#64748b' }}>•</span>

          {/* Map Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: canRefine ? 'pointer' : 'default', opacity: canRefine ? 1 : 0.5 }} onClick={canRefine ? () => {
            const opening = !showMapDropdown;
            setShowMapDropdown(opening);
            if (opening) {
              setShowModelsDropdown(false);
              setShowUnifyDropdown(false);
            }
          } : undefined}>
            <span>{getMapLabel()}</span>
            <span style={{ fontSize: '10px', color: '#94a3b8' }}>▼</span>
          </div>
          {showMapDropdown && canRefine && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                right: '65%',
                background: 'rgba(3, 7, 18, 0.72)',
                color: '#e2e8f0',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                borderRadius: '8px',
                padding: '8px',
                minWidth: '170px',
                zIndex: 1000,
                boxShadow: '0 8px 24px rgba(2,6,23,0.6)'
              }}
              role="menu"
              aria-label="Map provider selection"
            >
              {LLM_PROVIDERS_CONFIG.map((provider) => {
                const isSelected = mapProviderId === provider.id;
                return (
                  <button
                    key={provider.id}
                    onClick={() => {
                      if (isLoading) return;
                      const clickedId = provider.id;
                      
                      // Determine new Map state (toggle)
                      const newMapProvider = mapProviderId === clickedId ? null : clickedId;
                      
                      // If activating Map, check for Unify conflict
                      if (newMapProvider && unifyProviderId === newMapProvider) {
                        const selectedIds = LLM_PROVIDERS_CONFIG.map(p => p.id).filter(id => selectedModels[id]);
                        const prefer = newMapProvider === 'gemini' ? ['qwen'] : newMapProvider === 'qwen' ? ['gemini'] : ['qwen', 'gemini'];
                        let fallback: string | null = null;
                        for (const cand of prefer) {
                          if (cand !== newMapProvider && selectedIds.includes(cand)) { fallback = cand; break; }
                        }
                        if (!fallback) {
                          fallback = selectedIds.find(id => id !== newMapProvider) || null;
                        }
                        onSetSynthesisProvider?.(fallback);
                        try {
                          if (fallback) localStorage.setItem('htos_synthesis_provider', fallback);
                          else localStorage.removeItem('htos_synthesis_provider');
                        } catch {}
                      }
                      
                      // Apply new Map state
                      onSetMappingProvider?.(newMapProvider);
                      onToggleMapping?.(!!newMapProvider);
                      try {
                        if (newMapProvider) {
                          localStorage.setItem('htos_mapping_provider', newMapProvider);
                          localStorage.setItem('htos_mapping_enabled', JSON.stringify(true));
                        } else {
                          localStorage.removeItem('htos_mapping_provider');
                          localStorage.setItem('htos_mapping_enabled', JSON.stringify(false));
                        }
                      } catch {}
                      
                      setShowMapDropdown(false);
                    }}
                    disabled={isLoading}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 10px',
                      background: isSelected ? 'rgba(34, 197, 94, 0.12)' : 'transparent',
                      color: isSelected ? '#22c55e' : '#e2e8f0',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      transition: 'all 0.12s ease',
                      fontSize: '12px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isSelected ? 'rgba(34, 197, 94, 0.12)' : 'transparent';
                    }}
                  >
                    {provider.name}
                    {isSelected && ' ✓'}
                  </button>
                );
              })}
            </div>
          )}

          <span style={{ color: '#64748b' }}>•</span>

          {/* Unify Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: canRefine ? 'pointer' : 'default', opacity: canRefine ? 1 : 0.5 }} onClick={canRefine ? () => {
            const opening = !showUnifyDropdown;
            setShowUnifyDropdown(opening);
            if (opening) {
              setShowModelsDropdown(false);
              setShowMapDropdown(false);
            }
          } : undefined}>
            <span>{getUnifyLabel()}</span>
            <span style={{ fontSize: '10px', color: '#94a3b8' }}>▼</span>
          </div>
          {showUnifyDropdown && canRefine && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                right: '55%',
                background: 'rgba(3, 7, 18, 0.72)',
                color: '#e2e8f0',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                borderRadius: '8px',
                padding: '8px',
                minWidth: '170px',
                zIndex: 1000,
                boxShadow: '0 8px 24px rgba(2,6,23,0.6)'
              }}
              role="menu"
              aria-label="Unify provider selection"
            >
              {powerUserMode ? (
                LLM_PROVIDERS_CONFIG.map((provider) => {
                  const isSelected = synthesisProviders.includes(provider.id);
                  return (
                    <label
                      key={provider.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '6px 8px',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        background: isSelected ? 'rgba(251, 191, 36, 0.12)' : 'transparent',
                        transition: 'all 0.12s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (isSelected) e.currentTarget.style.boxShadow = '0 0 8px rgba(251, 191, 36, 0.5)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          if (isLoading) return;
                          const clickedId = provider.id;
                          const isCurrentlySelected = isSelected;
                          
                          // If selecting (checking), check for Map conflict
                          if (!isCurrentlySelected && mapProviderId === clickedId) {
                            const selectedIds = LLM_PROVIDERS_CONFIG.map(p => p.id).filter(id => selectedModels[id]);
                            const prefer = clickedId === 'gemini' ? ['qwen'] : clickedId === 'qwen' ? ['gemini'] : ['qwen', 'gemini'];
                            let fallback: string | null = null;
                            for (const cand of prefer) {
                              if (cand !== clickedId && selectedIds.includes(cand)) { fallback = cand; break; }
                            }
                            if (!fallback) {
                              fallback = selectedIds.find(id => id !== clickedId) || null;
                            }
                            onSetMappingProvider?.(fallback);
                            try {
                              if (fallback) {
                                localStorage.setItem('htos_mapping_provider', fallback);
                              } else {
                                localStorage.removeItem('htos_mapping_provider');
                              }
                            } catch {}
                          }

                          onToggleSynthesisProvider?.(clickedId);
                        }}
                        disabled={isLoading}
                        style={{ width: '14px', height: '14px', accentColor: '#fbbf24' }}
                      />
                      <span style={{ fontSize: '12px', color: isSelected ? '#fbbf24' : '#94a3b8' }}>
                        {provider.name}
                      </span>
                    </label>
                  );
                })
              ) : (
                LLM_PROVIDERS_CONFIG.map((provider) => {
                  const isSelected = unifyProviderId === provider.id;
                  return (
                    <button
                      key={provider.id}
                      onClick={() => {
                        if (isLoading) return;
                        const clickedId = provider.id;
                        
                        // Determine new Unify state (toggle)
                        const newUnifyProvider = unifyProviderId === clickedId ? null : clickedId;
                        
                        // If activating Unify, check for Map conflict
                        if (newUnifyProvider && mapProviderId === newUnifyProvider) {
                          const selectedIds = LLM_PROVIDERS_CONFIG.map(p => p.id).filter(id => selectedModels[id]);
                          const prefer = newUnifyProvider === 'gemini' ? ['qwen'] : newUnifyProvider === 'qwen' ? ['gemini'] : ['qwen', 'gemini'];
                          let fallback: string | null = null;
                          for (const cand of prefer) {
                            if (cand !== newUnifyProvider && selectedIds.includes(cand)) { fallback = cand; break; }
                          }
                          if (!fallback) {
                            fallback = selectedIds.find(id => id !== newUnifyProvider) || null;
                          }
                          onSetMappingProvider?.(fallback);
                          try {
                            if (fallback) {
                              localStorage.setItem('htos_mapping_provider', fallback);
                              localStorage.setItem('htos_mapping_enabled', JSON.stringify(true));
                            } else {
                              onToggleMapping?.(false);
                              localStorage.removeItem('htos_mapping_provider');
                              localStorage.setItem('htos_mapping_enabled', JSON.stringify(false));
                            }
                          } catch {}
                        }
                        
                        // Apply new Unify state
                        onSetSynthesisProvider?.(newUnifyProvider);
                        try {
                          if (newUnifyProvider) {
                            localStorage.setItem('htos_synthesis_provider', newUnifyProvider);
                          } else {
                            localStorage.removeItem('htos_synthesis_provider');
                          }
                        } catch {}
                        
                        setShowUnifyDropdown(false);
                      }}
                      disabled={isLoading}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '6px 10px',
                        background: isSelected ? 'rgba(251, 191, 36, 0.12)' : 'transparent',
                        color: isSelected ? '#fbbf24' : '#e2e8f0',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        transition: 'all 0.12s ease',
                        fontSize: '12px'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = isSelected ? 'rgba(251, 191, 36, 0.12)' : 'transparent';
                      }}
                    >
                      {provider.name}
                      {isSelected && ' ✓'}
                    </button>
                  );
                })
              )}
            </div>
          )}

          <span style={{ color: '#64748b' }}>•</span>

          {/* Refine Dropdown - NEW */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }} onClick={() => {
            const opening = !showRefineDropdown;
            setShowRefineDropdown(opening);
            if (opening) {
              setShowModelsDropdown(false);
              setShowMapDropdown(false);
              setShowUnifyDropdown(false);
            }
          }}>
            <span>{getRefineLabel()}</span>
            <span style={{ fontSize: '10px', color: '#94a3b8' }}>▼</span>
          </div>
          {showRefineDropdown && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                right: '0%',
                background: 'rgba(3, 7, 18, 0.72)',
                color: '#e2e8f0',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                borderRadius: '8px',
                padding: '8px',
                minWidth: '170px',
                zIndex: 1000,
                boxShadow: '0 8px 24px rgba(2,6,23,0.6)'
              }}
              role="menu"
              aria-label="Refine provider selection"
            >
              <button
                onClick={() => {
                  if (isLoading) return;
                  onSetRefineModel('auto');
                  try {
                    localStorage.setItem('htos_refine_model', 'auto');
                  } catch {}
                  setShowRefineDropdown(false);
                }}
                disabled={isLoading}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  background: refineModel === 'auto' ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                  color: refineModel === 'auto' ? '#6366f1' : '#e2e8f0',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  transition: 'all 0.12s ease',
                  fontSize: '12px'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = refineModel === 'auto' ? 'rgba(99, 102, 241, 0.12)' : 'transparent'; }}
              >
                Auto
                {refineModel === 'auto' && ' ✓'}
              </button>
              {LLM_PROVIDERS_CONFIG.map((provider) => {
                const isSelected = refineModel === provider.id;
                return (
                  <button
                    key={provider.id}
                    onClick={() => {
                      if (isLoading) return;
                      onSetRefineModel(provider.id);
                      try {
                        localStorage.setItem('htos_refine_model', provider.id);
                      } catch {}
                      setShowRefineDropdown(false);
                    }}
                    disabled={isLoading}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 10px',
                      background: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                      color: isSelected ? '#6366f1' : '#e2e8f0',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      transition: 'all 0.12s ease',
                      fontSize: '12px'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = isSelected ? 'rgba(99, 102, 241, 0.12)' : 'transparent'; }}
                  >
                    {provider.name}
                    {isSelected && ' ✓'}
                  </button>
                );
              })}
            </div>
          )}

          <button
            onClick={() => {
              setIsExpanded(true);
              setShowModelsDropdown(false);
              setShowMapDropdown(false);
              setShowUnifyDropdown(false);
              setShowRefineDropdown(false);
            }}
            aria-expanded={isExpanded}
            aria-label="Open full settings"
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: '16px',
              padding: '4px',
              borderRadius: '4px',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'none';
            }}
          >
            ⚙️
          </button>
        </div>
      )}

      {/* Expanded State - ALL YOUR EXISTING CODE */}
      {isExpanded && (
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.08)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '16px',
            padding: '16px 20px',
            maxHeight: 'calc(100vh - 160px)',
            overflowY: 'auto',
          }}
        >
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            marginBottom: '16px'
          }}>
            <span style={{ 
              fontSize: '14px', 
              color: '#e2e8f0', 
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              ⚙️ Configuration
            </span>
            <button
              onClick={() => setIsExpanded(false)}
              aria-label="Close settings"
              style={{
                background: 'none',
                border: 'none',
                color: '#64748b',
                cursor: 'pointer',
                fontSize: '18px',
                padding: '4px',
                borderRadius: '4px',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.color = '#e2e8f0';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'none';
                e.currentTarget.style.color = '#64748b';
              }}
            >
              ×
            </button>
          </div>

          {/* Witness Section */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ 
              fontSize: '12px', 
              color: '#94a3b8', 
              fontWeight: 500, 
              marginBottom: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span>Witness</span>
              <button
                onClick={() => {
                  const allSelected = activeCount === LLM_PROVIDERS_CONFIG.length;
                  LLM_PROVIDERS_CONFIG.forEach(provider => {
                    if (allSelected && selectedModels[provider.id]) {
                      onToggleModel(provider.id);
                    } else if (!allSelected && !selectedModels[provider.id]) {
                      onToggleModel(provider.id);
                    }
                  });
                }}
                disabled={isLoading}
                style={{
                  marginLeft: 'auto',
                  padding: '2px 8px',
                  fontSize: '10px',
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '4px',
                  color: '#94a3b8',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  opacity: isLoading ? 0.5 : 1,
                }}
              >
                [All]
              </button>
            </div>
            
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {LLM_PROVIDERS_CONFIG.map((provider: LLMProvider) => {
                const isSelected = selectedModels[provider.id];
                return (
                  <label key={provider.id} style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '6px', 
                    cursor: 'pointer',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    background: isSelected ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    border: `1px solid ${isSelected ? 'rgba(99, 102, 241, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`,
                    transition: 'all 0.2s ease',
                  }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => !isLoading && onToggleModel(provider.id)}
                      disabled={isLoading}
                      style={{
                        width: '14px',
                        height: '14px',
                        accentColor: '#6366f1',
                      }}
                    />
                    <span style={{ 
                      fontSize: '12px', 
                      color: isSelected ? '#a5b4fc' : '#94a3b8',
                      fontWeight: 500
                    }}>
                      {provider.name}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Refine Section */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ 
              fontSize: '12px', 
              color: '#94a3b8', 
              fontWeight: 500, 
              marginBottom: '8px' 
            }}>
              Refine
            </div>
            
            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
              {/* Map */}
              <div style={{ opacity: canRefine ? 1 : 0.5 }}>
                <label style={{ 
                  display: 'flex', 
                  flexDirection: 'column',
                  gap: '4px', 
                  cursor: 'pointer' 
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="checkbox"
                      checked={isMapEnabled}
                      onChange={(e) => {
                        if (isLoading) return;
                        const checked = e.target.checked;
                        onToggleMapping?.(checked);
                        try { localStorage.setItem('htos_mapping_enabled', JSON.stringify(checked)); } catch (_) {}
                        if (!checked) {
                          onSetMappingProvider?.(null);
                          try { localStorage.removeItem('htos_mapping_provider'); } catch (_) {}
                        }
                      }}
                      disabled={!canRefine || isLoading}
                      style={{
                        width: '14px',
                        height: '14px',
                        accentColor: '#6366f1',
                      }}
                    />
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                      Map
                    </span>
                  </div>
                  <select
                    value={mapProviderId}
                    onChange={(e) => {
                      const val = e.target.value || null;
                      if (val && unifyProviderId === val) {
                        const selectedIds = LLM_PROVIDERS_CONFIG.map(p => p.id).filter(id => selectedModels[id]);
                        const prefer = val === 'gemini' ? ['qwen'] : val === 'qwen' ? ['gemini'] : ['qwen', 'gemini'];
                        let fallback: string | null = null;
                        for (const cand of prefer) {
                          if (cand !== val && selectedIds.includes(cand)) { fallback = cand; break; }
                        }
                        if (!fallback) {
                          fallback = selectedIds.find(id => id !== val) || null;
                        }
                        onSetSynthesisProvider?.(fallback);
                        try { if (fallback) localStorage.setItem('htos_synthesis_provider', fallback); } catch {}
                      }
                      onSetMappingProvider?.(val);
                      try {
                        if (val) {
                          onToggleMapping?.(true);
                          localStorage.setItem('htos_mapping_provider', val);
                          localStorage.setItem('htos_mapping_enabled', JSON.stringify(true));
                        } else {
                          onToggleMapping?.(false);
                          localStorage.removeItem('htos_mapping_provider');
                          localStorage.setItem('htos_mapping_enabled', JSON.stringify(false));
                        }
                      } catch (_) {}
                    }}
                    disabled={!isMapEnabled || !canRefine || isLoading}
                    style={{
                      background: 'rgba(255, 255, 255, 0.1)',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: '4px',
                      color: '#e2e8f0',
                      fontSize: '12px',
                      padding: '2px 6px',
                      opacity: isMapEnabled && canRefine ? 1 : 0.5,
                    }}
                  >
                    <option value="">Select...</option>
                    {selectedProviders.map(provider => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </label>
                {!canRefine && (
                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>
                    Select 2+ models to enable.
                  </div>
                )}
              </div>

              {/* Unify */}
              <div style={{ opacity: canRefine ? 1 : 0.5 }}>
                <label style={{ 
                  display: 'flex', 
                  flexDirection: 'column',
                  gap: '4px', 
                  cursor: 'pointer' 
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="checkbox"
                      checked={isUnifyEnabled}
                      onChange={(e) => {
                        if (!isLoading) {
                          if (e.target.checked && selectedProviders.length > 0 && canRefine) {
                            if (powerUserMode) {
                              if (!synthesisProviders.includes(selectedProviders[0].id)) {
                                onToggleSynthesisProvider?.(selectedProviders[0].id);
                              }
                            } else {
                              onSetSynthesisProvider?.(selectedProviders[0].id);
                            }
                          } else {
                            if (powerUserMode) {
                              synthesisProviders.forEach(id => onToggleSynthesisProvider?.(id));
                            } else {
                              onSetSynthesisProvider?.(null);
                            }
                          }
                        }
                      }}
                      disabled={!canRefine || isLoading}
                      style={{
                        width: '14px',
                        height: '14px',
                        accentColor: '#6366f1',
                      }}
                    />
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                      Unify
                    </span>
                  </div>
                  {powerUserMode ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '100px', overflowY: 'auto' }}>
                      {selectedProviders.map(provider => {
                        const isSelected = synthesisProviders.includes(provider.id);
                        return (
                          <label
                            key={provider.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '4px',
                              borderRadius: '4px',
                              background: isSelected ? 'rgba(251, 191, 36, 0.2)' : 'transparent',
                              cursor: 'pointer',
                              transition: 'all 0.2s ease',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                if (isLoading) return;
                                const clickedId = provider.id;
                                if (mapProviderId === clickedId && !isSelected) {
                                  const selectedIds = LLM_PROVIDERS_CONFIG.map(p => p.id).filter(id => selectedModels[id]);
                                  const prefer = clickedId === 'gemini' ? ['qwen'] : clickedId === 'qwen' ? ['gemini'] : ['qwen', 'gemini'];
                                  let fallback: string | null = null;
                                  for (const cand of prefer) {
                                    if (cand !== clickedId && selectedIds.includes(cand)) { fallback = cand; break; }
                                  }
                                  if (!fallback) {
                                    fallback = selectedIds.find(id => id !== clickedId) || null;
                                  }
                                  onSetMappingProvider?.(fallback);
                                  try {
                                    if (fallback) {
                                      localStorage.setItem('htos_mapping_provider', fallback);
                                    } else {
                                      localStorage.removeItem('htos_mapping_provider');
                                    }
                                  } catch {}
                                }
                                onToggleSynthesisProvider?.(clickedId);
                              }}
                              disabled={isLoading}
                              style={{ width: '14px', height: '14px', accentColor: '#fbbf24' }}
                            />
                            <span style={{ fontSize: '12px', color: isSelected ? '#fbbf24' : '#94a3b8' }}>
                              {provider.name}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <select
                      value={unifyProviderId}
                      onChange={(e) => {
                        const val = e.target.value || null;
                        if (val && mapProviderId === val) {
                          const selectedIds = LLM_PROVIDERS_CONFIG.map(p => p.id).filter(id => selectedModels[id]);
                          const prefer = val === 'gemini' ? ['qwen'] : val === 'qwen' ? ['gemini'] : ['qwen', 'gemini'];
                          let fallback: string | null = null;
                          for (const cand of prefer) {
                            if (cand !== val && selectedIds.includes(cand)) { fallback = cand; break; }
                          }
                          if (!fallback) {
                            fallback = selectedIds.find(id => id !== val) || null;
                          }
                          onSetMappingProvider?.(fallback);
                          try { if (fallback) localStorage.setItem('htos_mapping_provider', fallback); } catch {}
                        }
                        onSetSynthesisProvider?.(val);
                      }}
                      disabled={!isUnifyEnabled || !canRefine || isLoading}
                      style={{
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '4px',
                        color: '#e2e8f0',
                        fontSize: '12px',
                        padding: '2px 6px',
                        opacity: isUnifyEnabled && canRefine ? 1 : 0.5,
                      }}
                    >
                      <option value="">Select...</option>
                      {selectedProviders.map(provider => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
                {!canRefine && (
                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>
                    Select 2+ models to enable.
                  </div>
                )}
              </div>

              {/* Refine Model */}
              <div>
                <label style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  cursor: 'pointer'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                      Refine Model
                    </span>
                  </div>
                  <select
                    value={refineModel}
                    onChange={(e) => {
                      const model = e.target.value;
                      onSetRefineModel(model);
                      try {
                        localStorage.setItem('htos_refine_model', model);
                      } catch (_) {}
                    }}
                    disabled={isLoading}
                    style={{
                      background: 'rgba(255, 255, 255, 0.1)',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: '4px',
                      color: '#e2e8f0',
                      fontSize: '12px',
                      padding: '2px 6px',
                    }}
                  >
                    <option value="auto">Auto</option>
                    {LLM_PROVIDERS_CONFIG.map(provider => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </div>

          {/* Parley Button */}
          <div style={{ 
            display: 'flex', 
            gap: '8px', 
            justifyContent: 'flex-end' 
          }}>
            <button
              onClick={() => {
                LLM_PROVIDERS_CONFIG.forEach(provider => {
                  if (!selectedModels[provider.id]) {
                    onToggleModel(provider.id);
                  }
                });
                onToggleMapping?.(true);
                const availableProviders = LLM_PROVIDERS_CONFIG.filter(p => selectedModels[p.id]);
                if (availableProviders.length >= 2) {
                  onSetMappingProvider?.(availableProviders[0].id);
                  onSetSynthesisProvider?.(availableProviders[1]?.id || availableProviders[0].id);
                }
                setIsExpanded(false);
              }}
              disabled={isLoading}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                background: 'rgba(34, 197, 94, 0.2)',
                border: '1px solid rgba(34, 197, 94, 0.4)',
                borderRadius: '6px',
                color: '#22c55e',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                fontWeight: 500,
                transition: 'all 0.2s ease',
                opacity: isLoading ? 0.5 : 1,
              }}
            >
              Parley
            </button>
          </div>

          {/* Think Toggle */}
          {selectedModels.chatgpt && (
            <div style={{ 
              marginTop: '12px', 
              paddingTop: '12px', 
              borderTop: '1px solid rgba(255, 255, 255, 0.1)' 
            }}>
              <label style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                cursor: 'pointer' 
              }}>
                <input
                  type="checkbox"
                  checked={thinkOnChatGPT}
                  onChange={() => !isLoading && onToggleThinkChatGPT?.()}
                  disabled={isLoading}
                  style={{
                    width: '14px',
                    height: '14px',
                    accentColor: '#6366f1',
                  }}
                />
                <span style={{ fontSize: '14px' }}>🤔</span>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Think mode for ChatGPT
                </span>
                <span style={{ 
                  fontSize: '10px', 
                  color: thinkOnChatGPT ? '#22c55e' : '#64748b',
                  fontWeight: 500
                }}>
                  {thinkOnChatGPT ? 'ON' : 'OFF'}
                </span>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CompactModelTray;