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
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
    >
      <div
        style={{
          backgroundColor: "#1e293b",
          padding: "24px",
          borderRadius: "12px",
          width: "90%",
          maxWidth: "600px",
          border: "1px solid #334155",
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3)",
        }}
      >
        <h2 style={{ marginTop: 0, color: "#e2e8f0" }}>Prompt Suggestion</h2>

        <div style={{ marginBottom: "16px" }}>
          <h3 style={{ color: "#94a3b8", fontSize: "16px" }}>Explanation</h3>
          <p style={{ color: "#cbd5e1", margin: 0, fontSize: "16px" }}>
            {refinerData.explanation}
          </p>
        </div>

        <div>
          <h3 style={{ color: "#94a3b8", fontSize: "16px" }}>Refined Prompt</h3>
          <div
            style={{
              backgroundColor: "#0f172a",
              padding: "12px",
              borderRadius: "8px",
              border: "1px solid #334155",
              color: "#e2e8f0",
              fontFamily: "monospace",
              whiteSpace: "pre-wrap",
              fontSize: "16px",
            }}
          >
            {refinerData.refinedPrompt}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
            marginTop: "24px",
          }}
        >
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
  );
}
