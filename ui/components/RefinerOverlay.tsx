import React from "react";
import { useAtom } from "jotai";
import {
  refinerDataAtom,
  isRefinerOpenAtom,
  chatInputValueAtom,
} from "../state/atoms";

export default function RefinerOverlay() {
  const [refinerData, setRefinerData] = useAtom(refinerDataAtom);
  const [isOpen, setIsOpen] = useAtom(isRefinerOpenAtom);
  const [, setChatInputValue] = useAtom(chatInputValueAtom);

  if (!isOpen || !refinerData) {
    return null;
  }

  const handleAccept = () => {
    setChatInputValue(refinerData.refinedPrompt);
    setIsOpen(false);
    setRefinerData(null);
  };

  const handleReject = () => {
    setIsOpen(false);
    setRefinerData(null);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 4000,
        overflowY: "auto",
        padding: "24px",
      }}
    >
      <div
        style={{
          backgroundColor: "#1e293b",
          borderRadius: "12px",
          width: "90%",
          maxWidth: "640px",
          border: "1px solid #334155",
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3)",
          maxHeight: "calc(100vh - 220px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #334155" }}>
          <h2 style={{ margin: 0, color: "#e2e8f0" }}>Prompt Suggestion</h2>
        </div>

        <div style={{ padding: "16px 24px", overflowY: "auto" }}>
          <div style={{ marginBottom: "16px" }}>
            <h3 style={{ color: "#94a3b8", fontSize: "16px", margin: 0, marginBottom: "8px" }}>Explanation</h3>
            <p style={{ color: "#cbd5e1", margin: 0, fontSize: "16px", lineHeight: 1.5 }}>{refinerData.explanation}</p>
          </div>

          <div>
            <h3 style={{ color: "#94a3b8", fontSize: "16px", margin: 0, marginBottom: "8px" }}>Refined Prompt</h3>
            <div
              style={{
                backgroundColor: "#0f172a",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid #334155",
                color: "#e2e8f0",
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                fontSize: "15px",
                lineHeight: 1.5,
              }}
            >
              {refinerData.refinedPrompt}
            </div>
          </div>
        </div>

        <div
          style={{
            position: "sticky",
            bottom: 0,
            padding: "12px 24px",
            borderTop: "1px solid #334155",
            background: "rgba(30, 41, 59, 0.9)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
            <button
              onClick={handleReject}
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
                border: "1px solid #475569",
                background: "#334155",
                color: "#e2e8f0",
                cursor: "pointer",
              }}
            >
              Reject
            </button>
            <button
              onClick={handleAccept}
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
                border: "none",
                background: "linear-gradient(45deg, #6366f1, #8b5cf6)",
                color: "white",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
