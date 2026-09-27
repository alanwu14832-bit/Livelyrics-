"use client";

// Sign-in for the password gate, in the Apple ID sign-in manner: the app icon, one title, one
// sentence, a single secure field and one filled capsule button, centered on the system
// background (follows light / dark). Works without JavaScript too (a plain form post to
// /api/auth/login answers with a redirect); with JavaScript the error stays in place.

import { useId, useRef, useState, type FormEvent } from "react";
import { BrandMark } from "@/components/home/Brand";
import { Button, TextField } from "@/components/ui";
import { EyeIcon, EyeSlashIcon } from "@/components/ui/Icon";

export function LoginForm({ next, initialError }: { next: string; initialError: string | null }) {
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);
  const fieldId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    if (!password) {
      setError("請輸入密碼。");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, next }),
      });
      const body = (await res.json().catch(() => null)) as { next?: string; error?: string } | null;
      if (res.ok) {
        window.location.replace(body?.next || next);
        return;
      }
      setError(body?.error || "登入失敗，請再試一次。");
      setBusy(false);
      inputRef.current?.select();
    } catch {
      setError("無法連線到伺服器，請檢查網路後再試一次。");
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 pt-12 pb-24">
      <form method="post" action="/api/auth/login" onSubmit={(e) => void submit(e)} className="flex w-full max-w-[380px] flex-col items-center text-center" noValidate>
        <input type="hidden" name="next" value={next} />
        <BrandMark size={72} className="drop-shadow-[0_8px_24px_rgba(139,108,255,0.28)]" />
        <h1 className="mt-6 text-title-1 text-label">登入 Livelyrics</h1>
        <p className="mt-2 text-subheadline text-label-2">這個 Livelyrics 以密碼保護，輸入密碼後繼續。</p>

        <div className="mt-8 w-full text-left">
          <label htmlFor={fieldId} className="sr-only">
            密碼
          </label>
          <div className="relative">
            <TextField
              ref={inputRef}
              id={fieldId}
              name="password"
              size="lg"
              type={reveal ? "text" : "password"}
              autoComplete="current-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              placeholder="密碼"
              value={password}
              invalid={!!error}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              className="h-12 rounded-md pr-12 text-[17px]"
            />
            <span className="absolute inset-y-0 right-2 flex items-center">
              <Button
                variant="quiet"
                size="icon"
                icon={reveal ? EyeSlashIcon : EyeIcon}
                aria-label={reveal ? "隱藏密碼" : "顯示密碼"}
                aria-pressed={reveal}
                onClick={() => setReveal((v) => !v)}
              />
            </span>
          </div>
          <p id={errorId} role={error ? "alert" : undefined} aria-live="polite" className="mt-2 min-h-5 px-1 text-footnote text-red-text">
            {error}
          </p>
        </div>

        <Button type="submit" variant="filled" size="lg" loading={busy} className="mt-4 w-full">
          登入
        </Button>
        <p className="mt-6 text-caption text-label-2">密碼由部署時的環境變數 LIVELYRICS_PASSWORD 設定。</p>
      </form>
    </main>
  );
}
