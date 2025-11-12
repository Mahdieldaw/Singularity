import React, { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { useAtom } from 'jotai';
import { scratchpadOpenAtom, scratchpadHeightAtom, activeCanvasIdAtom, canvasTabsAtom, scratchpadDragActiveAtom, scratchpadLeftBlocksAtom, scratchpadRightContentAtom, currentSessionIdAtom } from '../state/atoms';
import { useComposer } from '../hooks/useComposer';
import CanvasEditorV2, { CanvasEditorRef } from './composer/CanvasEditorV2';
import { useDroppable } from '@dnd-kit/core';

/**
 * ScratchpadDrawer
 * Lightweight composer embedded as a bottom drawer in ChatView.
 * - Uses existing composer atoms and hooks for persistence (DocumentRecord)
 * - Provides a collapsible panel with a TipTap editor (CanvasEditorV2)
 * - Future: add pinned Ghosts, refine-in-place controls, and drag/drop sources
 */
export default function ScratchpadDrawer() {
  const [open, setOpen] = useAtom(scratchpadOpenAtom);
  const [height, setHeight] = useAtom(scratchpadHeightAtom);
  const [dragActive] = useAtom(scratchpadDragActiveAtom);
  const [leftBlocks, setLeftBlocks] = useAtom(scratchpadLeftBlocksAtom);
  const [rightContent, setRightContent] = useAtom(scratchpadRightContentAtom);
  const [currentSessionId] = useAtom(currentSessionIdAtom);

  const {
    currentDocument,
    canvasTabs,
    activeCanvasId,
    saveCurrentDocument,
    updateActiveTabContent,
    createNewDocument,
  } = useComposer();

  const centerEditorRef = useRef<CanvasEditorRef | null>(null);
  const rightEditorRef = useRef<CanvasEditorRef | null>(null);
  const activeTab = useMemo(() => canvasTabs.find(t => t.id === activeCanvasId) || null, [canvasTabs, activeCanvasId]);

  const backendAvailable = typeof chrome !== 'undefined' && !!(chrome as any)?.runtime?.id;

  // Ensure a document exists when opening the drawer
  useEffect(() => {
    if (!open) return;
    if (!currentDocument && canvasTabs.length === 0) {
      createNewDocument();
    }
  }, [open, currentDocument, canvasTabs.length, createNewDocument]);

  const onSave = async () => {
    try {
      const title = currentDocument?.title || 'Scratchpad';
      await saveCurrentDocument(title);
    } catch (e) {
      console.warn('[Scratchpad] Save failed. Backend unavailable in preview?', e);
    }
  };

  const onClear = () => {
    centerEditorRef.current?.clear();
    // Update atom content to empty TipTap doc
    updateActiveTabContent({ type: 'doc', content: [] } as any);
  };

  const toggleOpen = () => setOpen(v => !v);

  // Style helpers
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    borderTop: '1px solid rgba(148,163,184,0.2)',
    background: 'rgba(2,6,23,0.75)',
    position: 'relative',
    zIndex: dragActive ? 9999 : (open ? 20 : 'auto'),
    transition: 'z-index 0.2s ease',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: dragActive && !open ? '8px 10px' : '6px 8px',
    background: 'rgba(2, 6, 23, 0.85)',
    borderBottom: open ? '1px solid rgba(148,163,184,0.15)' : 'none',
    boxShadow: dragActive && !open ? '0 -4px 18px rgba(0,0,0,0.45)' : 'none',
    position: 'relative',
  };

  const buttonStyle: React.CSSProperties = {
    fontSize: '12px',
    padding: '4px 8px',
    borderRadius: '6px',
    border: '1px solid rgba(148,163,184,0.35)',
    background: 'rgba(30,41,59,0.5)',
    color: '#e5e7eb',
    cursor: 'pointer',
    marginLeft: 6,
  };

  const resizeHandleStyle: React.CSSProperties = {
    height: '4px',
    cursor: 'ns-resize',
    background: 'rgba(148,163,184,0.15)'
  };

  // Queue pending inserts for center/right columns when editors aren't mounted
  const pendingQueueRef = useRef<Array<{ text: string; provenance: any; targetColumn?: 'left' | 'center' | 'right' }>>([]);

  // Floating click-to-place snippet state
  const [floatingSnippet, setFloatingSnippet] = useState<{
    text: string;
    provenance: any;
    x: number;
    y: number;
    mode?: 'move' | 'copy';
    origin?: { from: number; to: number };
  } | null>(null);

  // Center selection state for floating actions
  const [centerSelection, setCenterSelection] = useState<{ from: number; to: number; text: string } | null>(null);
  const [selectionMenuPos, setSelectionMenuPos] = useState<{ left: number; top: number } | null>(null);
  const centerColumnRef = useRef<HTMLDivElement | null>(null);
  const rightColumnRef = useRef<HTMLDivElement | null>(null);
  const [rightCaret, setRightCaret] = useState<{ left: number; top: number; height: number } | null>(null);

  // Simple debounce utility (avoid extra deps)
  const makeDebounce = useCallback(<T,>(fn: (arg: T) => void, delay: number) => {
    let timer: any;
    return (arg: T) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fn(arg), delay);
    };
  }, []);

  // Debounced updates to reduce re-renders/persistence writes
  const debouncedUpdateCenter = useMemo(() => makeDebounce<any>((json) => {
    updateActiveTabContent(json);
  }, 300), [makeDebounce, updateActiveTabContent]);

  const debouncedUpdateRight = useMemo(() => makeDebounce<any>((json) => {
    setRightContent(json);
  }, 300), [makeDebounce, setRightContent]);

  // Ensure provenance objects include all required fields
  const normalizeProvenance = useCallback((prov: any, text: string) => {
    const base = prov || {};
    const complete = {
      sessionId: base.sessionId || currentSessionId || 'unknown',
      aiTurnId: base.aiTurnId || 'unknown',
      providerId: base.providerId || 'unknown',
      responseType: base.responseType || 'batch',
      responseIndex: typeof base.responseIndex === 'number' ? base.responseIndex : 0,
      timestamp: typeof base.timestamp === 'number' ? base.timestamp : Date.now(),
      granularity: base.granularity || ('full' as const),
      sourceText: base.sourceText || String(text || ''),
      ...base,
    };
    return complete;
  }, [currentSessionId]);

  const flushPending = useCallback(() => {
    if (!pendingQueueRef.current.length) return;
    const nextQueue: typeof pendingQueueRef.current = [];
    for (const item of pendingQueueRef.current) {
      const { text, provenance, targetColumn } = item;
      if (!text) continue;
      const completeProvenance = normalizeProvenance(provenance, text);
      if (targetColumn === 'right') {
        if (rightEditorRef.current) {
          rightEditorRef.current.insertComposedContent(text, completeProvenance);
        } else {
          nextQueue.push(item);
        }
      } else {
        if (centerEditorRef.current) {
          centerEditorRef.current.insertComposedContent(text, completeProvenance);
        } else {
          nextQueue.push(item);
        }
      }
    }
    pendingQueueRef.current = nextQueue;
  }, [normalizeProvenance]);

  // Listen for extract-to-canvas events dispatched by ProviderResponseBlock and others
  useEffect(() => {
    const handler = (evt: Event) => {
      try {
        const detail = (evt as CustomEvent<any>).detail || {};
        const text = String(detail.text || '');
        const provenance = normalizeProvenance(detail.provenance || { source: 'unknown', timestamp: Date.now() }, text);
        const targetColumn: 'left' | 'center' | 'right' = detail.targetColumn || 'center';
        if (!text) return;
        if (targetColumn === 'left') {
          // Append into Gather blocks immediately (works even when collapsed)
          setLeftBlocks(prev => [...prev, { text, provenance, timestamp: Date.now() }]);
          return;
        }
        // Ensure the drawer is open and queue for appropriate editor
        setOpen(true);
        pendingQueueRef.current.push({ text, provenance, targetColumn });
        flushPending();
      } catch (e) {
        console.warn('scratchpad: failed to handle extract-to-canvas event', e);
      }
    };
    document.addEventListener('extract-to-canvas', handler as EventListener);
    return () => document.removeEventListener('extract-to-canvas', handler as EventListener);
  }, [setOpen, setLeftBlocks, flushPending, normalizeProvenance]);

  // Flush after open when editors mount
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => flushPending());
    return () => cancelAnimationFrame(id);
  }, [open, flushPending]);

  // Collapsed header droppable zone
  const { isOver: isHeaderOver, setNodeRef: setHeaderNodeRef } = useDroppable({ id: 'scratchpad-header-dropzone', data: { type: 'scratchpad-header' } });
  // Gather column droppable zone
  const { isOver: isGatherOver, setNodeRef: setGatherNodeRef } = useDroppable({ id: 'scratchpad-gather-dropzone', data: { type: 'scratchpad-gather' } });

  const columnStyle: React.CSSProperties = {
    flex: 1,
    borderRight: '1px solid rgba(148,163,184,0.1)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minWidth: 0,
  };

  const moveToCenter = useCallback((block: any, index: number) => {
    try {
      const text = String(block?.text || '');
      const completeProvenance = normalizeProvenance(block?.provenance || {}, text);
      centerEditorRef.current?.insertComposedContent(text, completeProvenance);
      setLeftBlocks(prev => prev.filter((_, i) => i !== index));
      setOpen(true);
    } catch (e) {
      console.warn('[Scratchpad] moveToCenter failed', e);
    }
  }, [setLeftBlocks, setOpen, normalizeProvenance]);

  // Pick up a snippet to place by click
  const pickUpSnippet = useCallback((block: any, index: number) => {
    try {
      const text = String(block?.text || '');
      const completeProvenance = normalizeProvenance(block?.provenance || {}, text);
      setFloatingSnippet({ text, provenance: completeProvenance, x: 0, y: 0 });
      setOpen(true);
    } catch (e) {
      console.warn('[Scratchpad] pickUpSnippet failed', e);
    }
  }, [normalizeProvenance, setOpen]);

  // Track mouse for floating preview and allow ESC to cancel
  useEffect(() => {
    if (!floatingSnippet) return;
    const onMove = (ev: MouseEvent) => {
      setFloatingSnippet(prev => (prev ? { ...prev, x: ev.clientX, y: ev.clientY } : prev));
      // Update insertion caret in Refined column when placing selection there
      try {
        if (rightEditorRef.current && rightColumnRef.current) {
          const pos = rightEditorRef.current.getPosAtCoords(ev.clientX, ev.clientY);
          if (typeof pos === 'number') {
            const coords = rightEditorRef.current.getCoordsAtPos(pos);
            if (coords) {
              const rect = rightColumnRef.current.getBoundingClientRect();
              setRightCaret({ left: coords.left, top: Math.max(coords.top, rect.top) - 2, height: Math.min(coords.bottom, rect.bottom) - Math.max(coords.top, rect.top) });
            } else {
              setRightCaret(null);
            }
          } else {
            setRightCaret(null);
          }
        }
      } catch { /* noop */ }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setFloatingSnippet(null);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('keydown', onKey);
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'copy';
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('keydown', onKey);
      document.body.style.cursor = prevCursor;
      setRightCaret(null);
    };
  }, [floatingSnippet]);

  const placeSnippetInto = useCallback((target: 'center' | 'right', e: React.MouseEvent) => {
    if (!floatingSnippet) {
      if (target === 'center') centerEditorRef.current?.focus();
      else rightEditorRef.current?.focus();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const { text, provenance, mode, origin } = floatingSnippet;
    if (mode) {
      // Insert plain text into Refined (selection transfer)
      const content = { type: 'text', text } as any;
      rightEditorRef.current?.insertAtCoords(e.clientX, e.clientY, content);
      // Remove original selection if moving
      if (mode === 'move' && origin && typeof origin.from === 'number' && typeof origin.to === 'number') {
        centerEditorRef.current?.deleteRange(origin.from, origin.to);
      }
    } else {
      // Insert provenance block into target column
      const providerId = provenance?.providerId || 'unknown';
      const turnId = provenance?.aiTurnId || provenance?.userTurnId || '';
      const responseType = provenance?.responseType || 'batch';
      const sessionId = provenance?.sessionId || currentSessionId || 'unknown';
      const node = {
        type: 'scratchpadBlock',
        attrs: { providerId, turnId, responseType, sessionId },
        content: [{ type: 'text', text }]
      } as any;
      if (target === 'center') {
        centerEditorRef.current?.insertAtCoords(e.clientX, e.clientY, node);
      } else {
        rightEditorRef.current?.insertAtCoords(e.clientX, e.clientY, node);
      }
    }
    setFloatingSnippet(null);
  }, [floatingSnippet]);

  return (
    <div className="scratchpad-drawer" style={containerStyle}>
      <div ref={setHeaderNodeRef as any} style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button aria-label={open ? 'Collapse scratchpad' : 'Expand scratchpad'} onClick={toggleOpen} style={buttonStyle}>
            {open ? '▾' : '▴'}
          </button>
          <span style={{ fontSize: 13, color: '#cbd5e1' }}>Scratchpad</span>
          {currentDocument?.title && (
            <span style={{ fontSize: 12, color: '#94a3b8' }} title={currentDocument.title}>· {currentDocument.title}</span>
          )}
          {!open && (
            <span style={{ marginLeft: 8, fontSize: 11, color: isHeaderOver ? '#a5b4fc' : '#64748b', padding: '2px 6px', borderRadius: 6, border: isHeaderOver ? '1px dashed #6366f1' : '1px solid rgba(148,163,184,0.15)', background: isHeaderOver ? 'rgba(99,102,241,0.10)' : 'transparent' }}>
              {isHeaderOver ? 'Drop to Gather' : 'Drag here to collect'}
            </span>
          )}
        </div>
        <div>
          <button onClick={onSave} style={{ ...buttonStyle, ...(backendAvailable ? {} : { opacity: 0.6, cursor: 'not-allowed' }) }} disabled={!backendAvailable}>Save</button>
          <button onClick={onClear} style={buttonStyle}>Clear</button>
        </div>
      </div>

      {open && (
        <div style={{ height, display: 'flex', flexDirection: 'column' }}>
          <div
            role="separator"
            aria-label="Resize scratchpad"
            style={resizeHandleStyle}
            onMouseDown={(e) => {
              const startY = e.clientY;
              const startHeight = height;
              const onMove = (ev: MouseEvent) => {
                const delta = startY - ev.clientY;
                const next = Math.min(Math.max(startHeight + delta, 200), 560);
                setHeight(next);
              };
              const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
              };
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
          />
          {/* Three Columns: Gather / Working / Refined */}
          <div style={{ flex: 1, minHeight: 0, padding: 8, display: 'flex', gap: 8, overflow: 'hidden' }}>
            {/* Left: Gather */}
            <div ref={setGatherNodeRef as any} style={{ ...columnStyle, background: 'rgba(15,23,42,0.4)', maxWidth: '25%', outline: isGatherOver ? '2px dashed #6366f1' : 'none', outlineOffset: isGatherOver ? '-2px' : undefined }}>
              <div style={{ padding: 4, fontSize: 11, color: '#64748b', borderBottom: '1px solid #334155' }}>📥 Gather</div>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 6 }}>
                {leftBlocks.length === 0 && (
                  <div style={{ fontSize: 12, color: '#64748b', padding: 6 }}>Drag or drop snippets here to collect</div>
                )}
                {leftBlocks.map((block, i) => (
                  <div key={i} style={{ margin: 4, padding: 6, background: 'rgba(30,41,59,0.5)', borderRadius: 6, fontSize: 12, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={block.text}>{String(block.text || '').slice(0, 140)}</div>
                    <button
                      onClick={() => setLeftBlocks(prev => prev.filter((_, j) => j !== i))}
                      aria-label="Delete block"
                      title="Remove from Gather"
                      style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid #334155', background: 'rgba(220,38,38,0.15)', color: '#fca5a5', cursor: 'pointer' }}
                    >×</button>
                    <button onClick={() => moveToCenter(block, i)} style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid #334155', background: '#1d4ed8', color: '#ffffff', cursor: 'pointer' }}>→</button>
                    <button onClick={() => pickUpSnippet(block, i)} style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid #334155', background: 'rgba(99,102,241,0.25)', color: '#a5b4fc', cursor: 'copy' }}>✋ Place</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Center: Working */}
            <div style={{ ...columnStyle, flex: 2 }}>
              <div style={{ padding: 4, fontSize: 11, color: '#64748b', borderBottom: '1px solid #334155' }}>✏️ Working</div>
              <div
                ref={centerColumnRef}
                style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', cursor: floatingSnippet ? 'copy' : 'text', padding: '8px', position: 'relative' }}
                onClick={(e) => placeSnippetInto('center', e)}
              >
                <CanvasEditorV2
                  ref={centerEditorRef}
                  placeholder="Working space..."
                  initialContent={(activeTab?.content as any) || { type: 'doc', content: [] }}
                  onChange={debouncedUpdateCenter}
                  onSelectionChange={(sel) => {
                    // Show floating actions when a non-empty selection exists
                    if (sel && sel.text && sel.text.trim().length > 0) {
                      setCenterSelection(sel);
                      try {
                        const coords = centerEditorRef.current?.getCoordsAtPos(sel.from);
                        const top = (coords?.top || 0) - 32; // show above selection start
                        const left = (coords?.left || 0) + 8;
                        setSelectionMenuPos({ left, top });
                      } catch { setSelectionMenuPos(null); }
                    } else {
                      setCenterSelection(null);
                      setSelectionMenuPos(null);
                    }
                  }}
                  className="scratchpad-editor"
                />
                {/* Floating selection menu */}
                {centerSelection && selectionMenuPos && (
                  <div style={{ position: 'fixed', left: Math.min(selectionMenuPos.left, window.innerWidth - 260), top: Math.max(selectionMenuPos.top, 64), zIndex: 10000, background: 'rgba(2,6,23,0.95)', border: '1px solid rgba(148,163,184,0.35)', borderRadius: 8, padding: '6px 8px', color: '#e2e8f0', fontSize: 12, display: 'flex', gap: 8, boxShadow: '0 2px 12px rgba(0,0,0,0.35)' }}>
                    <button onClick={() => {
                      // Copy selection to Refined via click-to-place
                      setFloatingSnippet({ text: centerSelection.text, provenance: { providerId: 'user', responseType: 'selection', userTurnId: 'center' }, x: 0, y: 0, mode: 'copy', origin: { from: centerSelection.from, to: centerSelection.to } });
                    }} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #334155', background: 'rgba(99,102,241,0.25)', color: '#a5b4fc', cursor: 'copy' }}>Copy to Refined →</button>
                    <button onClick={() => {
                      // Move selection to Refined via click-to-place (remove from center after placement)
                      setFloatingSnippet({ text: centerSelection.text, provenance: { providerId: 'user', responseType: 'selection', userTurnId: 'center' }, x: 0, y: 0, mode: 'move', origin: { from: centerSelection.from, to: centerSelection.to } });
                    }} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #334155', background: '#1d4ed8', color: '#ffffff', cursor: 'copy' }}>Move to Refined →</button>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Refined */}
            <div ref={rightColumnRef} style={{ ...columnStyle, borderRight: 'none', maxWidth: '30%', position: 'relative' }}>
              <div style={{ padding: 4, fontSize: 11, color: '#64748b', borderBottom: '1px solid #334155' }}>✨ Refined</div>
              <div
                style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', cursor: floatingSnippet ? 'copy' : 'text' }}
                onClick={(e) => placeSnippetInto('right', e)}
              >
                <CanvasEditorV2
                  ref={rightEditorRef}
                  placeholder="Final version..."
                  initialContent={rightContent as any}
                  onChange={debouncedUpdateRight}
                />
                {/* Insertion caret visualization for Refined */}
                {floatingSnippet && rightCaret && (
                  <div style={{ position: 'fixed', left: rightCaret.left, top: rightCaret.top, width: 2, height: Math.max(14, rightCaret.height), background: '#3b82f6', pointerEvents: 'none', zIndex: 10000 }} />
                )}
              </div>
            </div>
          </div>
          {floatingSnippet && (
            <div style={{ position: 'fixed', left: Math.min(floatingSnippet.x + 16, window.innerWidth - 240), top: Math.min(floatingSnippet.y + 16, window.innerHeight - 80), pointerEvents: 'none', zIndex: 999999, background: 'rgba(2,6,23,0.95)', border: '1px solid rgba(148,163,184,0.35)', color: '#e2e8f0', borderRadius: 8, padding: '6px 8px', fontSize: 12, maxWidth: 260, boxShadow: '0 2px 12px rgba(0,0,0,0.35)' }}>
              <div style={{ marginBottom: 4, color: '#94a3b8', fontSize: 11 }}>
                {floatingSnippet.mode ? '📍 Click to place in Refined' : 'Click to place'}
              </div>
              {String(floatingSnippet.text || '').slice(0, 220)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}