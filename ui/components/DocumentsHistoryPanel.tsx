import React from 'react';

// This is a summary type, not the full DocumentRecord
interface DocumentSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  type?: string;
  isAutosave?: boolean;
}

interface DocumentsHistoryPanelProps {
  isOpen: boolean;
  documents: DocumentSummary[];
  isLoading: boolean;
  onSelectDocument: (document: DocumentSummary) => void;
  onDeleteDocument: (documentId: string) => void;
  onNewDocument?: () => void;
}

const DocumentsHistoryPanel: React.FC<DocumentsHistoryPanelProps> = ({
  isOpen,
  documents,
  isLoading,
  onSelectDocument,
  onDeleteDocument,
  onNewDocument,
}) => {

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const panelStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    background: 'rgba(10, 10, 25, 0.9)',
    backdropFilter: 'blur(15px)',
    borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
    color: '#e2e8f0',
    padding: '20px',
    overflowY: 'auto',
    overflowX: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  };

  const headerButtonStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    background: 'linear-gradient(180deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15))',
    color: '#e2e8f0',
    cursor: 'pointer',
    marginBottom: '12px',
  };

  const itemStyle: React.CSSProperties = {
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    background: 'rgba(255, 255, 255, 0.02)',
    color: '#e2e8f0',
    cursor: 'pointer',
    marginBottom: '8px',
    position: 'relative',
    transition: 'all 0.2s ease',
  };

  const deleteButtonStyle: React.CSSProperties = {
    position: 'absolute',
    top: '8px',
    right: '8px',
    background: 'rgba(239, 68, 68, 0.2)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '4px',
    color: '#fca5a5',
    padding: '4px 8px',
    fontSize: '12px',
    cursor: 'pointer',
  };

  if (!isOpen) return null;

  return (
    <div style={panelStyle}>
      {onNewDocument && (
        <button
          style={headerButtonStyle}
          onClick={onNewDocument}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'linear-gradient(180deg, rgba(99,102,241,0.25), rgba(139,92,246,0.25))';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'linear-gradient(180deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15))';
          }}
        >
          + New Document
        </button>
      )}

      <div style={{ marginBottom: '16px', fontSize: '14px', fontWeight: '500' }}>
        Saved Documents ({documents.length})
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8' }}>
          Loading documents...
        </div>
      ) : documents.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>
          No documents saved yet
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {documents.map((doc) => (
            <div
              key={doc.id}
              style={itemStyle}
              onClick={() => onSelectDocument(doc)}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
              }}
            >
              <button
                style={deleteButtonStyle}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteDocument(doc.id);
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                }}
              >
                ×
              </button>
              
              <div style={{ 
                fontWeight: '500', 
                marginBottom: '4px',
                paddingRight: '30px',
                fontSize: '13px'
              }}>
                {doc.title}
                {doc.isAutosave && (
                  <span style={{ 
                    marginLeft: '8px',
                    fontSize: '11px',
                    color: '#94a3b8',
                    fontWeight: '400'
                  }}>
                    (autosave)
                  </span>
                )}
              </div>
              
              <div style={{ 
                fontSize: '11px', 
                color: '#94a3b8',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span>{doc.type || 'document'}</span>
                <span>{formatDate(doc.updatedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DocumentsHistoryPanel;
