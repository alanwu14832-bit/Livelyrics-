/** Join class names, skipping falsy parts. Server-safe (plain function). */
export function cx(...parts: Array<string | false | null | undefined | 0>): string {
  return parts.filter(Boolean).join(" ");
}
