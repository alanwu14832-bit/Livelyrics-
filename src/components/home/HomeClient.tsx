"use client";

// Home (UI-AUDIT §3.5 首頁): apple.com product-page rhythm. One 56 px headline, a two-line intro,
// a quiet status line (offline is a normal mode), and the dropzone as the hero object; the
// library below. The hero fades up once per document load (3.4.1 item 6), not on every return.

import { useEffect, useState } from "react";
import { AppHeader, Button, cx, pageContainerClass } from "@/components/ui";
import { SignOutIcon } from "@/components/ui/Icon";
import { UploadFlow } from "@/components/upload/UploadFlow";
import { BandShelf } from "./BandShelf";
import { Brand } from "./Brand";
import { ProjectLibrary } from "./ProjectLibrary";
import type { ProjectSummary } from "@/lib/types";
import { ConnectClaudeSheet, ServerStatusButton, ServerStatusLine, StorageSetupNotice, useServerStatus, type StorageSetup } from "./ServerStatus";

/** Sign out of the password gate (a plain form post: works before hydration too). */
function SignOutButton() {
  return (
    <form method="post" action="/api/auth/logout" className="contents">
      <Button type="submit" variant="quiet" size="icon" icon={SignOutIcon} aria-label="登出" title="登出" />
    </form>
  );
}

let introPlayed = false;

/** One-shot fade-up (spring), 60 ms apart; opacity only with reduced motion (data-motion="move"). */
function reveal(step: number) {
  return cx("animate-[ui-reveal_var(--dur-spring)_var(--ease-spring)_backwards]", step === 1 && "[animation-delay:60ms]", step === 2 && "[animation-delay:120ms]", step === 3 && "[animation-delay:180ms]");
}

export function HomeClient({
  initialProjects = null,
  serverNow,
  initialBandId,
  initialSetup = null,
}: {
  initialProjects?: ProjectSummary[] | null;
  serverNow?: number;
  initialBandId?: string;
  /** on Vercel without cloud storage: the variables still missing (the setup notice replaces the upload flow) */
  initialSetup?: StorageSetup | null;
}) {
  const { state, reload } = useServerStatus();
  const [connectOpen, setConnectOpen] = useState(false);
  const [intro] = useState(() => !introPlayed);
  useEffect(() => {
    introPlayed = true;
  }, []);
  const motion = intro ? "move" : undefined;
  const openConnect = () => setConnectOpen(true);
  // on Vercel without Blob / Postgres: the setup steps take the upload flow's place
  const [setup, setSetup] = useState<StorageSetup | null>(initialSetup);
  if (state.kind === "ok") {
    const storage = state.status.storage;
    const next = storage?.mode === "unconfigured" ? { missing: storage.missing, blobStoreWithoutToken: Boolean(storage.blobStoreWithoutToken) } : null;
    if (JSON.stringify(next) !== JSON.stringify(setup)) setSetup(next);
  }
  const signedIn = state.kind === "ok" && state.status.auth;

  return (
    <div className="min-h-dvh">
      <AppHeader
        leading={<Brand />}
        actions={
          <>
            <ServerStatusButton state={state} onRetry={reload} onConnect={openConnect} />
            {signedIn && <SignOutButton />}
          </>
        }
      />
      <main className={cx(pageContainerClass, "pb-32")}>
        <section aria-labelledby="new-song-title" className="pt-[72px]">
          <div className="text-center">
            <h1 id="new-song-title" data-motion={motion} className={cx("text-hero text-label max-md:text-[40px] max-md:leading-[48px]", intro && reveal(0))}>
              讓歌詞退居幕後，讓視覺托起樂團
            </h1>
            <p data-motion={motion} className={cx("mx-auto mt-4 max-w-[34em] text-intro text-label-2", intro && reveal(1))}>
              上傳一首歌，AI 以樂團專職舞台視覺設計師的角度，
              <br className="max-md:hidden" />
              設計主視覺與每一段的畫面。
            </p>
            <div data-motion={motion} className={cx("mt-3", intro && reveal(2))}>
              <ServerStatusLine state={state} onRetry={reload} onConnect={openConnect} />
            </div>
          </div>
          <div data-motion={motion} className={cx("mt-10", intro && reveal(3))}>
            {setup ? (
              <StorageSetupNotice missing={setup.missing} blobStoreWithoutToken={setup.blobStoreWithoutToken} onRecheck={reload} checking={state.kind === "loading"} />
            ) : (
              <UploadFlow defaultBandId={initialBandId} />
            )}
          </div>
        </section>
        {!setup && (
          <>
            <BandShelf className="mt-24" />
            <ProjectLibrary className="mt-20" initialProjects={initialProjects} serverNow={serverNow} />
          </>
        )}
      </main>
      <ConnectClaudeSheet open={connectOpen} onClose={() => setConnectOpen(false)} state={state} onRecheck={reload} />
    </div>
  );
}
