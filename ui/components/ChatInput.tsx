import { useEffect, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { chatInputValueAtom } from '../state/atoms';
import { LLM_PROVIDERS_CONFIG } from '../constants';

interface ChatInputProps {
  onSendPrompt: (prompt: string) => void;
  onContinuation: (prompt: string) => void;
  onRefinePrompt?: (prompt: string, model?: string) => void;
  // Abort/Stop current workflow
  onAbort?: () => void;
  isLoading: boolean;
  isReducedMotion?: boolean;
  activeProviderCount: number;
  isVisibleMode: boolean;
  isContinuationMode: boolean;
  // Mapping-specific
  onStartMapping?: (prompt: string) => void;
  canShowMapping?: boolean; // ModelTray has >=2 selected and prompt has content
  mappingTooltip?: string;
  mappingActive?: boolean; // disable input and toggles while active
  onHeightChange?: (height: number) => void; // Callback for height changes
}

const ChatInput = ({
    onSendPrompt,
    onContinuation,
    onRefinePrompt,
  onAbort,
  isLoading,
  isReducedMotion = false,
  activeProviderCount,
  isVisibleMode,
  isContinuationMode,
  onStartMapping,
  canShowMapping = false,
  mappingTooltip,
  mappingActive = false,
  onHeightChange,
}: ChatInputProps) => {
  const CHAT_INPUT_STORAGE_KEY = 'htos_chat_input_value';
  const [prompt, setPrompt] = useAtom(chatInputValueAtom);
  const [showRefineDropdown, setShowRefineDropdown] = useState(false);
  const [refineModel, setRefineModel] = useState<string>('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'; // Reset height
      const scrollHeight = textareaRef.current.scrollHeight;
      const newHeight = Math.min(scrollHeight, 120); // Max height 120px
      textareaRef.current.style.height = `${newHeight}px`;
      
      // Calculate total input area height (textarea + padding + borders)
      const totalHeight = newHeight + 24 + 2; // 12px padding top/bottom + 1px border top/bottom
      onHeightChange?.(totalHeight);
    }
  }, [prompt, onHeightChange]);

  const handleSubmit = (e?: React.FormEvent | React.KeyboardEvent) => {
    if (e) e.preventDefault();
    if (isLoading || !prompt.trim()) return;

    const trimmed = prompt.trim();
    if (isContinuationMode) {
      onContinuation(trimmed);
    } else {
      onSendPrompt(trimmed);
    }
    setPrompt("");
  };
  
  const buttonText = isContinuationMode ? 'Continue' : 'Send';
  const isDisabled = isLoading || mappingActive || !prompt.trim();
  const showMappingBtn = canShowMapping && !!prompt.trim();
  const showAbortBtn = !!onAbort && isLoading;

  // Status color for system pill
  const statusColor = isLoading ? '#f59e0b' : '#10b981';

  return (
    <div
      className="input-area"
      style={{
        position: 'sticky',
        bottom: 0,
        left: 0,
        width: '100%',
        padding: '8px 12px',
        boxSizing: 'border-box',
        zIndex: 2001,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div className="input-container" style={{ display: 'flex', gap: '10px', alignItems: 'center', position: 'relative', width: '100%', maxWidth: 'min(800px, calc(100% - 32px))', padding: '12px 16px', background: 'rgba(255, 255, 255, 0.08)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '24px', boxSizing: 'border-box' }}>
        

        <div className="input-wrapper" style={{ flex: 1, position: 'relative' }}>
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
            placeholder={
              isContinuationMode
                ? "Continue the conversation with your follow-up message..."
                : "Ask anything... Singularity will orchestrate multiple AI models for you."
            }
            rows={1}
            className="prompt-textarea"
            style={{
              width: '100%', minHeight: '38px', padding: '8px 12px',
              background: 'transparent', border: 'none',
              color: '#e2e8f0', fontSize: '15px', fontFamily: 'inherit',
              resize: 'none', outline: 'none', transition: isReducedMotion ? undefined : 'all 0.2s ease',
              overflowY: 'auto'
            }}
            onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === 'Enter' && !e.shiftKey && prompt.trim()) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            disabled={isLoading}
          />
        </div>

        {/* System status pill (minimal) to the right of the input */}
        <div
          className="system-pill"
          role="status"
          aria-live="polite"
          title={`System: ${isLoading ? 'Working…' : 'Ready'} • Providers: ${activeProviderCount} • Mode: ${isVisibleMode ? 'Visible' : 'Headless'}`}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '6px 10px',
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '999px',
            color: '#cbd5e1',
            fontSize: '12px',
            whiteSpace: 'nowrap',
            opacity: 0.9,
            cursor: 'default'
          }}
        >
          <span aria-hidden="true" style={{
            display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: statusColor,
            animation: isLoading || !isReducedMotion ? 'pulse 1.5s ease-in-out infinite' : undefined
          }} />
          <span style={{ color: '#94a3b8' }}>System</span>
          <span>• {activeProviderCount}</span>
        </div>

        {/* Refine Button */}
        {onRefinePrompt && (
          <div style={{ position: 'relative' }}>
          <button
            type="button"
              onClick={() => setShowRefineDropdown(v => !v)}
            disabled={isDisabled}
            className="action-button"
            style={{
              padding: '0px 14px', height: '38px',
              background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '16px', color: '#e2e8f0', fontWeight: 600, cursor: 'pointer',
              transition: isReducedMotion ? undefined : 'all 0.2s ease', display: 'flex', alignItems: 'center', gap: '8px',
              minWidth: '90px', justifyContent: 'center',
              opacity: isDisabled ? 0.5 : 1
            }}
          >
            <span className="magic-icon" style={{ fontSize: '16px' }}>
              🪄
            </span>
            <span>Refine</span>
          </button>
            {showRefineDropdown && (
              <div style={{ position: 'absolute', right: 0, bottom: '110%', background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 12, padding: 10, minWidth: 220, zIndex: 99999 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#94a3b8', minWidth: 64 }}>Model</span>
                  <select
                    value={refineModel}
                    onChange={(e) => setRefineModel(e.target.value)}
                    style={{ flex: 1, padding: '6px', borderRadius: 8, background: '#0b1220', color: '#e2e8f0', border: '1px solid #334155' }}
                    title="Select model for prompt refinement"
                  >
                    <option value="">auto</option>
                    {LLM_PROVIDERS_CONFIG.map(p => (
                      <option key={p.id} value={p.id} title={`${p.name} — ${p.emoji}`}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => setShowRefineDropdown(false)}
                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #475569', background: '#334155', color: '#e2e8f0', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => { onRefinePrompt(prompt, refineModel || undefined); setShowRefineDropdown(false); }}
                    style={{ padding: '6px 10px', borderRadius: 8, border: 'none', background: 'linear-gradient(45deg, #6366f1, #8b5cf6)', color: 'white', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Run
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Send Button */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isDisabled}
          className="action-button"
          style={{
            padding: '0px 14px', height: '38px',
            background: 'linear-gradient(45deg, #6366f1, #8b5cf6)', border: 'none',
            borderRadius: '16px', color: 'white', fontWeight: 600, cursor: 'pointer',
            transition: isReducedMotion ? undefined : 'all 0.2s ease', display: 'flex', alignItems: 'center', gap: '8px',
            minWidth: '90px', justifyContent: 'center',
            opacity: isDisabled ? 0.5 : 1
          }}
        >
          {isLoading ? (
            <div className="loading-spinner"></div>
          ) : (
            <>
              <span className="magic-icon" style={{ fontSize: '16px' }}>
                {isContinuationMode ? '💬' : '✨'}
              </span>
              <span>{buttonText}</span>
            </>
          )}
        </button>

        {/* Abort/Stop Button - visible while loading */}
        {showAbortBtn && (
          <button
            type="button"
            onClick={() => onAbort?.()}
            title="Stop current workflow"
            className="stop-button"
            style={{
              padding: '0px 12px', height: '38px',
              background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.45)',
              borderRadius: '16px', color: '#fecaca', fontWeight: 600, cursor: 'pointer',
              transition: isReducedMotion ? undefined : 'all 0.2s ease', display: 'flex', alignItems: 'center', gap: '8px',
              minWidth: '90px', justifyContent: 'center'
            }}
          >
            <span style={{ fontSize: '16px' }}>⏹️</span>
            <span>Stop</span>
          </button>
        )}
        
        {/* Mapping Button (ChatInput path) */}
        {showMappingBtn && (
          <button
            type="button"
            onClick={() => { onStartMapping?.(prompt.trim()); setPrompt(""); try { localStorage.removeItem(CHAT_INPUT_STORAGE_KEY); } catch {} }}
            disabled={isLoading || mappingActive}
            title={mappingTooltip || 'Mapping with selected models'}
            style={{
              padding: '0px 12px', height: '38px',
              background: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '16px', color: '#e2e8f0', fontWeight: 600, cursor: 'pointer',
              transition: isReducedMotion ? undefined : 'all 0.2s ease', display: 'flex', alignItems: 'center', gap: '8px',
              minWidth: '110px', justifyContent: 'center',
              opacity: (isLoading || mappingActive) ? 0.5 : 1
            }}
          >
            <span style={{ fontSize: '16px' }}>🧩</span>
            <span>Mapping</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default ChatInput;