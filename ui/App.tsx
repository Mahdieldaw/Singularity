import React, { useRef, Suspense } from "react";
import { useAtom } from "jotai";
import { usePortMessageHandler } from "./hooks/usePortMessageHandler";
import { useConnectionMonitoring } from "./hooks/useConnectionMonitoring";
import { useHistoryLoader } from "./hooks/useHistoryLoader";
import { useResponsiveLoadingGuard } from "./hooks/useLoadingWatchdog";
import ChatView from "./views/ChatView";
import Header from "./components/Header";
import HistoryPanelConnected from "./components/HistoryPanelConnected";
import BannerConnected from "./components/BannerConnected";
import CompactModelTrayConnected from "./components/CompactModelTrayConnected";
import SettingsPanel from "./components/SettingsPanel";
import { isHistoryPanelOpenAtom } from "./state/atoms";
import { useInitialization } from "./hooks/useInitialization"; // Import the new hook
import { useOnClickOutside } from "usehooks-ts";
import { useKey } from "./hooks/useKey";

export default function App() {
  // This is now the entry point for all startup logic.
  const isInitialized = useInitialization();

  // Initialize other global side effects that can run after init
  usePortMessageHandler();
  useConnectionMonitoring();
  useHistoryLoader(isInitialized); // Pass the flag to the history loader
  // Non-destructive loading guard: surfaces alerts when idle while loading
  useResponsiveLoadingGuard({ idleWarnMs: 15000, idleCriticalMs: 45000 });

  const [isHistoryOpen, setIsHistoryOpen] = useAtom(isHistoryPanelOpenAtom);

  const historyPanelRef = useRef<HTMLDivElement>(null);

  const closePanel = () => setIsHistoryOpen(false);

  useOnClickOutside(historyPanelRef, closePanel);
  useKey("Escape", closePanel);

  // THE INITIALIZATION BARRIER
  if (!isInitialized) {
    // Render a simple loading state or nothing at all.
    // This prevents any child components from running their hooks too early.
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#0f0f23",
        }}
      >
        <div className="loading-spinner" />
      </div>
    );
  }

  // Once initialized, render the full application.
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        background: "linear-gradient(135deg, #0f0f23 0%, #1a1a3a 100%)",
        minHeight: 0,
      }}
    >
      <Header />
      <BannerConnected />

      {/* Main content area */}
      <div
        style={{
          display: "flex",
          flex: 1,
          position: "relative",
          minHeight: 0,
        }}
      >
        <main
          className="chat-main"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            position: "relative",
            minHeight: 0,
          }}
        >
          <ChatView />
        </main>

        {/* History Panel Overlay */}
        {isHistoryOpen && (
          <>
            <div
              className="history-backdrop"
              onClick={closePanel}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.4)",
                backdropFilter: "blur(2px)",
                zIndex: 1000,
              }}
            />
            <div
              ref={historyPanelRef}
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                width: "320px",
                height: "100vh",
                zIndex: 1100,
              }}
            >
              <HistoryPanelConnected />
            </div>
          </>
        )}
      </div>

      {/* Settings Panel - Slides in from right */}
      <SettingsPanel />
    </div>
  );
}
