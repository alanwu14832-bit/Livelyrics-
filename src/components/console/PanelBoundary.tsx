"use client";

// Keeps one broken panel from taking down the whole console (and with it the show clock):
// the failing panel is replaced by a small notice with a retry button.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { WarningCircleIcon } from "@/components/ui/Icon";

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
      <section role="alert" className="flex min-h-0 flex-col items-center justify-center rounded-lg bg-surface p-4 text-center" style={{ gridArea: this.props.area }}>
        <WarningCircleIcon size={32} weight="fill" className="mb-2 text-red" />
        <p className="text-c-headline text-label">「{this.props.label}」面板發生錯誤</p>
        <p className="mt-1 max-w-sm text-c-body text-label-2">播放與投影不受影響。{this.state.error.message ? `（${this.state.error.message}）` : ""}</p>
        <Button size="sm" variant="gray" className="mt-3" onClick={() => this.setState({ error: null })}>
          重新載入面板
        </Button>
      </section>
    );
  }
}
