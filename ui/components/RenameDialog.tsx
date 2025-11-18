import React, { useEffect, useRef, useState } from "react";

interface RenameDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRename: (title: string) => void;
  defaultTitle: string;
  isRenaming?: boolean;
}

export const RenameDialog: React.FC<RenameDialogProps> = ({
  isOpen,
  onClose,
  onRename,
  defaultTitle,
  isRenaming = false,
}) => {
  const [title, setTitle] = useState(defaultTitle);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTitle(defaultTitle);
  }, [defaultTitle]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      // Auto-select the whole title for quick renaming
      inputRef.current.focus();
      inputRef.current.selectionStart = 0;
      inputRef.current.selectionEnd = inputRef.current.value.length;
    }
  }, [isOpen]);

  const handleRename = () => {
    const t = String(title || "").trim();
    if (t) onRename(t);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleRename();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        style={{
          background: "#1e293b",
          border: "1px solid #334155",
          borderRadius: "12px",
          padding: "24px",
          minWidth: "400px",
          maxWidth: "500px",
          boxShadow:
            "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
        }}
      >
        <h3
          style={{
            margin: "0 0 16px 0",
            fontSize: "18px",
            fontWeight: 600,
            color: "#e2e8f0",
          }}
        >
          Rename Chat
        </h3>

        <div style={{ marginBottom: "20px" }}>
          <label
            style={{
              display: "block",
              fontSize: "14px",
              fontWeight: 500,
              color: "#cbd5e1",
              marginBottom: "8px",
            }}
          >
            Chat Title
          </label>
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter chat title..."
            autoFocus
            style={{
              width: "100%",
              padding: "12px",
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: "8px",
              color: "#e2e8f0",
              fontSize: "14px",
              outline: "none",
              boxSizing: "border-box",
            }}
            onFocus={(e) => {
              e.target.style.borderColor = "#8b5cf6";
              // Also select all text for quick replacement
              e.currentTarget.selectionStart = 0;
              e.currentTarget.selectionEnd = e.currentTarget.value.length;
            }}
            onBlur={(e) => {
              e.target.style.borderColor = "#334155";
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            gap: "12px",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onClose}
            disabled={isRenaming}
            style={{
              padding: "10px 20px",
              background: "transparent",
              border: "1px solid #475569",
              borderRadius: "8px",
              color: "#94a3b8",
              fontSize: "14px",
              fontWeight: 500,
              cursor: isRenaming ? "not-allowed" : "pointer",
              opacity: isRenaming ? 0.6 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleRename}
            disabled={!title.trim() || isRenaming}
            style={{
              padding: "10px 20px",
              background: title.trim() && !isRenaming ? "#10b981" : "#334155",
              border: "1px solid",
              borderColor: title.trim() && !isRenaming ? "#10b981" : "#475569",
              borderRadius: "8px",
              color: title.trim() && !isRenaming ? "#fff" : "#64748b",
              fontSize: "14px",
              fontWeight: 500,
              cursor: title.trim() && !isRenaming ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              transition: "all 0.15s ease",
              transform: "scale(1)",
            }}
            onMouseDown={(e) => {
              if (title.trim() && !isRenaming) {
                e.currentTarget.style.transform = "scale(0.95)";
              }
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            {isRenaming && (
              <div
                style={{
                  width: "16px",
                  height: "16px",
                  border: "2px solid transparent",
                  borderTop: "2px solid currentColor",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                }}
              />
            )}
            {isRenaming ? "Renaming…" : "Rename"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default RenameDialog;
