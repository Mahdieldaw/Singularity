import React, { useCallback } from 'react';
import { CanvasTabData } from '../../types';

interface CanvasTrayProps {
  tabs: CanvasTabData[];
  activeTabId: string;
  onActivateTab: (tabId: string) => void;
  onTabsChange?: (tabs: CanvasTabData[]) => void;
}

export const CanvasTray: React.FC<CanvasTrayProps> = ({
  tabs,
  activeTabId,
  onActivateTab,
  onTabsChange,
}) => {
  const handleAddTab = useCallback(() => {
    const now = Date.now();
    const newTab: CanvasTabData = {
      id: `canvas-${now}`,
      title: `Canvas ${tabs.length + 1}`,
      content: { type: 'doc', content: [] },
      createdAt: now,
      updatedAt: now,
    };
    const updated = [...tabs, newTab];
    onTabsChange?.(updated);
    onActivateTab(newTab.id);
  }, [tabs, onTabsChange, onActivateTab]);

  const handleRenameTab = useCallback((tabId: string, newTitle: string) => {
    const updated = tabs.map((t) => (t.id === tabId ? { ...t, title: newTitle } : t));
    onTabsChange?.(updated);
  }, [tabs, onTabsChange]);

  return (
    <div style={{ height: '48px', background: '#0f172a', borderTop: '1px solid #334155', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', background: '#0b1220' }}>
        {/* left flexible spacer to prevent overlap and keep center group centered */}
        <div style={{ flex: 1, minWidth: 24 }} />
        {/* center group: canvas icons and add button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              onClick={() => onActivateTab(tab.id)}
              title={tab.title}
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isActive ? '#8b5cf6' : '#334155',
                color: isActive ? '#0b1220' : '#e2e8f0',
                border: '1px solid #475569',
                cursor: 'pointer',
                fontSize: 16,
                fontWeight: 700,
                boxShadow: isActive ? '0 0 0 2px rgba(139,92,246,0.35)' : 'none',
              }}
            >
              📝
            </button>
          );
        })}
        <button
          onClick={handleAddTab}
          style={{ width: 28, height: 28, borderRadius: '50%', background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer', fontSize: 16, fontWeight: 700 }}
          title="Add canvas"
        >
          +
        </button>
        </div>
        {/* right flexible spacer to keep layout non-overlapping */}
        <div style={{ flex: 1, minWidth: 24 }} />
      </div>
    </div>
  );
};

export default CanvasTray;