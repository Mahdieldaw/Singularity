// src/ui/hooks/useComposer.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAtom } from 'jotai';
import { Draft } from 'immer';
import {
  currentDocumentAtom,
  canvasTabsAtom,
  activeCanvasIdAtom,
  isComposerDirtyAtom,
  documentsRefreshTickAtom,
  currentSessionIdAtom
} from '../state/atoms';
import api from '../services/extension-api';
import type { DocumentRecord, CanvasTabData } from '../types';
import type { JSONContent } from '@tiptap/react';

type JSONContentAny = JSONContent | any;

export function useComposer() {
  const [currentDocument, setCurrentDocument] = useAtom(currentDocumentAtom);
  const [canvasTabs, setCanvasTabs] = useAtom(canvasTabsAtom);
  const [activeCanvasId, setActiveCanvasId] = useAtom(activeCanvasIdAtom);
  const [isDirty, setIsDirty] = useAtom(isComposerDirtyAtom);
  const [, refreshDocuments] = useAtom(documentsRefreshTickAtom);
  const [currentSessionId] = useAtom(currentSessionIdAtom);

  const [lastSavedContent, setLastSavedContent] = useState<string>('');
  const saveInFlightRef = useRef(false);

  // performSave as stable callback
  const performSave = useCallback(async (title: string, isAutoSave = false) => {
    const activeTab = canvasTabs.find(t => t.id === activeCanvasId);
    if (!activeTab) return;

    // Extract inner TipTap content array safely
    const contentArray = Array.isArray((activeTab.content as any)?.content)
      ? (activeTab.content as any).content
      : [];

    const docToSave: DocumentRecord = currentDocument
      ? {
          ...currentDocument,
          title,
          canvasContent: contentArray,
          canvasTabs,
          activeTabId: activeCanvasId ?? undefined,
          updatedAt: Date.now(),
          lastModified: Date.now()
        }
      : {
          id: `doc-${Date.now()}`,
          title,
          sourceSessionId: currentSessionId || undefined,
          canvasContent: contentArray,
          canvasTabs,
          activeTabId: activeCanvasId ?? undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastModified: Date.now(),
          version: 1,
          isDirty: false,
          blockCount: contentArray.length,
          refinementHistory: [],
          exportHistory: [],
          snapshots: [],
          granularity: 'paragraph'
        };

    await api.saveDocument(docToSave);

    if (!currentDocument) setCurrentDocument(docToSave);
    setIsDirty(false);
    setLastSavedContent(JSON.stringify(activeTab.content));
    if (!isAutoSave) refreshDocuments(t => t + 1);
  }, [canvasTabs, activeCanvasId, currentDocument, currentSessionId, setCurrentDocument, setIsDirty, refreshDocuments]);

  // Autosave effect (15s) with single inflight guard
  useEffect(() => {
    if (!isDirty) return;
    const timer = setInterval(async () => {
      if (saveInFlightRef.current) return;
      const activeTab = canvasTabs.find(t => t.id === activeCanvasId);
      if (!activeTab) return;
      const currentContent = JSON.stringify(activeTab.content || { type: 'doc', content: [] });
      if (currentContent === lastSavedContent) return;
      if (currentContent.trim() === '{"type":"doc","content":[]}') return;

      try {
        saveInFlightRef.current = true;
        const title = currentDocument?.title || `Autosave - ${new Date().toLocaleString()}`;
        await performSave(title, true);
        setLastSavedContent(currentContent);
      } catch (err) {
        console.error('[useComposer] Auto-save failed:', err);
      } finally {
        saveInFlightRef.current = false;
      }
    }, 15000);

    return () => clearInterval(timer);
  }, [isDirty, canvasTabs, activeCanvasId, lastSavedContent, currentDocument, performSave]);

  const createNewDocument = useCallback(() => {
    setCurrentDocument(null);
    const newTab: CanvasTabData = {
      id: `canvas-${Date.now()}`,
      title: 'Canvas 1',
      content: { type: 'doc', content: [] } as JSONContentAny,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setCanvasTabs([newTab]);
    setActiveCanvasId(newTab.id);
    setIsDirty(false);
    setLastSavedContent('');
  }, [setCurrentDocument, setCanvasTabs, setActiveCanvasId, setIsDirty]);

  const loadDocument = useCallback(async (docId: string) => {
    try {
      const doc = await api.loadDocument(docId);
      if (!doc) return;
      setCurrentDocument(doc);
      const tabs = doc.canvasTabs && doc.canvasTabs.length > 0
        ? doc.canvasTabs
        : [{
            id: `canvas-${Date.now()}`,
            title: 'Canvas 1',
            content: Array.isArray(doc.canvasContent) ? { type: 'doc', content: doc.canvasContent } as JSONContentAny : (doc.canvasContent as any),
            createdAt: doc.createdAt || Date.now(),
            updatedAt: doc.updatedAt || Date.now()
          }];
      setCanvasTabs(tabs);
      setActiveCanvasId(doc.activeTabId || tabs[0].id);
      setIsDirty(false);
      const activeTab = tabs.find(t => t.id === (doc.activeTabId || tabs[0].id));
      setLastSavedContent(activeTab ? JSON.stringify(activeTab.content) : '');
    } catch (e) {
      console.error('[useComposer] loadDocument failed:', e);
    }
  }, [setCurrentDocument, setCanvasTabs, setActiveCanvasId, setIsDirty]);

  const saveCurrentDocument = useCallback(async (title: string) => {
    await performSave(title, false);
  }, [performSave]);

  const updateActiveTabContent = useCallback((content: JSONContentAny) => {
    setCanvasTabs((draft: Draft<CanvasTabData[]>) => {
      const idx = draft.findIndex((t: CanvasTabData) => t.id === activeCanvasId);
      if (idx !== -1) {
        draft[idx] = { ...draft[idx], content, updatedAt: Date.now() };
      }
    });
    setIsDirty(true);
  }, [activeCanvasId, setCanvasTabs, setIsDirty]);

  // Ghost operations
  const createGhost = useCallback(async (documentId: string, text: string, provenance: any) => {
    return await api.createGhost(documentId, text, provenance);
  }, []);

  const loadGhosts = useCallback(async (documentId: string) => {
    const ghosts = await api.getDocumentGhosts(documentId);
    return ghosts;
  }, []);

  const deleteGhost = useCallback(async (ghostId: string) => {
    await api.deleteGhost(ghostId);
  }, []);

  return {
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
  };
}
