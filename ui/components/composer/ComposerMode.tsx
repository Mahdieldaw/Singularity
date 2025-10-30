import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { DndContext, DragOverlay, useSensor, useSensors, MouseSensor, TouchSensor, pointerWithin } from '@dnd-kit/core';
import { useAtom } from 'jotai';
import { useComposer } from '../../hooks/useComposer';
import { CanvasEditorV2, CanvasEditorRef } from './CanvasEditorV2';
import { TurnMessage, AiTurn } from '../../types';
import ComposerToolbar from './ComposerToolbar';
import { NavigatorBar } from './NavigatorBar';
import { convertTurnMessagesToChatTurns, ChatTurn, ResponseBlock } from '../../types/chat';
import { DragData, isValidDragData, GhostData } from '../../types/dragDrop';
import { ProvenanceData } from './extensions/ComposedContentNode';
import ResponseViewer from './ResponseViewer';
import { Granularity } from '../../utils/segmentText';
import { SaveDialog } from './SaveDialog';
import type { DocumentRecord } from '../../types';
import DocumentsHistoryPanelConnected from '../DocumentsHistoryPanelConnected';
import { ReferenceZone } from './ReferenceZone';
import { PERSISTENCE_FEATURE_FLAGS } from '../../../src/persistence/index';
import { CanvasTray } from './CanvasTray';
import { CanvasTabData } from '../../types';
import { JSONContent } from '@tiptap/react';
import { viewModeAtom, messagesAtom, currentSessionIdAtom } from '../../state/atoms';
import { ViewMode } from '../../types';

const ComposerMode: React.FC = () => {
  const editorRef = useRef<CanvasEditorRef>(null);
  const [activeDragData, setActiveDragData] = useState<any>(null);
  const [selectedTurn, setSelectedTurn] = useState<ChatTurn | null>(null);
  const [selectedResponse, setSelectedResponse] = useState<ResponseBlock | undefined>();
  const [isDragging, setIsDragging] = useState(false);
  const [granularity, setGranularity] = useState<Granularity>('paragraph');
  const [currentTurnIndex, setCurrentTurnIndex] = useState(0);
  const [dragStartCoordinates, setDragStartCoordinates] = useState<{ x: number; y: number } | null>(null);
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [showDocumentsPanel, setShowDocumentsPanel] = useState(false);
  const [pinnedGhosts, setPinnedGhosts] = useState<GhostData[]>([]);
  const [isReferenceCollapsed, setIsReferenceCollapsed] = useState(false);
  const [ghostIdCounter, setGhostIdCounter] = useState(0);
  const [documentsRefreshTick, setDocumentsRefreshTick] = useState(0);
  const [showNavigatorBar, setShowNavigatorBar] = useState(true);
  const [showCanvasTray, setShowCanvasTray] = useState(true);
  const turnsRef = useRef<ChatTurn[]>([]);
  const isRefCollapsedRef = useRef<boolean>(false);
  const [refZoneMode, setRefZoneMode] = useState<'default' | 'canvas-focused' | 'expanded'>('default');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Global state from Jotai
  const [allTurns] = useAtom(messagesAtom);
  const [sessionId] = useAtom(currentSessionIdAtom);
  const [, setViewMode] = useAtom(viewModeAtom);

  // Hook-managed state + operations
  const {
    currentDocument,
    canvasTabs,
    activeCanvasId,
    isDirty,
    createNewDocument,
    loadDocument,
    saveCurrentDocument,
    updateActiveTabContent,
    setActiveCanvasId,
    setCanvasTabs,
    createGhost,
    loadGhosts,
    deleteGhost
  } = useComposer();

  const clearResetTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);
  const handleReferenceHover = useCallback(() => {
    clearResetTimeout();
    if (!isReferenceCollapsed) setRefZoneMode('expanded');
  }, [clearResetTimeout, isReferenceCollapsed]);
  const handleReferenceLeave = useCallback(() => {
    clearResetTimeout();
    timeoutRef.current = setTimeout(() => setRefZoneMode('default'), 2000);
  }, [clearResetTimeout]);
  const handleCanvasFocus = useCallback(() => {
    clearResetTimeout();
    setRefZoneMode('canvas-focused');
  }, [clearResetTimeout]);
  const handleCanvasBlur = useCallback(() => {
    clearResetTimeout();
    timeoutRef.current = setTimeout(() => setRefZoneMode('default'), 2000);
  }, [clearResetTimeout]);
  useEffect(() => { try { console.log('refZoneMode:', refZoneMode); } catch {} }, [refZoneMode]);

  const turns = useMemo(() => convertTurnMessagesToChatTurns(allTurns), [allTurns]);
  useEffect(() => { turnsRef.current = turns; }, [turns]);
  useEffect(() => { isRefCollapsedRef.current = isReferenceCollapsed; }, [isReferenceCollapsed]);

  const handleExit = () => setViewMode(ViewMode.CHAT);

  // Helper function to get current editor content
  const getCurrentContent = useCallback(() => {
    const jsonContent = editorRef.current?.getContent();
    return jsonContent ? JSON.stringify(jsonContent) : '';
  }, []);

  // Helper function to generate default title from content
  const generateDefaultTitle = useCallback((content: string) => {
    try {
      const jsonContent = JSON.parse(content);
      // Extract plain text from the JSON content
      const extractText = (node: any): string => {
        if (node.type === 'text') {
          return node.text || '';
        }
        if (node.content && Array.isArray(node.content)) {
          return node.content.map(extractText).join('');
        }
        return '';
      };
      
      const plainText = extractText(jsonContent).trim();
      const firstLine = plainText.split('\n')[0] || '';
      return firstLine.length > 50 ? firstLine.substring(0, 47) + '...' : firstLine || 'Untitled Document';
    } catch {
      return 'Untitled Document';
    }
  }, []);

  // Handle manual save
  const handleSave = useCallback(async (title: string) => {
    try {
      await saveCurrentDocument(title);
      setShowSaveDialog(false);
    } catch (e) {
      console.error('[ComposerMode] save failed:', e);
    }
  }, [saveCurrentDocument]);

  // Handle refine functionality
  const handleRefine = useCallback(async (content: string, model: string) => {
    setIsRefining(true);
    try {
      console.log('Refining content with model:', model);
      console.log('Content to refine:', content);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate API call
      console.log('Refine completed');
    } catch (error) {
      console.error('Error during refine:', error);
    } finally {
      setIsRefining(false);
    }
  }, []);

  // Handle content changes
  const handleContentChange = useCallback((json: JSONContent) => {
    updateActiveTabContent(json);
  }, [updateActiveTabContent]);

  // Sync main editor content when switching active canvas tab
  useEffect(() => {
    const active = canvasTabs.find(t => t.id === activeCanvasId);
    if (active && editorRef.current) {
      editorRef.current.setContent(active.content);
    }
  }, [activeCanvasId, canvasTabs]); // Added canvasTabs dependency

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 100,
        tolerance: 5,
      },
    })
  );

  const handleDragStart = useCallback((event: any) => {
    setActiveDragData(event.active.data.current);
    setIsDragging(true);
    
    if (event.activatorEvent) {
      const rect = document.body.getBoundingClientRect();
      setDragStartCoordinates({
        x: event.activatorEvent.clientX - rect.left,
        y: event.activatorEvent.clientY - rect.top
      });
      setPointerPos({ x: event.activatorEvent.clientX, y: event.activatorEvent.clientY });
    }
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const onPointerMove = (e: PointerEvent) => {
      setPointerPos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('pointermove', onPointerMove);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, [isDragging]);

  const handleDragEnd = useCallback((event: any) => {
     const { active, over } = event;

     if (over?.id === 'canvas-dropzone' && active?.data?.current) {
       const payload = active.data.current;

      let insertionPos: number | undefined = undefined;
      const editorAny = (editorRef.current as any);
      const pmView = editorAny?.editor?.view;
      if (pmView && typeof pmView.posAtCoords === 'function' && pointerPos) {
        const result = pmView.posAtCoords({ left: pointerPos.x, top: pointerPos.y });
        if (result?.pos) insertionPos = result.pos;
      }

       if (payload?.type === 'composer-block' && payload?.text && payload?.provenance) {
         const prov: ProvenanceData = {
           ...payload.provenance,
           timestamp: typeof payload.provenance.timestamp === 'number' ? payload.provenance.timestamp : Date.now(),
         };
        editorRef.current?.insertComposedContent(payload.text, prov, insertionPos);
       } else {
         const dragData: DragData = payload;
         if (isValidDragData(dragData)) {
           const mapGranularity = (g: DragData['metadata']['granularity']): ProvenanceData['granularity'] => {
             switch (g) {
               case 'paragraph': return 'paragraph';
               case 'sentence': return 'sentence';
               case 'word':
               case 'phrase': return 'sentence';
               case 'response':
               case 'turn':
               default: return 'full';
             }
           };

           const providerIdFull = dragData.metadata.providerId;
           const responseType: ProvenanceData['responseType'] = /-synthesis$/.test(providerIdFull)
             ? 'synthesis'
             : /-mapping$/.test(providerIdFull)
             ? 'mapping'
             : 'batch';

           const baseProv: ProvenanceData | undefined = (payload && (payload as any).provenance) as ProvenanceData | undefined;
           const provenance: ProvenanceData = {
             ...(baseProv || {
               sessionId: sessionId || 'current',
               aiTurnId: dragData.metadata.turnId,
               providerId: providerIdFull,
               responseType,
               responseIndex: 0,
               granularity: mapGranularity(dragData.metadata.granularity),
             }),
             timestamp: Date.now(),
             sourceText: baseProv?.sourceText || dragData.metadata.sourceContext?.fullResponse || dragData.content,
             sourceContext: baseProv?.sourceContext || (dragData.metadata.sourceContext ? { fullResponse: dragData.metadata.sourceContext.fullResponse } : undefined),
           } as ProvenanceData;

           editorRef.current?.insertComposedContent(
             dragData.content,
             provenance,
             insertionPos
           );
         }
       }
     }

     setActiveDragData(null);
     setIsDragging(false);
     setDragStartCoordinates(null);
     setPointerPos(null);
   }, [sessionId, pointerPos]);

  const handleTurnSelect = useCallback((index: number) => {
    setCurrentTurnIndex(index);
    setSelectedTurn(turns[index] || null);
    setSelectedResponse(undefined);
  }, [turns]);

  const handleSelectDocument = useCallback((doc: any) => {
    loadDocument(doc.id || doc);
    setShowDocumentsPanel(false);
  }, [loadDocument]);

  const handleNewDocument = useCallback(() => {
    createNewDocument();
    setShowDocumentsPanel(false);
  }, [createNewDocument]);

  const handleDeleteDocument = useCallback(async (documentId: string) => {
    // This is now handled by DocumentsHistoryPanelConnected
  }, []);

  const handleResponsePickFromRail = useCallback((turnIndex: number, providerId: string, content: string) => {
    const turn = turns[turnIndex];
    if (!turn) return;
    setCurrentTurnIndex(turnIndex);
    setSelectedTurn(turn);
    const resp: ResponseBlock | undefined = turn.responses.find(r => r.providerId === providerId) || {
      id: `${turn.id}-picked-${providerId}`,
      content,
      providerId,
    } as ResponseBlock;
    setSelectedResponse(resp);
  }, [turns]);

  const handlePinSegment = useCallback(async (text: string, provenance: ProvenanceData) => {
    const documentId = currentDocument?.id || 'scratch';
    try {
      const newGhost = await createGhost(documentId, text, provenance);
      if (newGhost) {
        setPinnedGhosts(prev => [...prev, newGhost]);
      }
    } catch (error) {
      console.error('[ComposerMode] Failed to pin ghost:', error);
    }
  }, [createGhost, currentDocument]);

  const handleUnpinGhost = useCallback(async (ghostId: string) => {
    try {
      await deleteGhost(ghostId);
      setPinnedGhosts(prev => prev.filter(g => g.id !== ghostId));
    } catch (error) {
      console.error('[ComposerMode] Failed to unpin ghost:', error);
    }
  }, [deleteGhost]);

  const handleExtractToMainFromCanvas = useCallback((content: string, provenance: ProvenanceData) => {
    if (editorRef.current) {
      editorRef.current.insertComposedContent(content, provenance);
      const json = editorRef.current.getContent();
      updateActiveTabContent(json);
    }
  }, [updateActiveTabContent]);

  const handleCanvasTabsChange = useCallback((tabs: CanvasTabData[]) => {
    setCanvasTabs(tabs);
  }, [setCanvasTabs]);

  const handleExtractToCanvas = useCallback((text: string, provenance: ProvenanceData) => {
    if (editorRef.current) {
      editorRef.current.insertComposedContent(text, provenance);
      const json = editorRef.current.getContent();
      updateActiveTabContent(json);
    }
  }, [updateActiveTabContent]);

  useEffect(() => {
    const handleBlockClick = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { provenance } = (customEvent.detail || {}) as { provenance?: ProvenanceData };
      if (!provenance) return;
      const aiTurnId = String(provenance.aiTurnId ?? '');
      const providerIdFull = String(provenance.providerId ?? '');
      const baseProviderId = providerIdFull.replace(/-(synthesis|mapping)$/,'');
      const tlist = turnsRef.current || [];

      let turnIndex = tlist.findIndex(t => t.id === aiTurnId);
      if (turnIndex === -1) {
        const num = aiTurnId.replace(/\D+/g, '');
        if (num) {
          turnIndex = tlist.findIndex(t => (t.id || '').toString().replace(/\D+/g, '') === num);
        }
      }

      if (turnIndex !== -1) {
        setCurrentTurnIndex(turnIndex);
        const turn = tlist[turnIndex];
        setSelectedTurn(turn);

        if (turn.type === 'ai') {
          const responses = turn.responses || [];
          let response = responses.find(r => r.providerId === providerIdFull);
          if (!response) {
            const typeSuffix = providerIdFull.endsWith('-synthesis') ? '-synthesis' : providerIdFull.endsWith('-mapping') ? '-mapping' : '';
            if (typeSuffix) {
              response = responses.find(r => r.providerId.replace(/-(synthesis|mapping)$/,'') === baseProviderId && r.providerId.endsWith(typeSuffix));
            }
          }
          if (!response) {
            response = responses.find(r => r.providerId.replace(/-(synthesis|mapping)$/,'') === baseProviderId);
          }
          if (!response && typeof provenance.responseIndex === 'number') {
            const candidates = responses.filter(r => r.providerId.replace(/-(synthesis|mapping)$/,'') === baseProviderId);
            if (candidates[provenance.responseIndex]) response = candidates[provenance.responseIndex];
          }
          setSelectedResponse(response);
        } else {
          setSelectedResponse(undefined);
        }

        if (isRefCollapsedRef.current) {
          setIsReferenceCollapsed(false);
        }
      }
    };
    document.addEventListener('composer-block-click', handleBlockClick);
    return () => document.removeEventListener('composer-block-click', handleBlockClick);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
        e.preventDefault();
        setIsReferenceCollapsed(prev => !prev);
      }
      
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const turnIndex = parseInt(e.key) - 1;
        if (turnIndex < turns.length) {
          setCurrentTurnIndex(turnIndex);
          setSelectedTurn(turns[turnIndex]);
          setSelectedResponse(undefined);
        }
      }
      
      if (e.shiftKey && e.key === 'P' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        console.log('[ComposerMode] Shift+P pressed - pin last segment (not yet implemented)');
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [turns, isReferenceCollapsed]);

  return (
    <div style={{ height: '100vh', maxHeight: '100vh', width: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box', padding: 0 }}>
      <ComposerToolbar 
        editorRef={editorRef}
        onExit={handleExit}
        onSave={() => {
          const content = getCurrentContent();
          const defaultTitle = generateDefaultTitle(content);
          setShowSaveDialog(true);
        }}
        onRefine={handleRefine}
        onToggleDocuments={() => setShowDocumentsPanel(!showDocumentsPanel)}
        isRefining={isRefining}
        showDocumentsPanel={showDocumentsPanel}
        isDirty={isDirty}
        isSaving={isSaving}
      />

      {showNavigatorBar && (
        <NavigatorBar
          turns={turns}
          currentTurnIndex={currentTurnIndex}
          onSelectTurn={handleTurnSelect}
        />
      )}

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          collisionDetection={pointerWithin}
        >
          <div style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'row',
            gap: 0,
            width: '100%',
            boxSizing: 'border-box',
            overflow: 'hidden'
          }}>
            {(() => {
              const refPct = refZoneMode === 'expanded' ? 50 : refZoneMode === 'canvas-focused' ? 30 : 40;
              const docPx = showDocumentsPanel ? 280 : 0;
              const refWidth = isReferenceCollapsed ? '40px' : `${refPct}%`;
              const canvasWidth = isReferenceCollapsed
                ? `calc(100% - ${docPx}px - 40px)`
                : `calc(100% - ${docPx}px - ${refPct}%)`;
              return (
                <>
                  <div
                    style={{
                      minWidth: 0,
                      overflow: 'hidden',
                      margin: 0,
                      flex: `0 0 ${refWidth}`,
                      width: refWidth,
                      transition: 'width 250ms ease'
                    }}
                    onMouseEnter={handleReferenceHover}
                    onMouseLeave={handleReferenceLeave}
                  >
              <ReferenceZone
                turn={selectedTurn || turns[currentTurnIndex] || null}
                response={selectedResponse}
                granularity={granularity}
                onGranularityChange={setGranularity}
                pinnedGhosts={pinnedGhosts}
                onPinSegment={handlePinSegment}
                onUnpinGhost={handleUnpinGhost}
                isCollapsed={isReferenceCollapsed}
                onToggleCollapse={() => setIsReferenceCollapsed(prev => !prev)}
                onSelectResponse={(providerId) => {
                  const turn = (selectedTurn || turns[currentTurnIndex]);
                  if (!turn || turn.type === 'user') return;
                  let resp = turn.responses?.find(r => r.providerId === providerId);
                  if (!resp) {
                    const base = providerId.replace(/-(synthesis|mapping)$/,'');
                    resp = turn.responses?.find(r => r.providerId.replace(/-(synthesis|mapping)$/,'') === base);
                  }
                  setSelectedResponse(resp);
                }}
                onExtractToCanvas={handleExtractToCanvas}
              />
                  </div>
                  <div
                    style={{
                      minWidth: 0,
                      overflow: 'hidden',
                      margin: 0,
                      flex: `0 0 ${canvasWidth}`,
                      width: canvasWidth,
                      transition: 'width 250ms ease'
                    }}
                    onMouseEnter={handleCanvasFocus}
                    onMouseLeave={handleCanvasBlur}
                    onClick={handleCanvasFocus}
                    onFocus={handleCanvasFocus}
                    onBlur={handleCanvasBlur}
                    tabIndex={0}
                  >
              <CanvasEditorV2
                ref={editorRef}
                placeholder="Drag content here to compose..."
                onChange={handleContentChange}
                onInteraction={handleCanvasFocus}
              />
                  </div>
                </>
              );
            })()}
            {showDocumentsPanel && (
              <div style={{ minWidth: 0, overflow: 'hidden', width: '280px', flex: '0 0 280px', margin: 0 }}>
                <DocumentsHistoryPanelConnected
                  isOpen={showDocumentsPanel}
                  onSelectDocument={handleSelectDocument}
                  onNewDocument={handleNewDocument}
                />
              </div>
            )}
          </div>

          <DragOverlay
            style={dragStartCoordinates ? {
              transform: `translate(${dragStartCoordinates.x}px, ${dragStartCoordinates.y}px)`,
              transformOrigin: 'top left'
            } : undefined}
          >
            {isDragging && activeDragData && (
              <div style={{
                background: '#1e293b',
                border: '1px solid #8b5cf6',
                borderRadius: '8px',
                padding: '12px',
                maxWidth: '300px',
                color: '#e2e8f0',
                fontSize: '13px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                pointerEvents: 'none',
              }}>
                {(activeDragData.text || activeDragData.content || '').toString().substring(0, 100)}...
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {showCanvasTray && (
        <CanvasTray
          tabs={canvasTabs}
          activeTabId={activeCanvasId}
          onActivateTab={setActiveCanvasId}
          onTabsChange={handleCanvasTabsChange}
        />
      )}

      <SaveDialog
        isOpen={showSaveDialog}
        onClose={() => setShowSaveDialog(false)}
        onSave={handleSave}
        defaultTitle={generateDefaultTitle(getCurrentContent())}
        isSaving={isSaving}
      />

      <style>{`
        .source-panel,
        .canvas-panel {
          height: 100%;
          border-radius: 8px;
          background-color: #1e293b;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          display: flex;
          flex-direction: column;
        }

        .canvas-panel {
          flex-grow: 1;
          position: relative;
        }
      `}</style>
    </div>
  );
};

export default ComposerMode;
