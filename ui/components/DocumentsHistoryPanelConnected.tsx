// src/ui/components/DocumentsHistoryPanelConnected.tsx
import React, { useState, useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { documentsRefreshTickAtom } from '../state/atoms';
import api from '../services/extension-api';
import DocumentsHistoryPanel from './DocumentsHistoryPanel';
import type { DocumentRecord } from '../types';

interface Props {
  isOpen: boolean;
  onSelectDocument: (doc: DocumentRecord) => void;
  onNewDocument?: () => void;
}

export function DocumentsHistoryPanelConnected({ isOpen, onSelectDocument, onNewDocument }: Props) {
  const [documents, setDocuments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const refreshSignal = useAtomValue(documentsRefreshTickAtom);

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    api.listDocuments()
      .then(docs => {
        setDocuments((docs || []).map((d: any) => ({
          id: d.id,
          title: d.title,
          createdAt: d.lastModified || d.createdAt || Date.now(),
          updatedAt: d.lastModified || d.updatedAt || Date.now(),
          type: 'document',
          isAutosave: String(d.title || '').toLowerCase().includes('autosave')
        })));
      })
      .catch((e) => {
        console.error('[DocumentsHistoryPanelConnected] listDocuments failed:', e);
        setDocuments([]);
      })
      .finally(() => setIsLoading(false));
  }, [isOpen, refreshSignal]);

  const handleSelectDocument = async (docSummary: { id: string }) => {
    const fullDoc = await api.loadDocument(docSummary.id);
    if (fullDoc) {
      onSelectDocument(fullDoc as DocumentRecord);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    await api.deleteDocument(docId);
    setDocuments(prev => prev.filter(d => d.id !== docId));
  };

  return (
    <DocumentsHistoryPanel
      isOpen={isOpen}
      documents={documents}
      isLoading={isLoading}
      onSelectDocument={handleSelectDocument}
      onDeleteDocument={handleDeleteDocument}
      onNewDocument={onNewDocument}
    />
  );
}

export default DocumentsHistoryPanelConnected;
