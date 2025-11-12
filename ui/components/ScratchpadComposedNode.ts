// New file: ScratchpadComposedNode.ts
import { Node, mergeAttributes } from '@tiptap/core';
import { tokens } from '../theme/tokens';

export const ScratchpadComposedNode = Node.create({
  name: 'scratchpadBlock',
  group: 'block',
  content: 'inline*',
  
  addAttributes() {
    return {
      turnId: { default: null },
      providerId: { default: null },
      responseType: { default: 'batch' },
      // Include sessionId so jumps can navigate across sessions
      sessionId: { default: null }
    };
  },
  
  renderHTML({ HTMLAttributes, node }) {
    const providerId = node.attrs.providerId || 'unknown';
    const turnId = node.attrs.turnId || '';
    const sessionId = node.attrs.sessionId || null;
    
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: 'scratchpad-block',
        'data-turn-id': turnId,
        'data-provider': providerId,
        ...(sessionId ? { 'data-session-id': sessionId } : {}),
        style: `
          border-left: 3px solid var(--provider-color, #6b7280);
          padding: 12px;
          margin: 8px 0;
          position: relative;
        `
      }),
      0 // content goes here
    ];
  },
  
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      const contentDOM = document.createElement('div');
      
      const { turnId, providerId, responseType, sessionId } = node.attrs;
      
      // Add the colored border
      dom.className = 'scratchpad-block';
      dom.style.borderLeft = `3px solid ${getProviderColor(providerId)}`;
      dom.style.padding = '12px 16px 12px 12px';
      dom.style.margin = '8px 0';
      dom.style.position = 'relative';
      
      // Add a simple badge
      const badge = document.createElement('button');
      badge.className = 'provenance-badge';
      const safeProvider = typeof providerId === 'string' ? providerId : 'unknown';
      const safeTurn = typeof turnId === 'string' || typeof turnId === 'number' ? String(turnId) : '';
      badge.innerHTML = `${safeProvider} • T${safeTurn} ↗`;
      badge.style.cssText = `
        position: absolute;
        top: 4px;
        right: 4px;
        font-size: 10px;
        padding: 2px 6px;
        background: rgba(0,0,0,0.5);
        color: ${getProviderColor(providerId)};
        border: 1px solid ${getProviderColor(providerId)};
        border-radius: 4px;
        cursor: pointer;
      `;
      
      // SIMPLE CLICK HANDLER - Jump to source
      badge.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Find the turn in main chat and scroll to it
        const turnElement = document.querySelector(`[data-turn-id="${safeTurn}"]`);
        if (turnElement) {
          turnElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Flash to indicate we jumped there
          if (turnElement instanceof HTMLElement) {
            turnElement.style.background = 'rgba(99, 102, 241, 0.2)';
            setTimeout(() => {
              turnElement.style.background = '';
            }, 1000);
          }
        }
        
        // If it's a specific provider response, expand it
        if (safeProvider && safeProvider !== 'unknown') {
          // Dispatch event to jump to turn
          document.dispatchEvent(new CustomEvent('jump-to-turn', {
            detail: { turnId: safeTurn, providerId: safeProvider, sessionId: sessionId || undefined }
          }));
        }
      };
      
      dom.appendChild(badge);
      dom.appendChild(contentDOM);
      
      return { dom, contentDOM };
    };
  }
});

function getProviderColor(pid: string | null): string {
  const p = (pid || '').toLowerCase();
  if (!p) return '#6b7280';
  if (p.includes('claude') || p.includes('anthropic')) return tokens.accents.claude;
  if (p.includes('chatgpt') || p.includes('openai') || p.includes('gpt')) return tokens.accents.chatgpt;
  if (p.includes('gemini') || p.includes('vertex') || p.includes('google')) return tokens.accents.gemini;
  if (p.includes('qwen') || p.includes('alibaba')) return tokens.accents.qwen;
  return '#6b7280';
}