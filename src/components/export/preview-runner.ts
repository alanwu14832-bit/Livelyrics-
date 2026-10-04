// The export page's 單格預覽: one render at a time (a second press while one runs is ignored,
// never a second concurrent OfflineStage), cancellable through an AbortSignal.

export class PreviewRunner {
  private current: AbortController | null = null;

  get busy(): boolean {
    return this.current != null;
  }

  /**
   * Run `render` unless one is already running (then `null` at once). Resolves with its result,
   * or `null` when it was cancelled; other errors reject.
   */
  async run<T>(render: (signal: AbortSignal) => Promise<T>): Promise<{ value: T } | null> {
    if (this.current) return null;
    const controller = new AbortController();
    this.current = controller;
    try {
      const value = await render(controller.signal);
      return controller.signal.aborted ? null : { value };
    } catch (err) {
      if (controller.signal.aborted) return null;
      throw err;
    } finally {
      if (this.current === controller) this.current = null;
    }
  }

  /** 「取消」: abort the running render (no-op when idle). */
  cancel(): void {
    this.current?.abort();
  }
}
