import { useState, useRef, useEffect } from 'react';
import { LLMProvider } from '../types';
import { LLM_PROVIDERS_CONFIG } from '../constants';

interface CompactModelTrayProps {
  selectedModels: Record<string, boolean>;
  onToggleModel: (providerId: string) => void;
  isLoading?: boolean;
  // Think-mode (global) toggle for ChatGPT
  thinkOnChatGPT?: boolean;
  onToggleThinkChatGPT?: () => void;
  // Synthesis provider selection
  synthesisProvider?: string | null;
  onSetSynthesisProvider?: (providerId: string | null) => void;
  // Mapping controls
  mappingEnabled?: boolean;
  onToggleMapping?: (enabled: boolean) => void;
  mappingProvider?: string | null;
  onSetMappingProvider?: (providerId: string | null) => void;
  // Power user mode
  powerUserMode?: boolean;
  synthesisProviders?: string[];
  onToggleSynthesisProvider?: (providerId: string) => void;
  // New props for compact mode
  isFirstLoad?: boolean;
  onAcknowledgeFirstLoad?: () => void; // New callback for parent to clear isFirstLoad
  chatInputHeight?: number; // New prop for dynamic positioning
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
  chatInputHeight = 80 // Default height
}: CompactModelTrayProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showModelsDropdown, setShowModelsDropdown] = useState(false);
  const [showMapDropdown, setShowMapDropdown] = useState(false);
  const [showUnifyDropdown, setShowUnifyDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Calculate active models count and names
  const activeCount = Object.values(selectedModels).filter(Boolean).length;
  const selectedProviderIds = Object.keys(selectedModels).filter(id => selectedModels[id]);
  const selectedProviders = LLM_PROVIDERS_CONFIG.filter(provider => selectedProviderIds.includes(provider.id));
  const canRefine = activeCount >= 2;
  const mapProviderId = mappingProvider || '';
  const unifyProviderId = synthesisProvider || '';
  const isMapEnabled = mappingEnabled && !!mapProviderId;
  const isUnifyEnabled = !!unifyProviderId;
  const hasRefine = isMapEnabled || isUnifyEnabled;
  
  // Generate compact labels
  const getWitnessLabel = () => {
    if (activeCount === 0) return '[No Models]';
    if (activeCount === LLM_PROVIDERS_CONFIG.length) return '[All Models]';
    if (activeCount === 1) return `[${selectedProviders[0]?.name}]`;
    return `[${activeCount} Models]`;
  };
  
  const getMapLabel = () => isMapEnabled ? `[Map: ${selectedProviders.find(p => p.id === mapProviderId)?.name || 'None'}]` : '[Map]';
  const getUnifyLabel = () => isUnifyEnabled ? `[Unify: ${selectedProviders.find(p => p.id === unifyProviderId)?.name || 'None'}]` : '[Unify]';
  
  // Handle outside clicks for closing expanded and dropdowns
  useEffect(() => {
    const shouldListen = isExpanded || showModelsDropdown || showMapDropdown || showUnifyDropdown;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
        setShowModelsDropdown(false);
        setShowMapDropdown(false);
        setShowUnifyDropdown(false);
      }
    };
    if (shouldListen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isExpanded, showModelsDropdown, showMapDropdown, showUnifyDropdown]);

  // Acknowledge first load if needed (but don't render special UI)
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
        bottom: `${chatInputHeight + 24}px`, // FIX: slightly larger offset so tray lifts above expanded input
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(800px, calc(100% - 32px))',
        maxHeight: 'calc(100vh - 120px)', // Prevent overlap
        zIndex: 2000, // ensure tray appears above chat input and overlays
        transition: 'bottom 0.2s ease-out',
      }}
    >
      {/* Collapsed State */}
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
            gap: '16px', // Spaced out slightly
            fontSize: '13px',
            color: '#e2e8f0',
            position: 'relative',
          }}
        >
          {/* Models Label with Dropdown Arrow */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }} onClick={() => {
            const opening = !showModelsDropdown;
            setShowModelsDropdown(opening);
            if (opening) {
              // ensure only one dropdown is open at a time
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

          {/* Map Label with Dropdown Arrow */}
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
                right: '65%', // move further left so dropdown aligns better with the Map label
                background: 'rgba(3, 7, 18, 0.72)', // darker backdrop for readability
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
                const isDisabled = unifyProviderId === provider.id; // Cannot select same as unify
                return (
                  <button
                    key={provider.id}
                    onClick={() => {
                      if (isDisabled || isLoading) return;
                      // If provider isn't enabled globally, enable it so it's available as a batch provider
                      if (!selectedModels[provider.id]) onToggleModel(provider.id);
                      if (mapProviderId === provider.id) {
                        // Toggle off Map when clicking the already selected provider
                        onSetMappingProvider?.(null);
                        onToggleMapping?.(false);
                        try { localStorage.removeItem('htos_mapping_provider'); localStorage.setItem('htos_mapping_enabled', JSON.stringify(false)); } catch (_) {}
                      } else {
                        onSetMappingProvider?.(provider.id);
                        onToggleMapping?.(true);
                        try { localStorage.setItem('htos_mapping_provider', provider.id); localStorage.setItem('htos_mapping_enabled', JSON.stringify(true)); } catch (_) {}
                      }
                      setShowMapDropdown(false);
                    }}
                    disabled={isDisabled || isLoading}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 10px',
                      background: isSelected ? 'rgba(34, 197, 94, 0.12)' : 'transparent',
                      color: isSelected ? '#22c55e' : '#e2e8f0',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                      transition: 'all 0.12s ease',
                      opacity: isDisabled ? 0.5 : 1,
                      fontSize: '12px' // increased to match model selector
                    }}
                    onMouseEnter={(e) => {
                      if (!isDisabled) e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
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

          {/* Unify Label with Dropdown Arrow */}
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
                right: '55%', // move left so unify dropdown centers better under the Unify label
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
                // Multi-select for power user
                LLM_PROVIDERS_CONFIG.map((provider) => {
                  const isSelected = synthesisProviders.includes(provider.id);
                  const isDisabled = mapProviderId === provider.id; // Cannot select same as map
                  return (
                    <label
                      key={provider.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '6px 8px',
                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                        borderRadius: '4px',
                        background: isSelected ? 'rgba(251, 191, 36, 0.12)' : 'transparent',
                        opacity: isDisabled ? 0.5 : 1,
                        transition: 'all 0.12s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (isSelected && !isDisabled) e.currentTarget.style.boxShadow = '0 0 8px rgba(251, 191, 36, 0.5)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          if (isDisabled || isLoading) return;
                          // enable provider globally if not already
                          if (!selectedModels[provider.id]) onToggleModel(provider.id);
                          !isLoading && onToggleSynthesisProvider?.(provider.id);
                        }}
                        disabled={isDisabled || isLoading}
                        style={{ width: '14px', height: '14px', accentColor: '#fbbf24' }}
                      />
                      <span style={{ fontSize: '12px', color: isSelected ? '#fbbf24' : '#94a3b8' }}>
                        {provider.name}
                      </span>
                    </label>
                  );
                })
              ) : (
                // Single select
                LLM_PROVIDERS_CONFIG.map((provider) => {
                  const isSelected = unifyProviderId === provider.id;
                  const isDisabled = mapProviderId === provider.id;
                  return (
                    <button
                      key={provider.id}
                      onClick={() => {
                        if (isDisabled || isLoading) return;
                        // enable globally if not selected
                        if (!selectedModels[provider.id]) onToggleModel(provider.id);
                        if (unifyProviderId === provider.id) {
                          // Toggle off Unify when clicking the already selected provider
                          onSetSynthesisProvider?.(null);
                        } else {
                          onSetSynthesisProvider?.(provider.id);
                        }
                        setShowUnifyDropdown(false);
                      }}
                      disabled={isDisabled || isLoading}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '6px 10px',
                        background: isSelected ? 'rgba(251, 191, 36, 0.12)' : 'transparent',
                        color: isSelected ? '#fbbf24' : '#e2e8f0',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                        transition: 'all 0.12s ease',
                        opacity: isDisabled ? 0.5 : 1,
                        fontSize: '12px' // increased to match model selector
                      }}
                      onMouseEnter={(e) => {
                        if (!isDisabled) e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
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

          <button
            onClick={() => {
              setIsExpanded(true);
              // close any open compact dropdowns when opening expanded view
              setShowModelsDropdown(false);
              setShowMapDropdown(false);
              setShowUnifyDropdown(false);
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

      {/* Expanded State */}
      {isExpanded && (
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.08)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '16px',
            padding: '16px 20px',
            maxHeight: 'calc(100vh - 160px)', // Ensure no overlap
            overflowY: 'auto',
          }}
        >
          {/* Header */}
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
                  // Toggle all models
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
              {/* Map (Mapping) */}
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
                        // Toggle mapping state and persist immediately
                        onToggleMapping?.(checked);
                        try { localStorage.setItem('htos_mapping_enabled', JSON.stringify(checked)); } catch (_) {}
                        if (!checked) {
                          // Clear selected mapping provider when disabling mapping
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
                      onSetMappingProvider?.(val);
                      try {
                        if (val) {
                          // Ensure mapping is enabled when a provider is selected
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
                    {selectedProviders
                      .filter(p => unifyProviderId !== p.id) // Exclude current unify
                      .map(provider => (
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

              {/* Unify (Synthesis) */}
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
                            // For power user, start with first; else single
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
                    // Multi-select checkboxes for power user
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '100px', overflowY: 'auto' }}>
                      {selectedProviders
                        .filter(p => mapProviderId !== p.id) // Exclude current map
                        .map(provider => {
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
                              onChange={() => !isLoading && onToggleSynthesisProvider?.(provider.id)}
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
                      onChange={(e) => onSetSynthesisProvider?.(e.target.value || null)}
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
                      {selectedProviders
                        .filter(p => mapProviderId !== p.id) // Exclude current map
                        .map(provider => (
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
            </div>
          </div>

          {/* Parley Button - No Apply, just Parley */}
          <div style={{ 
            display: 'flex', 
            gap: '8px', 
            justifyContent: 'flex-end' 
          }}>
            <button
              onClick={() => {
                // Enable all models and all refine options (Parley) - but pick different providers if possible
                LLM_PROVIDERS_CONFIG.forEach(provider => {
                  if (!selectedModels[provider.id]) {
                    onToggleModel(provider.id);
                  }
                });
                onToggleMapping?.(true);
                const availableProviders = LLM_PROVIDERS_CONFIG.filter(p => selectedModels[p.id]); // After enabling all
                if (availableProviders.length >= 2) {
                  // Pick first for map, second for unify (avoid same)
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

          {/* Think Toggle - Only show when ChatGPT is selected */}
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