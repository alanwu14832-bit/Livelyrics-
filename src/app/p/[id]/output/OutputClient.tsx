"use client";

import { ProjectionOutput } from "@/components/stage/ProjectionOutput";
import { channelName } from "@/lib/stage/protocol";

/** The per-song projection window: this project only, on its own channel (see ProjectionOutput). */
export function OutputClient({ id }: { id: string }) {
  return <ProjectionOutput channel={channelName(id)} projectId={id} />;
}
