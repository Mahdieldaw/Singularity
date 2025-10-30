import React, { useState, useRef, useEffect } from 'react';
import { LLM_PROVIDERS_CONFIG } from '../../constants';

interface RefineButtonProps {
  onRefine: (selectedModel: string, content: string) => void;
  isRefining?: boolean;
  disabled?: boolean;
}

const RefineButton: React.FC<RefineButtonProps> = ({
  onRefine,
  isRefining = false,
  disabled = false
}) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedModel, setSelectedModel] = useState(LLM_PROVIDERS_CONFIG[0]?.id || '');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleRefineClick = () => {
    if (disabled || isRefining) return;
    
    // Get content from editor (this will be passed from parent)
    onRefine(selectedModel, '');
  };

  const selectedProvider = LLM_PROVIDERS_CONFIG.find(p => p.id === selectedModel);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} ref={dropdownRef}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {/* Main Refine Button */}
        <button
          onClick={handleRefineClick}
          disabled={disabled || isRefining}
          style={{
            background: disabled || isRefining ? '#334155' : '#3b82f6',
            border: '1px solid',
            borderColor: disabled || isRefining ? '#475569' : '#3b82f6',
            borderRadius: '8px 0 0 8px',
            padding: '8px 12px',
            color: disabled || isRefining ? '#64748b' : '#fff',
            fontSize: '14px',
            fontWeight: 500,
            cursor: disabled || isRefining ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            opacity: disabled || isRefining ? 0.6 : 1,
          }}
          aria-label="Refine text with AI"
        >
          <span style={{ fontSize: '16px' }}>✨</span>
          {isRefining ? 'Refining...' : 'Refine'}
        </button>

        {/* Dropdown Toggle Button */}
        <button
          onClick={() => !disabled && !isRefining && setShowDropdown(!showDropdown)}
          disabled={disabled || isRefining}
          style={{
            background: disabled || isRefining ? '#334155' : '#3b82f6',
            border: '1px solid',
            borderColor: disabled || isRefining ? '#475569' : '#3b82f6',
            borderRadius: '0 8px 8px 0',
            padding: '8px 6px',
            color: disabled || isRefining ? '#64748b' : '#fff',
            fontSize: '12px',
            cursor: disabled || isRefining ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            opacity: disabled || isRefining ? 0.6 : 1,
            // Avoid mixing shorthand borderColor with side-specific borderLeft to prevent React warnings
            // Collapse the adjacent borders instead
            marginLeft: '-1px',
          }}
          aria-label="Select model for refinement"
        >
          ▼
        </button>
      </div>

      {/* Model Dropdown */}
      {showDropdown && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: 'rgba(30, 41, 59, 0.95)',
            backdropFilter: 'blur(20px)',
            border: '1px solid #475569',
            borderRadius: '8px',
            padding: '8px',
            zIndex: 1000,
            marginTop: '4px',
            minWidth: '200px',
          }}
          role="menu"
          aria-label="Model selection"
        >
          <div style={{ 
            fontSize: '11px', 
            color: '#94a3b8', 
            marginBottom: '6px',
            padding: '0 4px'
          }}>
            Select Model:
          </div>
          
          {LLM_PROVIDERS_CONFIG.map((provider) => {
            const isSelected = selectedModel === provider.id;
            return (
              <button
                key={provider.id}
                onClick={() => {
                  setSelectedModel(provider.id);
                  setShowDropdown(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '6px 8px',
                  background: isSelected ? 'rgba(59, 130, 246, 0.3)' : 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  color: isSelected ? '#60a5fa' : '#e2e8f0',
                  fontSize: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <div
                  className={`model-logo ${provider.logoBgClass}`}
                  style={{
                    width: '14px',
                    height: '14px',
                    borderRadius: '3px',
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1 }}>{provider.name}</span>
                {isSelected && (
                  <span style={{ fontSize: '10px', color: '#60a5fa' }}>✓</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default RefineButton;