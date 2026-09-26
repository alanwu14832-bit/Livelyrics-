"use client";

// Keeps one broken panel from taking down the whole console (and with it the show clock):
// the failing panel is replaced by a small notice with a retry button.

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** grid-area of the panel, so the fallback occupies the same slot */
  area: string;
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class PanelBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Livelyrics] 控制台「${this.props.label}」面板發生錯誤：`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section
        role="alert"
        className="flex min-h-0 flex-col items-center justify-center gap-2 rounded-lg border border-danger/40 bg-panel p-4 text-center"
        style={{ gridArea: this.props.area }}
      >
        <p className="text-sm font-semibold text-fg">「{this.props.label}」面板發生錯誤</p>
        <p className="max-w-sm text-xs leading-relaxed text-muted">播放與投影不受影響。{this.state.error.message ? `（${this.state.error.message}）` : ""}</p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="rounded-md border border-line bg-panel-3 px-3 py-1 text-xs text-fg hover:bg-line"
        >
          重新載入面板
        </button>
      </section>
    );
  }
}
