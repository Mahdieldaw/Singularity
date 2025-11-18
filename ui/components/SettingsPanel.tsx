import React from "react";
import { useAtom } from "jotai";
import {
  selectedModelsAtom,
  isVisibleModeAtom,
  powerUserModeAtom,
  isReducedMotionAtom,
  isSettingsOpenAtom,
} from "../state/atoms";
import { LLM_PROVIDERS_CONFIG } from "../constants";

export default function SettingsPanel() {
  const [isSettingsOpen, setIsSettingsOpen] = useAtom(isSettingsOpenAtom);
  const [selectedModels, setSelectedModels] = useAtom(selectedModelsAtom);
  const [isVisibleMode, setIsVisibleMode] = useAtom(isVisibleModeAtom);
  const [powerUserMode, setPowerUserMode] = useAtom(powerUserModeAtom);
  const [isReducedMotion, setIsReducedMotion] = useAtom(isReducedMotionAtom);

  const handleToggleModel = (providerId: string) => {
    setSelectedModels((prev: any) => ({
      ...prev,
      [providerId]: !prev[providerId],
    }));
  };

  return (
    <div
      className="settings-panel"
      style={{
        position: "fixed",
        top: 0,
        right: isSettingsOpen ? "0px" : "-350px",
        width: "350px",
        height: "100vh",
        background: "rgba(15, 15, 35, 0.95)",
        backdropFilter: "blur(20px)",
        borderLeft: "1px solid rgba(255, 255, 255, 0.1)",
        transition: "right 0.3s ease",
        zIndex: 1100,
        padding: "20px",
        overflowY: "auto",
      }}
    >
      <div
        className="settings-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "24px",
        }}
      >
        <h2
          className="settings-title"
          style={{ fontSize: "18px", fontWeight: 600, color: "#e2e8f0" }}
        >
          Model Configuration
        </h2>
        <button
          className="close-settings"
          onClick={() => setIsSettingsOpen(false)}
          style={{
            padding: "8px",
            background: "none",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            borderRadius: "4px",
            transition: "background 0.2s ease",
            fontSize: "18px",
          }}
        >
          ✕
        </button>
      </div>

      <div className="model-config">
        <h3
          style={{
            fontSize: "14px",
            fontWeight: 600,
            marginBottom: "12px",
            color: "#a78bfa",
          }}
        >
          Active Models
        </h3>
        {LLM_PROVIDERS_CONFIG.map((provider) => (
          <div
            key={provider.id}
            className="model-item"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "8px",
              marginBottom: "8px",
            }}
          >
            <div
              className="model-info"
              style={{ display: "flex", alignItems: "center", gap: "8px" }}
            >
              <div
                className={`model-logo ${provider.logoBgClass}`}
                style={{ width: "16px", height: "16px", borderRadius: "3px" }}
              ></div>
              <span style={{ color: "#e2e8f0" }}>{provider.name}</span>
            </div>
            <div
              className={`model-toggle ${selectedModels[provider.id] ? "active" : ""}`}
              onClick={() => handleToggleModel(provider.id)}
              style={{
                width: "40px",
                height: "20px",
                background: selectedModels[provider.id]
                  ? "#6366f1"
                  : "rgba(255, 255, 255, 0.2)",
                borderRadius: "10px",
                position: "relative",
                cursor: "pointer",
                transition: "background 0.2s ease",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "2px",
                  left: selectedModels[provider.id] ? "22px" : "2px",
                  width: "16px",
                  height: "16px",
                  background: "white",
                  borderRadius: "50%",
                  transition: "left 0.2s ease",
                }}
              />
            </div>
          </div>
        ))}

        <h3
          style={{
            fontSize: "14px",
            fontWeight: 600,
            marginBottom: "12px",
            color: "#a78bfa",
            marginTop: "20px",
          }}
        >
          Execution Mode
        </h3>
        <div
          className="mode-item"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px",
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: "8px",
            marginBottom: "8px",
          }}
        >
          <span style={{ color: "#e2e8f0" }}>
            Run in Visible Tabs (for debugging)
          </span>
          <div
            onClick={() => setIsVisibleMode(!isVisibleMode)}
            style={{
              width: "40px",
              height: "20px",
              background: isVisibleMode
                ? "#6366f1"
                : "rgba(255, 255, 255, 0.2)",
              borderRadius: "10px",
              position: "relative",
              cursor: "pointer",
              transition: "background 0.2s ease",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: "2px",
                left: isVisibleMode ? "22px" : "2px",
                width: "16px",
                height: "16px",
                background: "white",
                borderRadius: "50%",
                transition: "left 0.2s ease",
              }}
            />
          </div>
        </div>

        <h3
          style={{
            fontSize: "14px",
            fontWeight: 600,
            marginBottom: "12px",
            color: "#a78bfa",
            marginTop: "20px",
          }}
        >
          Advanced Features
        </h3>
        <div
          className="mode-item"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px",
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: "8px",
            marginBottom: "8px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ color: "#e2e8f0" }}>Power User Mode</span>
            <span
              style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}
            >
              Enable multi-synthesis selection
            </span>
          </div>
          <div
            className={`mode-toggle ${powerUserMode ? "active" : ""}`}
            onClick={() => setPowerUserMode(!powerUserMode)}
            style={{
              width: "40px",
              height: "20px",
              background: powerUserMode
                ? "#6366f1"
                : "rgba(255, 255, 255, 0.2)",
              borderRadius: "10px",
              position: "relative",
              cursor: "pointer",
              transition: "background 0.2s ease",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: "2px",
                left: powerUserMode ? "22px" : "2px",
                width: "16px",
                height: "16px",
                background: "white",
                borderRadius: "50%",
                transition: "left 0.2s ease",
              }}
            />
          </div>
        </div>

        <h3
          style={{
            fontSize: "14px",
            fontWeight: 600,
            marginBottom: "12px",
            color: "#a78bfa",
            marginTop: "20px",
          }}
        >
          Accessibility
        </h3>
        <div
          className="mode-item"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px",
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: "8px",
            marginBottom: "8px",
          }}
        >
          <span style={{ color: "#e2e8f0" }}>Reduced Motion</span>
          <div
            className={`mode-toggle ${isReducedMotion ? "active" : ""}`}
            onClick={() => setIsReducedMotion(!isReducedMotion)}
            style={{
              width: "40px",
              height: "20px",
              background: isReducedMotion
                ? "#6366f1"
                : "rgba(255, 255, 255, 0.2)",
              borderRadius: "10px",
              position: "relative",
              cursor: "pointer",
              transition: "background 0.2s ease",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: "2px",
                left: isReducedMotion ? "22px" : "2px",
                width: "16px",
                height: "16px",
                background: "white",
                borderRadius: "50%",
                transition: "left 0.2s ease",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
