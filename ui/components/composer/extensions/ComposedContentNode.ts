import { Node as PMNode, mergeAttributes } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';

export interface ProvenanceData {
  sessionId: string;
  aiTurnId: string;
  providerId: string;
  responseType: "hidden" | "synthesis" | "batch" | "mapping";
  responseIndex: number;
  timestamp: number;
  granularity: 'full' | 'paragraph' | 'sentence' | 'selection';
  sourceText?: string;
  originalIndex?: number;
  sourceContext?: {
    fullResponse?: string;
  };
}

export const ComposedContent = PMNode.create({
  name: 'composedContent',
  group: 'block',
  content: 'inline*',
  
  addAttributes() {
    return {
      provenance: {
        default: null,
        parseHTML: (element) => {
          const provenanceAttr = element.getAttribute('data-provenance');
          try {
            return provenanceAttr ? JSON.parse(provenanceAttr) : null;
          } catch {
            return null;
          }
        },
        renderHTML: (attributes) => {
          if (!attributes.provenance) return {};
          return { 
            'data-provenance': JSON.stringify(attributes.provenance),
            'data-provider-id': attributes.provenance.providerId,
            'data-granularity': attributes.provenance.granularity,
          };
        },
      },
      providerId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-provider-id') || '',
        renderHTML: (attributes) => ({ 'data-provider-id': attributes.providerId }),
      },
      granularity: {
        default: 'full',
        parseHTML: (element) => element.getAttribute('data-granularity') || 'full',
        renderHTML: (attributes) => ({ 'data-granularity': attributes.granularity }),
      },
    };
  },
  
  parseHTML() {
    return [
      { tag: 'div[data-provenance]' },
      { tag: 'div.composed-block' },
    ];
  },
  
  renderHTML({ HTMLAttributes, node }) {
    
    const providerColors: Record<string, string> = {
      
      'openai': '#10a37f',
      'anthropic': '#8b5cf6',
      'google': '#4285f4',
      'xai': '#ff6b35',
      'alibaba': '#ff6a00',
      
    };
    
    const providerId = node.attrs.providerId || 'default';
    const borderColor = providerColors[providerId] || '#6b7280';
    const provenance = node.attrs.provenance;
    
    // Build hover preview content
    const previewText = provenance?.sourceText || '';
    const previewSnippet = previewText.length > 150 
      ? previewText.substring(0, 147) + '...' 
      : previewText;
    
    return [
      'div', 
      mergeAttributes(HTMLAttributes, {
        class: 'composed-block',
        style: `
          border-left: 3px solid ${borderColor};
          padding: 16px 16px 16px 20px;
          margin: 20px 0;
          background: rgba(${borderColor.slice(1).match(/.{2}/g)?.map(hex => parseInt(hex, 16)).join(', ') || '107, 114, 128'}, 0.05);
          border-radius: 6px;
          position: relative;
          cursor: text;
          transition: all 0.2s ease;
          line-height: 1.6;
        `,
        'data-composer-block': 'true',
        'data-turn-id': provenance?.aiTurnId || '',
        'data-provider-id': providerId,
        'data-preview-text': previewSnippet,
        title: `${providerId} • ${provenance?.granularity || 'full'}\nUse badge to jump to source`,
      }), 
      0,
    ];
  },
  
  addCommands() {
    return {
      insertComposedContent:
        (options) =>
        ({ commands }: CommandProps) => {
          return commands.insertContentAt(
            options.position ?? this.editor.state.selection.to,
            {
              type: this.name,
              attrs: {
                provenance: options.provenance,
                providerId: options.provenance.providerId,
                granularity: options.provenance.granularity,
              },
              content: [{ type: 'text', text: options.content }],
            }
          );
        },
      deleteComposedBlock:
        (position) =>
        ({ commands }: CommandProps) => {
          return commands.deleteRange({
            from: position,
            to: position + 1,
          });
        }
    }
  },
  
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      const contentDOM = document.createElement('div');
      
      const providerColors: Record<string, string> = {
        'openai': '#10a37f',
        'chatgpt': '#10a37f',
        'anthropic': '#8b5cf6',
        'claude': '#FF7F00',
        'google': '#4285f4',
        'gemini': '#4285F4',
        'gemini-pro': '#3B82F6',
        'xai': '#ff6b35',
        'alibaba': '#ff6a00',
        'qwen': '#00A9E0',
      };
      
      const provenance = node.attrs.provenance;
      const providerIdFull = provenance?.providerId || node.attrs.providerId || 'default';
      const baseProviderId = providerIdFull.replace(/-(synthesis|mapping)$/,'');
      const borderColor = providerColors[baseProviderId] || '#6b7280';
      const responseType = provenance?.responseType || 'batch';
      const typeLabel = responseType === 'batch' ? 'B' : responseType === 'synthesis' ? 'S' : 'M';
      const aiTurnIdStr = provenance?.aiTurnId || '';
      const sessionIdStr = provenance?.sessionId || '';
      
      dom.className = 'composed-block';
      dom.setAttribute('data-composer-block', 'true');
      dom.setAttribute('data-turn-id', aiTurnIdStr);
      dom.setAttribute('data-ai-turn-id', aiTurnIdStr);
      dom.setAttribute('data-session-id', sessionIdStr);
      dom.setAttribute('data-provider-id', providerIdFull);
      
      const rgbColor = borderColor.slice(1).match(/.{2}/g)?.map(hex => parseInt(hex, 16)).join(', ') || '107, 114, 128';
      
      dom.style.cssText = `
        border-left: 3px solid ${borderColor};
        padding: 16px 16px 16px 20px;
        margin: 20px 0;
        background: rgba(${rgbColor}, 0.05);
        border-radius: 6px;
        position: relative;
        cursor: text;
        user-select: text;
        transition: all 0.2s ease;
        line-height: 1.6;
      `;
      
      // Provider badge overlay (include turn id)
      const badge = document.createElement('div');
      badge.style.cssText = `
        position: absolute;
        top: 4px;
        right: 4px;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 2px 6px;
        background: rgba(15, 23, 42, 0.9);
        border: 1px solid ${borderColor};
        border-radius: 4px;
        font-size: 10px;
        font-weight: 600;
        color: ${borderColor};
        cursor: pointer;
        z-index: 100;
        transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
        opacity: 0;
        pointer-events: none;
      `;
      badge.setAttribute('role', 'button');
      badge.setAttribute('aria-label', `Jump to ${baseProviderId} • Turn ${aiTurnIdStr || '—'}`);
      badge.title = `Click to jump to source (${baseProviderId})`;
      badge.innerHTML = `
        <span style="width: 6px; height: 6px; border-radius: 50%; background: ${borderColor};"></span>
        <span>${baseProviderId}</span>
        <span style="opacity: 0.7;">• T${aiTurnIdStr || '—'}</span>
        <span style="opacity: 0.7;">• ${typeLabel}</span>
        <span style="opacity: 0.7;">↗</span>
      `;
      dom.appendChild(badge);

      contentDOM.style.cssText = 'position: relative; padding-right: 80px; cursor: text;';
      dom.appendChild(contentDOM);

      // Tooltip preview text
      const previewRawForTitle = provenance?.sourceText || provenance?.sourceContext?.fullResponse || 'PROVENANCE DEBUG: SOURCE TEXT MISSING';
      const previewSnippetForTitle = previewRawForTitle.length > 200 ? previewRawForTitle.substring(0, 197) + '...' : previewRawForTitle;
      const gran = provenance?.granularity || 'full';
      const typeFullLabel = responseType === 'batch' ? 'Batch' : responseType === 'synthesis' ? 'Synthesis' : 'Mapping';
      dom.title = `${baseProviderId} • Turn ${aiTurnIdStr || '—'} • ${gran} • ${typeFullLabel}\n${previewSnippetForTitle}`;

      // Hover preview
      let loggedPreviewOnce = false;
      let hoverCard: HTMLDivElement | null = null;
      let hoverTimeout: NodeJS.Timeout | null = null;

      const showPreview = (evt?: MouseEvent) => {
        if (!loggedPreviewOnce) {
          try { console.log('ComposedContent: showPreview fired', { provenance }); } catch {}
          loggedPreviewOnce = true;
        }
        // Delay showing preview slightly to avoid flicker
        hoverTimeout = setTimeout(() => {
          hoverCard = document.createElement('div');
          hoverCard.className = 'composed-block-preview';
          hoverCard.style.cssText = `
            position: fixed;
            background: #1e293b;
            border: 2px solid ${borderColor};
            border-radius: 8px;
            padding: 12px;
            max-width: 320px;
            min-width: 250px;
            z-index: 999999;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
            pointer-events: none;
            font-size: 13px;
            line-height: 1.5;
            color: #e2e8f0;
          `;
          
          const previewRaw = provenance?.sourceText || provenance?.sourceContext?.fullResponse || 'PROVENANCE DEBUG: SOURCE TEXT MISSING';
          const previewText = previewRaw.length > 200 ? previewRaw.substring(0, 197) + '...' : previewRaw;
          
          const header = `
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #334155;">
              <span style="width: 8px; height: 8px; border-radius: 50%; background: ${borderColor};"></span>
              <span style="font-size: 11px; color: #94a3b8; font-weight: 600;">${baseProviderId}</span>
              <span style="font-size: 10px; color: #64748b;">• ${typeFullLabel}</span>
              <span style="font-size: 10px; color: #64748b;">• ${gran}</span>
              <span style="font-size: 10px; color: #64748b;">• Turn ${aiTurnIdStr || '—'}</span>
            </div>`;
          
          hoverCard.innerHTML = `${header}
            <div style="color: #cbd5e1; margin-bottom: 8px;">${previewText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
            <div style="font-size: 11px; color: #8b5cf6; font-style: italic; font-weight: 500;">💡 Click the badge to jump to source</div>`;
          
          document.body.appendChild(hoverCard);
          
          // Position card near cursor (fallback to block rect)
          const rect = dom.getBoundingClientRect();
          const cardRect = hoverCard.getBoundingClientRect();
          const clientX = evt?.clientX ?? rect.right;
          const clientY = evt?.clientY ?? rect.top;
          
          let top = clientY - Math.min(24, cardRect.height / 2);
          let left = clientX + 12;
          
          // Keep card in viewport
          if (left + cardRect.width > window.innerWidth) left = rect.left - cardRect.width - 12;
          if (top + cardRect.height > window.innerHeight) top = window.innerHeight - cardRect.height - 12;
          if (top < 8) top = 8;
          if (left < 8) left = 8;
          
          hoverCard.style.top = `${top}px`;
          hoverCard.style.left = `${left}px`;
        }, 80);
      };

      const updatePreviewPosition = (evt: MouseEvent) => {
        if (!hoverCard) return;
        const cardRect = hoverCard.getBoundingClientRect();
        let top = evt.clientY - Math.min(24, cardRect.height / 2);
        let left = evt.clientX + 12;
        if (left + cardRect.width > window.innerWidth) left = window.innerWidth - cardRect.width - 12;
        if (top + cardRect.height > window.innerHeight) top = window.innerHeight - cardRect.height - 12;
        if (top < 8) top = 8;
        if (left < 8) left = 8;
        hoverCard.style.top = `${top}px`;
        hoverCard.style.left = `${left}px`;
      };

      const hidePreview = () => {
        if (hoverTimeout) {
          clearTimeout(hoverTimeout);
          hoverTimeout = null;
        }
        if (hoverCard) {
          hoverCard.remove();
          hoverCard = null;
        }
      };

      dom.addEventListener('mouseenter', (e) => {
        showPreview(e);
        badge.style.opacity = '1';
        badge.style.pointerEvents = 'auto';
      });
      dom.addEventListener('mousemove', updatePreviewPosition);
      dom.addEventListener('mouseleave', () => {
        hidePreview();
        badge.style.opacity = '0';
        badge.style.pointerEvents = 'none';
      });

      badge.addEventListener('mouseenter', () => {
        badge.style.transform = 'scale(1.05)';
        badge.style.boxShadow = `0 4px 12px rgba(0,0,0,0.35)`;
      });
      badge.addEventListener('mouseleave', () => {
        badge.style.transform = 'scale(1)';
        badge.style.boxShadow = 'none';
      });

      // Prevent editor selection or PM handlers from seeing badge interactions
      const intercept = (e: Event) => { try { e.stopPropagation(); } catch {} };
      badge.addEventListener('pointerdown', intercept);
      badge.addEventListener('mousedown', intercept);
      badge.addEventListener('mouseup', intercept);

      badge.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          console.log('[ComposedContentNode] Badge clicked', {
            aiTurnId: provenance?.aiTurnId,
            providerId: provenance?.providerId,
            sessionId: provenance?.sessionId,
            provenance,
          });
        } catch {}
        const event = new CustomEvent('composer-block-click', {
          detail: { provenance, node, position: getPos() },
          bubbles: true,
          composed: true,
        });
        try { console.log('[ComposedContentNode] Dispatching composer-block-click'); } catch {}
        document.dispatchEvent(event);
        try { window.dispatchEvent(event as any); } catch {}
      });

      dom.addEventListener('mouseenter', () => { dom.style.background = `rgba(${rgbColor}, 0.12)`; });
      dom.addEventListener('mouseleave', () => { dom.style.background = `rgba(${rgbColor}, 0.05)`; });

      return { 
        dom, 
        contentDOM, 
        stopEvent: (e: Event) => {
          const target = e.target as Node | null;
          const isOnBadge = !!target && (target === badge || badge.contains(target as Node));
          return isOnBadge; // prevent PM from handling badge events
        },
        destroy: () => { hidePreview(); }
      };
    };
  }
});


// Custom event for block clicks
export interface ComposerBlockClickEvent extends CustomEvent {
  detail: {
    provenance: ProvenanceData;
    node: any;
    position: number;
  };
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    composedContent: {
      insertComposedContent: (options: {
        content: string;
        provenance: ProvenanceData;
        position?: number;
      }) => ReturnType;
      deleteComposedBlock: (position: number) => ReturnType;
    };
  }
}