// Cloud mode: long band-level jobs (從作品產生視覺聖經, 整場弧線) are recorded on their document
// (Band.bibleJob, Show.arcJob), so a refreshed page shows them running and polls, and one that lost
// its request (the 300 s limit, a crash) is reported as failed instead of spinning forever.

import type { Band, JobState, Show } from "@/lib/types";

/** a running job older than this lost its request (300 s limit + margin) */
export const JOB_STALE_MS = 330_000;
export const JOB_STALE_MESSAGE = "上次的工作沒有完成（雲端每次最多 300 秒，可能逾時或中斷了），請重試。";

export function isJobRunning(job: JobState | undefined, now = Date.now()): boolean {
  if (job?.status !== "running") return false;
  const t = Date.parse(job.startedAt);
  return Number.isFinite(t) && now - t < JOB_STALE_MS;
}

/** The job as the API reports it: a stale "running" one becomes an error. */
export function liveJob(job: JobState | undefined, now = Date.now()): JobState | undefined {
  if (!job) return undefined;
  if (job.status === "running" && !isJobRunning(job, now)) return { status: "error", startedAt: job.startedAt, message: JOB_STALE_MESSAGE };
  return job;
}

export function withLiveBandJob(band: Band): Band {
  if (!band.bibleJob) return band;
  return { ...band, bibleJob: liveJob(band.bibleJob) };
}

export function withLiveShowJob(show: Show): Show {
  if (!show.arcJob) return show;
  return { ...show, arcJob: liveJob(show.arcJob) };
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message || err.name : String(err);
}
