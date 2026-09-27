// Document ids (projects, bands, shows): lowercase letters, digits and inner dashes only, never
// "." or "/" (no path traversal in the local layout, safe as a blob pathname segment).

import { randomUUID } from "node:crypto";

export const DOC_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function isValidDocId(id: unknown): id is string {
  return typeof id === "string" && DOC_ID_RE.test(id);
}

/** 12 hex chars from a random UUID (48 bits; collisions are checked on create). */
export function newDocId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}
