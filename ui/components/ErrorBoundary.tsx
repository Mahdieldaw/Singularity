import React, { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            padding: "40px",
            textAlign: "center",
            background: "linear-gradient(135deg, #0f0f23 0%, #1a1a3a 100%)",
            color: "#e2e8f0",
          }}
        >
          <div
            style={{
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              borderRadius: "12px",
              padding: "32px",
              maxWidth: "600px",
            }}
          >
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚠️</div>
            <h2
              style={{
                fontSize: "24px",
                marginBottom: "12px",
                color: "#fca5a5",
              }}
            >
              Something went wrong
            </h2>
            <p
              style={{
                fontSize: "14px",
                color: "#94a3b8",
                marginBottom: "24px",
              }}
            >
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              style={{
                padding: "12px 24px",
                background: "#6366f1",
                border: "none",
                borderRadius: "8px",
                color: "white",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
