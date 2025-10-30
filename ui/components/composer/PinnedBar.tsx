import { useMemo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { GhostData } from '../../types/dragDrop';
import { getProviderById } from '../../providers/providerRegistry';

interface PinnedBarProps {
  ghosts: GhostData[];
  onRemoveGhost: (ghostId: string) => void;
  maxVisible?: number;
}

interface PinChipProps {
  ghost: GhostData;
  onRemove: () => void;
}

const PinChip = ({ ghost, onRemove }: PinChipProps) => {
  const provider = getProviderById(ghost.provenance.providerId);
  
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: `pin-${ghost.id}`,
    data: {
      type: 'composer-block',
      text: ghost.text,
      provenance: ghost.provenance,
    }
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="pin-chip"
      data-pin-id={ghost.id}
      title={`${provider?.name || ghost.provenance.providerId} • ${ghost.provenance.granularity}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        background: isDragging ? '#1e293b' : '#334155',
        border: '1px solid #475569',
        borderRadius: '20px',
        color: '#e2e8f0',
        fontSize: '13px',
        fontWeight: 500,
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        minWidth: '120px',
        maxWidth: '200px',
        position: 'relative',
        transition: 'all 0.2s ease',
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      {/* Provider indicator */}
      <div
        style={{
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          background: provider?.color || '#64748b',
          flexShrink: 0,
        }}
      />
      
      {/* Pin preview text */}
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {ghost.preview}
      </span>
      
      {/* Pin indicator */}
      {ghost.isPinned && (
        <span
          style={{
            fontSize: '10px',
            color: '#f59e0b',
          }}
        >
          📌
        </span>
      )}
      
      {/* Remove button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        style={{
          background: 'none',
          border: 'none',
          color: '#94a3b8',
          cursor: 'pointer',
          padding: '2px',
          fontSize: '12px',
          lineHeight: 1,
          borderRadius: '50%',
          width: '16px',
          height: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
        title="Remove pin"
        aria-label="Remove pin"
      >
        ×
      </button>
    </div>
  );
};

export const PinnedBar = ({ ghosts, onRemoveGhost, maxVisible = 8 }: PinnedBarProps) => {
  // Sort ghosts by order, then by creation time
  const sortedGhosts = useMemo(() => {
    return [...ghosts].sort((a, b) => {
      // Check if order field exists
      const aOrder = (a as any).order ?? a.createdAt;
      const bOrder = (b as any).order ?? b.createdAt;
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      return a.createdAt - b.createdAt;
    });
  }, [ghosts]);

  const visibleGhosts = sortedGhosts.slice(0, maxVisible);
  const overflowCount = Math.max(0, sortedGhosts.length - maxVisible);

  if (ghosts.length === 0) {
    return (
      <div
        className="pinned-bar-empty"
        style={{
          height: '60px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f172a',
          borderBottom: '1px solid #334155',
          color: '#64748b',
          fontSize: '13px',
          fontStyle: 'italic',
        }}
      >
        Pin segments to collect them here for quick access
      </div>
    );
  }

  return (
    <div
      className="pinned-bar"
      style={{
        height: '60px',
        background: '#0f172a',
        borderBottom: '1px solid #334155',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      {/* Pin count indicator */}
      <div
        style={{
          fontSize: '12px',
          color: '#64748b',
          fontWeight: 500,
          marginRight: '8px',
          flexShrink: 0,
        }}
      >
        {ghosts.length} pin{ghosts.length !== 1 ? 's' : ''}
      </div>
      
      {/* Pin chips */}
      {visibleGhosts.map((ghost) => (
        <PinChip
          key={ghost.id}
          ghost={ghost}
          onRemove={() => onRemoveGhost(ghost.id)}
        />
      ))}

      {/* Overflow indicator */}
      {overflowCount > 0 && (
        <div
          style={{
            fontSize: '12px',
            color: '#94a3b8',
            fontWeight: 500,
            padding: '8px 12px',
            background: '#1e293b',
            border: '1px solid #475569',
            borderRadius: '20px',
            flexShrink: 0,
          }}
        >
          +{overflowCount} more
        </div>
      )}
    </div>
  );
};

export default PinnedBar;
