import React from "react";
import { useSetAtom } from "jotai";
import { EXAMPLE_PROMPT } from "../constants";

interface WelcomeScreenProps {
  onSendPrompt?: (prompt: string) => void;
  isLoading?: boolean;
}

const WelcomeScreen = ({ onSendPrompt, isLoading }: WelcomeScreenProps) => {
  return (
    <div
      className="welcome-state"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        textAlign: "center",
        padding: "40px 20px",
      }}
    >
      <div
        className="welcome-icon"
        style={{
          width: "80px",
          height: "80px",
          background: "linear-gradient(45deg, #6366f1, #8b5cf6)",
          borderRadius: "20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "32px",
          marginBottom: "24px",
        }}
      >
        🧠
      </div>

      <h2
        className="welcome-title"
        style={{
          fontSize: "24px",
          fontWeight: 600,
          marginBottom: "12px",
          color: "#e2e8f0",
        }}
      >
        Intelligence Augmentation
      </h2>

      <p
        className="welcome-subtitle"
        style={{
          fontSize: "16px",
          color: "#94a3b8",
          marginBottom: "32px",
          maxWidth: "400px",
        }}
      >
        Ask one question, get synthesized insights from multiple AI models in
        real-time
      </p>

      {onSendPrompt && (
        <button
          onClick={() => onSendPrompt(EXAMPLE_PROMPT)}
          disabled={isLoading}
          style={{
            fontSize: "14px",
            color: "#a78bfa",
            padding: "8px 16px",
            border: "1px solid #a78bfa",
            borderRadius: "8px",
            background: "rgba(167, 139, 250, 0.1)",
            cursor: isLoading ? "not-allowed" : "pointer",
            opacity: isLoading ? 0.5 : 1,
            transition: "all 0.2s ease",
          }}
        >
          Try: "{EXAMPLE_PROMPT}"
        </button>
      )}
    </div>
  );
};

export default WelcomeScreen;
