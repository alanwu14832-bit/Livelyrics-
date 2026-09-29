"use client";

// Server status on the home page (UI-AUDIT §3.5 首頁, UI-14). Offline is a normal, supported mode,
// so it is a quiet status and never a warning box:
//   - header (right slot): a quiet text button, 「離線設計模式」 + Info, or 「Claude 已連線」 with the
//     6 px green dot (the only green dot on the site); it opens the connect sheet / a model popover
//   - under the hero subtitle: one 13 px label-2 line with a plain 「連接 Claude」 link
//   - the connect sheet: the .env.local steps (code block) and 「重新檢查」, or on Vercel the
//     Environment Variables + Redeploy steps
// A server that cannot be reached is a real error: a Banner with 「重試」. On Vercel without Blob /
// Postgres the home page shows StorageSetupNotice instead of the upload flow.

import { useCallback, useEffect, useRef, useState } from "react";
import { Banner, Button, Kbd, Popover, Sheet, Spinner, cx } from "@/components/ui";
import { CheckCircleIcon, CopyIcon, InfoIcon, WarningIcon } from "@/components/ui/Icon";
import { api, type ServerStatus } from "@/lib/api-client";

export type ServerStatusState =
  | { kind: "loading" }
  | { kind: "ok"; status: ServerStatus }
  | { kind: "error"; message: string };

export function useServerStatus() {
  const [state, setState] = useState<ServerStatusState>({ kind: "loading" });
  const load = useCallback(() => {
    api
      .status()
      .then((status) => setState({ kind: "ok", status }))
      .catch((err: unknown) => setState({ kind: "error", message: err instanceof Error ? err.message : String(err) }));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const reload = useCallback(() => {
    setState({ kind: "loading" });
    load();
  }, [load]);
  return { state, reload };
}

export const ENV_LINE = "ANTHROPIC_API_KEY=sk-ant-…";

/** A page served from this computer (npm run dev) rather than a deployment. */
function onLocalHost(): boolean {
  if (typeof window === "undefined") return true;
  return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
}

/** Header right slot: one quiet status button. */
export function ServerStatusButton({ state, onRetry, onConnect }: { state: ServerStatusState; onRetry: () => void; onConnect: () => void }) {
  if (state.kind === "loading") {
    // holds the slot so the header does not shift when the status arrives
    return (
      <span aria-hidden="true" className="invisible inline-flex h-8 items-center px-3 text-[13px]">
        離線設計模式
      </span>
    );
  }
  const appear = "transition-opacity duration-(--dur-fast) ease-[ease] starting:opacity-0";
  if (state.kind === "error") {
    return (
      <Button variant="quiet" onClick={onRetry} className={cx("text-red-text! hover:text-red-text!", appear)} title={state.message}>
        {onLocalHost() ? "無法連線到本機伺服器，重試" : "無法連線到伺服器，重試"}
      </Button>
    );
  }
  if (!state.status.claude) {
    return (
      <Button variant="quiet" onClick={onConnect} trailingIcon={InfoIcon} className={appear} aria-haspopup="dialog">
        離線設計模式
      </Button>
    );
  }
  const { model } = state.status;
  return (
    <Popover
      label="Claude 已連線"
      placement="bottom-end"
      width={300}
      trigger={(p) => (
        <Button {...p} variant="quiet" className={appear}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-green" />
          Claude 已連線
        </Button>
      )}
    >
      <p className="text-[13px] leading-5 font-semibold text-label">研究與設計由 Claude 執行</p>
      <p className="mt-1 text-[13px] leading-5 text-label-2-on-material">
        Claude 會以樂團專職舞台視覺設計師的身分上網研究樂團與歌曲，再設計主視覺與每一段的畫面。
      </p>
      <p className="mt-3 text-[12px] leading-4 text-label-2-on-material">
        模型 <span className="font-mono text-label">{model}</span>
      </p>
    </Popover>
  );
}

/** The one quiet line under the hero subtitle (offline), or the error banner (server unreachable). */
export function ServerStatusLine({ state, onRetry, onConnect, className }: { state: ServerStatusState; onRetry: () => void; onConnect: () => void; className?: string }) {
  if (state.kind === "error") {
    const local = onLocalHost();
    return (
      <Banner
        tone="error"
        title={local ? "連不上 Livelyrics 本機伺服器" : "連不上 Livelyrics 伺服器"}
        description={
          local ? (
            <>
              請確認終端機裡的 <code className="font-mono">npm run dev</code> 仍在執行。（{state.message}）
            </>
          ) : (
            <>請稍後再試；剛部署完成時，可以到 Vercel 的 Deployments 頁面確認部署狀態。（{state.message}）</>
          )
        }
        actions={<Button onClick={onRetry}>重試</Button>}
        className={cx("mx-auto max-w-[640px] text-left", className)}
      />
    );
  }
  const offline = state.kind === "ok" && !state.status.claude;
  // loading and connected keep the line's height, so the dropzone does not move
  return (
    <p className={cx("min-h-5 text-[13px] leading-5 text-label-2", className)} aria-live="polite">
      {offline && (
        <span className="transition-opacity duration-(--dur-fast) ease-[ease] starting:opacity-0">
          目前使用離線設計模式，不會上網研究樂團。
          <button type="button" onClick={onConnect} aria-haspopup="dialog" className="press-fade rounded-xs text-tint-text hover:underline hover:underline-offset-2">
            連接 Claude
          </button>
        </span>
      )}
    </p>
  );
}

function CodeLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text.replace("…", ""));
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the text is selectable */
    }
  };
  return (
    <div className="mt-2 flex min-w-0 items-center gap-2 rounded-sm bg-fill-3 py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-[13px] leading-5 text-label select-all">{text}</code>
      <Button size="sm" variant="gray" icon={copied ? CheckCircleIcon : CopyIcon} onClick={copy} aria-live="polite">
        {copied ? "已複製" : "複製"}
      </Button>
    </div>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span aria-hidden="true" className="mt-px flex size-[22px] shrink-0 items-center justify-center rounded-full bg-fill-3 text-[13px] leading-none font-semibold text-label tabular">
      {n}
    </span>
  );
}

/** 「連接 Claude」: the three steps to switch from the offline designer to Claude. */
export function ConnectClaudeSheet({ open, onClose, state, onRecheck }: { open: boolean; onClose: () => void; state: ServerStatusState; onRecheck: () => void }) {
  const [checked, setChecked] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setChecked(false);
  }
  const checking = state.kind === "loading";
  const connected = state.kind === "ok" && state.status.claude;
  // where the key goes depends on where the server runs
  const [vercel, setVercel] = useState(false);
  if (state.kind === "ok" && (state.status.storage?.onVercel ?? false) !== vercel) setVercel(state.status.storage?.onVercel ?? false);
  const recheck = () => {
    setChecked(true);
    onRecheck();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="連接 Claude"
      cancelLabel="關閉"
      action={
        connected ? (
          <Button variant="filled" onClick={onClose}>
            完成
          </Button>
        ) : (
          <Button variant="filled" onClick={recheck} loading={checking}>
            重新檢查
          </Button>
        )
      }
    >
      <p className="text-[15px] leading-[22px] text-label">
        目前由內建的離線設計師依音訊能量與歌詞重複段落產生方案，不會上網研究。連接 Claude 後，會以樂團專職舞台視覺設計師的身分研究樂團與歌曲，再設計主視覺。
      </p>
      {vercel ? (
        <ol className="mt-5 divide-y-hairline overflow-hidden rounded-lg bg-fill-4" aria-label="在 Vercel 設定">
          <li className="flex gap-3 px-4 py-3">
            <StepNumber n={1} />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] leading-[22px] text-label">
                在 Vercel 專案的 <span className="font-semibold">Settings › Environment Variables</span> 新增 <code className="font-mono text-[13px]">ANTHROPIC_API_KEY</code>
              </p>
              <CodeLine text={ENV_LINE} />
            </div>
          </li>
          <li className="flex gap-3 px-4 py-3">
            <StepNumber n={2} />
            <p className="min-w-0 flex-1 text-[15px] leading-[22px] text-label">
              到 <span className="font-semibold">Deployments</span>，在最新的部署選「Redeploy」。環境變數只會套用到新的部署。
            </p>
          </li>
          <li className="flex gap-3 px-4 py-3">
            <StepNumber n={3} />
            <p className="min-w-0 flex-1 text-[15px] leading-[22px] text-label">部署完成後回到這裡按「重新檢查」。</p>
          </li>
        </ol>
      ) : (
        <ol className="mt-5 divide-y-hairline overflow-hidden rounded-lg bg-fill-4" aria-label="在這台電腦設定">
          <li className="flex gap-3 px-4 py-3">
            <StepNumber n={1} />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] leading-[22px] text-label">
                在專案根目錄的 <code className="font-mono text-[13px]">.env.local</code> 加入這一行
              </p>
              <CodeLine text={ENV_LINE} />
            </div>
          </li>
          <li className="flex gap-3 px-4 py-3">
            <StepNumber n={2} />
            <p className="min-w-0 flex-1 text-[15px] leading-[22px] text-label">
              在執行伺服器的終端機按 <Kbd keys="Ctrl+C" className="align-[1px]" />，再執行 <code className="font-mono text-[13px]">npm run dev</code>
            </p>
          </li>
          <li className="flex gap-3 px-4 py-3">
            <StepNumber n={3} />
            <p className="min-w-0 flex-1 text-[15px] leading-[22px] text-label">回到這裡按「重新檢查」。</p>
          </li>
        </ol>
      )}
      <p className="mt-3 min-h-5 text-[13px] leading-5" aria-live="polite">
        {checked && checking && <Spinner label="檢查中…" />}
        {checked && connected && (
          <span className="inline-flex items-center gap-1.5 text-label">
            <CheckCircleIcon size={16} weight="fill" className="text-green" />
            Claude 已連線，接下來的作品會由 Claude 研究與設計。
          </span>
        )}
        {checked && state.kind === "ok" && !connected && (
          <span className="text-label-2">{vercel ? "仍是離線設計模式。確認已加入 ANTHROPIC_API_KEY，並重新部署。" : "仍是離線設計模式。確認金鑰已存檔，並重新啟動伺服器。"}</span>
        )}
        {checked && state.kind === "error" && <span className="text-red-text">{vercel ? "連不上伺服器" : "連不上本機伺服器"}：{state.message}</span>}
      </p>
    </Sheet>
  );
}

function Done() {
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 align-[-2px] text-[13px] text-label-2">
      <CheckCircleIcon size={14} weight="fill" className="text-green" />
      已完成
    </span>
  );
}

/** A Vercel variable name in the setup steps (monospace). */
function EnvName({ children }: { children: string }) {
  return <code className="font-mono text-[13px] whitespace-nowrap">{children}</code>;
}

/** What the home page's setup notice needs (from the server render, then /api/status). */
export interface StorageSetup {
  missing: string[];
  /** a Blob store is connected through OIDC (BLOB_STORE_ID) but BLOB_READ_WRITE_TOKEN is not set */
  blobStoreWithoutToken: boolean;
}

/**
 * On Vercel without Blob / Postgres (storage mode "unconfigured"): what to create in the dashboard,
 * in place of the upload flow. The API answers 503 with the same explanation meanwhile. A Blob store
 * connected through OIDC only (newer connections inject BLOB_STORE_ID, not the read-write token the
 * upload route signs with) gets the specific step: copy the token into the project's variables.
 */
export function StorageSetupNotice({
  missing,
  blobStoreWithoutToken = false,
  onRecheck,
  checking,
  className,
}: {
  missing: string[];
  blobStoreWithoutToken?: boolean;
  onRecheck: () => void;
  checking: boolean;
  className?: string;
}) {
  const needBlob = missing.length === 0 || missing.includes("BLOB_READ_WRITE_TOKEN");
  const tokenOnly = needBlob && blobStoreWithoutToken;
  const needDb = missing.length === 0 || missing.includes("DATABASE_URL");
  return (
    <section aria-labelledby="storage-setup-title" className={cx("mx-auto w-full max-w-[680px] rounded-2xl bg-surface p-6 text-left shadow-card max-sm:p-4", className)}>
      <div className="flex items-start gap-3">
        <WarningIcon size={24} weight="fill" className="mt-0.5 shrink-0 text-orange" />
        <div className="min-w-0 flex-1">
          <h2 id="storage-setup-title" className="text-title-3 text-label">還沒設定雲端儲存空間</h2>
          <p className="mt-1 text-subheadline text-label-2">
            Livelyrics 在 Vercel 上把音檔與素材存在 Vercel Blob、作品資料存在 Postgres。請在 Vercel 儀表板建立並連接到這個專案，再重新部署。
          </p>
        </div>
      </div>
      <ol className="mt-5 divide-y-hairline overflow-hidden rounded-lg bg-fill-4">
        <li className="flex gap-3 px-4 py-3">
          <StepNumber n={1} />
          {tokenOnly ? (
            <p className="min-w-0 flex-1 text-[15px] leading-[22px] text-label" data-testid="blob-token-hint">
              <span className="font-semibold">Blob 已連接，但缺少讀寫金鑰</span>：到 <span className="font-semibold">Vercel › Storage › 這個 Blob store</span> 的{" "}
              <span className="font-semibold">.env.local</span> 分頁（或 <span className="font-semibold">Settings</span>）複製 <EnvName>BLOB_READ_WRITE_TOKEN</EnvName>，加到專案的{" "}
              <span className="font-semibold">Environment Variables</span>（Production、Preview），再 Redeploy。
            </p>
          ) : (
            <p className="min-w-0 flex-1 text-[15px] leading-[22px] text-label">
              <span className="font-semibold">Storage › Create › Blob</span>，存取權限選 <span className="font-semibold">Public</span>，連接到這個專案（會加入 <EnvName>BLOB_READ_WRITE_TOKEN</EnvName>）。
              {!needBlob && <Done />}
            </p>
          )}
        </li>
        <li className="flex gap-3 px-4 py-3">
          <StepNumber n={2} />
          <p className="min-w-0 flex-1 text-[15px] leading-[22px] text-label">
            <span className="font-semibold">Storage › Marketplace › Neon</span>（Postgres），連接到這個專案（會加入 <EnvName>DATABASE_URL</EnvName>）。
            {!needDb && <Done />}
          </p>
        </li>
        <li className="flex gap-3 px-4 py-3">
          <StepNumber n={3} />
          <p className="min-w-0 flex-1 text-[15px] leading-[22px] text-label">
            選用：在 <span className="font-semibold">Settings › Environment Variables</span> 加入 <EnvName>LIVELYRICS_PASSWORD</EnvName>（登入密碼）與 <EnvName>ANTHROPIC_API_KEY</EnvName>。
          </p>
        </li>
        <li className="flex gap-3 px-4 py-3">
          <StepNumber n={4} />
          <p className="min-w-0 flex-1 text-[15px] leading-[22px] text-label">
            到 <span className="font-semibold">Deployments</span> 選「Redeploy」，完成後回到這裡按「重新檢查」。
          </p>
        </li>
      </ol>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-footnote text-label-2">
          {missing.length > 0 ? (
            <>
              目前缺少：
              {missing.map((m, i) => (
                <span key={m}>
                  {i > 0 && "、"}
                  <EnvName>{m}</EnvName>
                </span>
              ))}
            </>
          ) : (
            "設定好之後，作品、音檔與素材都會存在你的 Vercel 帳號裡。"
          )}
        </p>
        <Button variant="filled" onClick={onRecheck} loading={checking}>
          重新檢查
        </Button>
      </div>
    </section>
  );
}
