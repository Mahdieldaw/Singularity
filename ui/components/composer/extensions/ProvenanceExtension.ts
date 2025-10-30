import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Extension } from '@tiptap/core';
import type { ProvenanceData } from './ComposedContentNode';

const ProvenancePluginKey = new PluginKey('provenance');

// Function to create badge DOM element with proper event handling
function createBadgeDOM(provenance: ProvenanceData) {
  const badge = document.createElement('button');
  badge.textContent = '↗';
  badge.className = 'provenance-badge';
  
  const baseProviderId = provenance.providerId.replace(/-(synthesis|mapping)$/, '');
  badge.setAttribute('data-provider', baseProviderId);
  
  // Make it non-editable and non-focusable
  badge.setAttribute('contenteditable', 'false');
  badge.setAttribute('tabindex', '-1');
  badge.setAttribute('role', 'button');
  badge.setAttribute('aria-label', `Jump to ${baseProviderId} source`);
  badge.title = `Click to jump to source (${baseProviderId})`;
  
  // Critical: Stop all event propagation to prevent PM interference
  const stopEvent = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };
  
  // Prevent all mouse events from reaching ProseMirror
  badge.addEventListener('mousedown', stopEvent);
  badge.addEventListener('mouseup', stopEvent);
  badge.addEventListener('pointerdown', stopEvent);
  badge.addEventListener('pointerup', stopEvent);
  
  // Handle click with full event stopping
  badge.addEventListener('click', (e) => {
    stopEvent(e);
    
    console.log('[ProvenanceExtension] Badge clicked', {
      aiTurnId: provenance.aiTurnId,
      providerId: provenance.providerId,
      sessionId: provenance.sessionId,
      provenance,
    });
    
    // Dispatch navigation event
    openReferenceView(provenance);
  });
  
  return badge;
}

// Navigation handler function
function openReferenceView(provenance: ProvenanceData) {
  // Dispatch custom event for navigation
  const event = new CustomEvent('composer-block-click', {
    detail: { provenance },
    bubbles: true,
    composed: true,
  });
  
  console.log('[ProvenanceExtension] Dispatching composer-block-click');
  document.dispatchEvent(event);
  
  // Also try window dispatch as fallback
  try {
    window.dispatchEvent(event as any);
  } catch (error) {
    console.warn('[ProvenanceExtension] Window dispatch failed:', error);
  }
}

export const ProvenanceExtension = Extension.create({
  name: 'provenance',
  
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: ProvenancePluginKey,
        
        state: {
          init(_, { doc }) {
            return DecorationSet.empty;
          },
          
          apply(tr, oldSet, _, newState) {
            // Map old decorations to new document
            let set = oldSet.map(tr.mapping, tr.doc);
            
            // Scan document for blocks with provenance and add badges
            const decos: Decoration[] = [];
            
            newState.doc.descendants((node, pos) => {
              // Check if this node has provenance data
              if (node.attrs && node.attrs.provenance) {
                const provenance = node.attrs.provenance as ProvenanceData;
                
                // Create widget decoration at the end of the block
                const widget = Decoration.widget(
                  pos + node.nodeSize,
                  createBadgeDOM(provenance),
                  {
                    side: 1, // Position after the node
                    key: `provenance-${provenance.aiTurnId}-${provenance.responseIndex}`,
                  }
                );
                
                decos.push(widget);
              }
            });
            
            return DecorationSet.create(tr.doc, decos);
          },
        },
        
        props: {
          decorations(state) {
            return this.getState(state);
          },
          
          // Handle DOM events to prevent interference with badge clicks
          handleDOMEvents: {
            click: (view, e) => {
              const target = e.target as HTMLElement;
              if (target && target.classList.contains('provenance-badge')) {
                // Let the badge handle its own click event
                return false;
              }
              return false; // Let other handlers process
            },
            
            mousedown: (view, e) => {
              const target = e.target as HTMLElement;
              if (target && target.classList.contains('provenance-badge')) {
                // Prevent ProseMirror from handling badge mousedown
                return true;
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});