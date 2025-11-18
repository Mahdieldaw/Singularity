import React from "react";
import { useAtom, useSetAtom } from "jotai";
import { isHistoryPanelOpenAtom, isSettingsOpenAtom } from "../state/atoms";

// MenuIcon component (inline for simplicity)
const MenuIcon = ({ style }: { style?: React.CSSProperties }) => (
  <svg
    style={style}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="3" y1="12" x2="21" y2="12"></line>
    <line x1="3" y1="6" x2="21" y2="6"></line>
    <line x1="3" y1="18" x2="21" y2="18"></line>
  </svg>
);

export default function Header() {
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useAtom(
    isHistoryPanelOpenAtom,
  );
  const setIsSettingsOpen = useSetAtom(isSettingsOpenAtom);

  return (
    <header
      className="header"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 16px",
        background: "rgba(10, 10, 25, 0.85)",
        backdropFilter: "blur(14px)",
        borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        flexShrink: 0,
      }}
    >
      <div
        className="logo-area"
        style={{ display: "flex", alignItems: "center", gap: "12px" }}
      >
        <button
          onClick={() => setIsHistoryPanelOpen(!isHistoryPanelOpen)}
          style={{
            background: "none",
            border: "none",
            color: "#e2e8f0",
            cursor: "pointer",
            padding: "4px",
          }}
          aria-label="Toggle History Panel"
        >
          <MenuIcon style={{ width: "24px", height: "24px" }} />
        </button>
        <div
          className="logo"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontWeight: 600,
            fontSize: "16px",
            color: "#e2e8f0",
          }}
        >
          <div
            className="logo-icon"
            style={{
              width: "24px",
              height: "24px",
              background: "rgba(99, 102, 241, 0.25)",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
            }}
          >
            ⚡
          </div>
          Singularity
        </div>
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          className="settings-btn"
          onClick={() => setIsSettingsOpen(true)}
          style={{
            padding: "8px 12px",
            background: "rgba(255, 255, 255, 0.1)",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            borderRadius: "8px",
            color: "#e2e8f0",
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
        >
          ⚙️ Models
        </button>
      </div>
    </header>
  );
}
