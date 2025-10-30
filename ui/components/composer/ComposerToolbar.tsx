import RefineButton from './RefineButton';

interface ComposerToolbarProps {
  onExit?: () => void;
  onSave?: () => void;
  onExport?: () => void;
  onRefine?: (content: string, selectedModel: string) => void;
  onToggleDocuments?: () => void;
  isDirty?: boolean;
  isSaving?: boolean;
  isRefining?: boolean;
  showDocumentsPanel?: boolean;
  editorRef: React.RefObject<any>;
}

const ComposerToolbar = ({
  onExit,
  onSave,
  onExport,
  onRefine,
  onToggleDocuments,
  isDirty,
  isSaving = false,
  isRefining = false,
  showDocumentsPanel = false,
  editorRef,
}: ComposerToolbarProps) => {
  return (
    <div
      className="composer-toolbar"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 60,
        boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        background: '#1e293b',
        borderBottom: '1px solid #334155',
        gap: '16px',
        flexWrap: 'wrap',
        rowGap: '8px',
        minHeight: '60px',
        width: '100%',
      }}
    >
      {/* Left section - Exit and title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flexShrink: 1 }}>
        <button
          onClick={onExit}
          style={{
            background: '#334155',
            border: '1px solid #475569',
            borderRadius: '8px',
            padding: '8px 16px',
            color: '#e2e8f0',
            fontSize: '14px',
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
          aria-label="Exit Composer Mode"
        >
          <span style={{ fontSize: '16px' }}>←</span>
          Back to Chat
        </button>
        
        <div style={{ fontSize: '18px', fontWeight: 600, color: '#e2e8f0' }}>
          Composer Mode
        </div>
        
        {isDirty && (
          <span
            style={{
              fontSize: '12px',
              color: '#f59e0b',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span style={{ fontSize: '16px' }}>●</span>
            Unsaved changes
          </span>
        )}
      </div>
      
      {/* Center section - Title */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '12px',
        flex: '1 1 200px',
        minWidth: 0,
        justifyContent: 'center'
      }}>
        <h2 style={{ 
          margin: 0, 
          fontSize: '16px', 
          fontWeight: 600, 
          color: '#e2e8f0',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '100%'
        }}>
          Composer Mode
        </h2>
        {isDirty && (
          <span style={{
            fontSize: '12px',
            color: '#f59e0b',
            fontWeight: 500,
            background: 'rgba(245, 158, 11, 0.1)',
            padding: '2px 8px',
            borderRadius: '4px',
            border: '1px solid rgba(245, 158, 11, 0.2)',
          }}>
            Unsaved changes
          </span>
        )}
      </div>
      
      {/* Right section - Action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 1, minWidth: 0, flexWrap: 'wrap', marginLeft: 'auto', justifyContent: 'flex-end' }}>
        <button
          onClick={onToggleDocuments}
          style={{
            background: showDocumentsPanel ? '#3b82f6' : '#334155',
            border: '1px solid',
            borderColor: showDocumentsPanel ? '#3b82f6' : '#475569',
            borderRadius: '8px',
            padding: '8px 16px',
            color: showDocumentsPanel ? '#fff' : '#94a3b8',
            fontSize: '14px',
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
          aria-label="Toggle documents panel"
        >
          <span style={{ fontSize: '16px' }}>📄</span>
          Documents
        </button>
        
        <RefineButton
          onRefine={(selectedModel, _content) => {
            // Get plain text from editor and pass to refine handler
            const editorText = editorRef.current?.getText?.() || '';
            onRefine?.(editorText, selectedModel);
          }}
          isRefining={isRefining}
          disabled={!editorRef.current}
        />
        
        <button
          onClick={onSave}
          disabled={isSaving}
          style={{
            background: isDirty && !isSaving ? '#10b981' : '#334155',
            border: '1px solid',
            borderColor: isDirty && !isSaving ? '#10b981' : '#475569',
            borderRadius: '8px',
            padding: '8px 16px',
            color: isDirty && !isSaving ? '#fff' : '#64748b',
            fontSize: '14px',
            fontWeight: 500,
            cursor: isSaving ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            opacity: isSaving ? 0.6 : 1,
          }}
          aria-label="Save composition"
        >
          <span style={{ fontSize: '16px' }}>💾</span>
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        
        <button
          onClick={onExport}
          style={{
            background: '#8b5cf6',
            border: '1px solid #8b5cf6',
            borderRadius: '8px',
            padding: '8px 16px',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
          aria-label="Copy to clipboard"
        >
          <span style={{ fontSize: '16px' }}>📋</span>
          Copy
        </button>
      </div>
    </div>
  );
};

export default ComposerToolbar;
