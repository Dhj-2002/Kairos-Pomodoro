import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Keep a frontend exception visible instead of letting React unmount the app
 * into an unexplained white webview. This is deliberately dependency-free so
 * it can render even when a feature/provider fails during startup.
 */
export class AppErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[App] Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 32,
          background: "#f4efe6",
          color: "#292720",
          fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        <section style={{ maxWidth: 680, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, marginBottom: 12 }}>Kairos could not finish loading</h1>
          <p style={{ lineHeight: 1.6, color: "#655f54" }}>
            Your local data is still on disk. Please copy the error below if you
            need support, then retry the app.
          </p>
          <pre
            style={{
              marginTop: 20,
              padding: 16,
              overflow: "auto",
              textAlign: "left",
              whiteSpace: "pre-wrap",
              borderRadius: 12,
              background: "#e8dfd0",
              fontSize: 12,
            }}
          >
            {this.state.error.stack || this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 20,
              border: 0,
              borderRadius: 10,
              padding: "10px 18px",
              background: "#6b8f71",
              color: "white",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Retry
          </button>
        </section>
      </main>
    );
  }
}
