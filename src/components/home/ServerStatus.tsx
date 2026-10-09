"use client";

// Server status on the home page (UI-AUDIT §3.5 首頁, UI-14). Without an API key the app runs in
// 基本模式 (the 免費研究: public facts from MusicBrainz / Wikipedia + the lyric and audio analysis,
// and the built-in designer), a normal, supported mode, so it is a quiet status and never a warning:
//   - header (right slot): a quiet text button, 「基本模式」 + Info (its tooltip says what it does and
//     what a key adds), or 「Claude 已連線」 with the 6 px green dot; both open the 「設定」 sheet
//   - under the hero subtitle: one 13 px label-2 line with a plain 「加入 API 金鑰」 link
//   - the 「設定」 sheet (round 13, no developer vocabulary): what an API key is and what it adds, the
//     no-cost 用 claude.ai 研究 alternative, 「到 Anthropic Console 建立金鑰」, then where the key goes
//     on this deployment. Local: a password field that saves it in this computer's data folder
//     (/api/settings/api-key; the browser only ever sees a masked form, 「移除金鑰」 deletes it).
//     Vercel: the project's Environment Variables in two sentences. A key in the server's environment
//     wins and is only named, never shown.
// A server that cannot be reached is a real error: a Banner with 「重試」. On Vercel without Blob /
// Postgres the home page shows StorageSetupNotice instead of the upload flow.

import { useCallback, useEffect, useState } from "react";
import { Banner, Button, Popover, Sheet, Spinner, TextField, Tooltip, cx } from "@/components/ui";
import { ArrowSquareOutIcon, CheckCircleIcon, InfoIcon, WarningIcon } from "@/components/ui/Icon";
import { api, type ApiKeyStatus, type ServerStatus } from "@/lib/api-client";

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

/** Where Anthropic's keys are created. */
export const CONSOLE_KEYS_URL = "https://console.anthropic.com/settings/keys";

/** The header badge's tooltip: what 基本模式 does and what a key adds. */
export const BASIC_MODE_TIP =
  "基本模式：查公開資料（MusicBrainz、維基百科），分析歌詞與音訊，由內建設計師產生方案，不需要金鑰、不會產生費用。加入 Anthropic API 金鑰後，Claude 會上網深入研究樂團與歌曲，親手設計主視覺、每一段的畫面和這首歌的專屬畫面。";

/** A page served from this computer rather than a deployment. */
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
        基本模式
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
      <Tooltip content={BASIC_MODE_TIP} placement="bottom-end">
        <Button variant="quiet" onClick={onConnect} trailingIcon={InfoIcon} className={appear} aria-haspopup="dialog" data-testid="basic-mode">
          基本模式
        </Button>
      </Tooltip>
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
      <p className="mt-2 text-[13px] leading-5 text-label-2-on-material">想省下 API 費用時，重新設計可以選「免費研究」，或在設計總覽用 claude.ai 研究。</p>
      <p className="mt-3 text-[12px] leading-4 text-label-2-on-material">
        模型 <span className="font-mono text-label">{model}</span>
      </p>
      <Button size="sm" variant="gray" className="mt-3" onClick={onConnect}>
        金鑰設定
      </Button>
    </Popover>
  );
}

/** The one quiet line under the hero subtitle (basic mode), or the error banner (server unreachable). */
export function ServerStatusLine({ state, onRetry, onConnect, className }: { state: ServerStatusState; onRetry: () => void; onConnect: () => void; className?: string }) {
  if (state.kind === "error") {
    const local = onLocalHost();
    return (
      <Banner
        tone="error"
        title={local ? "連不上 Livelyrics" : "連不上 Livelyrics 伺服器"}
        description={
          local ? (
            <>請確認啟動 Livelyrics 的視窗還開著（關掉它，這個頁面就連不上）。（{state.message}）</>
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
          目前是基本模式：查公開資料，再分析歌詞與音訊，不需要金鑰。
          <button type="button" onClick={onConnect} aria-haspopup="dialog" className="press-fade rounded-xs text-tint-text hover:underline hover:underline-offset-2">
            加入 API 金鑰
          </button>
        </span>
      )}
    </p>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span aria-hidden="true" className="mt-px flex size-[22px] shrink-0 items-center justify-center rounded-full bg-fill-3 text-[13px] leading-none font-semibold text-label tabular">
      {n}
    </span>
  );
}

/** The local 「設定」 form: paste, 儲存金鑰; a saved key shows masked with 「移除金鑰」. */
function LocalKeyForm({ open, onChanged }: { open: boolean; onChanged: () => void }) {
  const [info, setInfo] = useState<ApiKeyStatus | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .apiKeyStatus()
      .then((s) => {
        if (!cancelled) setInfo(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const save = async () => {
    const key = value.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.saveApiKey(key);
      setInfo(next);
      setValue(""); // the field never keeps the key once it is saved
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      setInfo(await api.removeApiKey());
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (info?.source === "env") {
    return (
      <p className="mt-2 text-[13px] leading-5 text-label-2" data-testid="key-from-env">
        啟動這台伺服器時已經提供了金鑰，會優先使用它；這裡不需要再貼。
      </p>
    );
  }
  if (info?.source === "settings" && info.masked) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-3" data-testid="key-saved">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[15px] leading-[22px] text-label">
          <CheckCircleIcon size={16} weight="fill" className="shrink-0 text-green" />
          已儲存金鑰 <span className="font-mono text-[13px] text-label-2">{info.masked}</span>
        </span>
        <Button size="sm" variant="gray" className="text-red-text!" onClick={() => void remove()} loading={busy}>
          移除金鑰
        </Button>
        {error && <p className="w-full text-[13px] leading-5 text-red-text">{error}</p>}
      </div>
    );
  }
  return (
    <form
      className="mt-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex gap-2">
        <TextField
          size="lg"
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-label="Anthropic API 金鑰"
          placeholder="sk-ant-…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          invalid={!!error}
          className="min-w-0 flex-1 font-mono"
        />
        <Button type="submit" variant="filled" loading={busy} disabled={!value.trim()} className="h-10">
          儲存金鑰
        </Button>
      </div>
      <p className={cx("mt-1.5 text-[13px] leading-5", error ? "text-red-text" : "text-label-2")}>
        {error ?? "金鑰只存在這台電腦的 Livelyrics 資料夾裡，之後只會顯示末四碼，只用來呼叫 Claude。"}
      </p>
    </form>
  );
}

/** 「設定」: what an API key is and adds, the claude.ai alternative, and where the key goes on this deployment. */
export function ConnectClaudeSheet({ open, onClose, state, onRecheck }: { open: boolean; onClose: () => void; state: ServerStatusState; onRecheck: () => void }) {
  const [checked, setChecked] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setChecked(false);
  }
  const checking = state.kind === "loading";
  const connected = state.kind === "ok" && state.status.claude;
  // where the key goes depends on where the server runs (kept while a re-check is loading)
  const [where, setWhere] = useState<"local" | "vercel" | "env">("local");
  if (state.kind === "ok") {
    const onVercel = state.status.storage?.onVercel ?? false;
    const editable = state.status.keyEditable ?? !onVercel;
    const next = editable ? "local" : onVercel ? "vercel" : "env";
    if (next !== where) setWhere(next);
  }
  const recheck = () => {
    setChecked(true);
    onRecheck();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="設定"
      cancelLabel="關閉"
      action={
        connected || where === "local" ? (
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
        {connected ? (
          <>
            目前由 <span className="font-semibold">Claude</span> 研究與設計。
          </>
        ) : (
          <>
            目前是<span className="font-semibold">基本模式</span>：查詢 MusicBrainz 與維基百科的公開資料（曲風、發行年份、樂團介紹），再分析歌詞的意象與情緒、音訊的速度與能量，由內建設計師產生方案。不需要金鑰，也不會產生費用。
          </>
        )}
      </p>

      <h3 className="mt-5 text-[15px] leading-[22px] font-semibold text-label">什麼是 API 金鑰？</h3>
      <p className="mt-0.5 text-[15px] leading-[22px] text-label-2">
        一串以 <span className="font-mono text-[13px]">sk-ant-</span> 開頭的密碼，讓 Livelyrics 用你的 Anthropic 帳號呼叫 Claude。費用依用量計算，直接記在你的帳號上。加入之後：
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] leading-[22px] text-label-2">
        <li>Claude 會上網研究樂團與這首歌：訪談、MV、樂團的視覺風格。</li>
        <li>主視覺、每一段的畫面和這首歌的專屬畫面由 Claude 依研究親手設計。</li>
        <li>可以用一句話請它重新設計（例如「副歌更暗一點、多一點留白」）。</li>
      </ul>

      <div className="mt-4 rounded-lg bg-fill-4 px-4 py-3">
        <p className="text-[15px] leading-[22px] font-semibold text-label">想要 Claude 深入研究，又不想付 API 費用？</p>
        <p className="mt-0.5 text-[13px] leading-5 text-label-2">
          在設計總覽按「用 claude.ai 研究」：把提示詞複製到你自己的 claude.ai 對話，再把 Claude 的回覆貼回來，就會套用成設計方案。
        </p>
      </div>

      <ol className="mt-4 divide-y-hairline overflow-hidden rounded-lg bg-fill-4" aria-label="加入 API 金鑰">
        <li className="flex gap-3 px-4 py-3">
          <StepNumber n={1} />
          <p className="min-w-0 flex-1 text-[15px] leading-[22px] text-label">
            <a href={CONSOLE_KEYS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-tint-text hover:underline hover:underline-offset-2">
              到 Anthropic Console 建立金鑰
              <ArrowSquareOutIcon size={14} />
            </a>
            ：登入後按「Create Key」，複製那串 sk-ant- 開頭的文字。
          </p>
        </li>
        <li className="flex gap-3 px-4 py-3">
          <StepNumber n={2} />
          <div className="min-w-0 flex-1">
            {where === "local" ? (
              <>
                <p className="text-[15px] leading-[22px] text-label">貼在這裡，按「儲存金鑰」。</p>
                <LocalKeyForm open={open} onChanged={onRecheck} />
              </>
            ) : where === "vercel" ? (
              <p className="text-[15px] leading-[22px] text-label" data-testid="key-vercel-steps">
                到 Vercel 這個專案的 <span className="font-semibold">Settings › Environment Variables</span>，新增名稱為 <span className="font-mono text-[13px]">ANTHROPIC_API_KEY</span>
                、值是剛剛複製的金鑰的變數。存檔後到 <span className="font-semibold">Deployments</span> 選「Redeploy」，新的部署就會由 Claude 研究與設計（完成後回到這裡按「重新檢查」）。
              </p>
            ) : (
              <p className="text-[15px] leading-[22px] text-label">
                這個部署的金鑰由主機的環境變數 <span className="font-mono text-[13px]">ANTHROPIC_API_KEY</span> 提供：請管理這台主機的人加入金鑰並重新啟動，再回到這裡按「重新檢查」。
              </p>
            )}
          </div>
        </li>
      </ol>
      <p className="mt-3 min-h-5 text-[13px] leading-5" aria-live="polite">
        {checking && checked && <Spinner label="檢查中…" />}
        {!checking && connected && (
          <span className="inline-flex items-center gap-1.5 text-label" data-testid="claude-connected">
            <CheckCircleIcon size={16} weight="fill" className="text-green" />
            Claude 已連線，接下來的作品會由 Claude 研究與設計。
          </span>
        )}
        {checked && state.kind === "ok" && !connected && where !== "local" && <span className="text-label-2">仍是基本模式。確認變數已存檔，並重新部署。</span>}
        {checked && state.kind === "error" && <span className="text-red-text">連不上伺服器：{state.message}</span>}
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
