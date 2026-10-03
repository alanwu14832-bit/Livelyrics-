import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allows running several isolated dev servers side by side (e.g. NEXT_DIST_DIR=.next-stage).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The projection window must never show dev UI on the LED wall.
  devIndicators: false,
  experimental: {
    // Local-mode uploads pass through the password proxy (src/proxy.ts), and Next buffers a
    // proxied request body only up to this size (10 MB by default): a longer body was cut short
    // and the route saw an incomplete multipart upload. The limit covers the audio upload
    // (MAX_AUDIO_BYTES, 200 MB) plus the form overhead (FORM_OVERHEAD_BYTES, 64 MB);
    // src/lib/server/upload-limit.test.ts keeps them in step.
    proxyClientMaxBodySize: "264mb",
  },
  // Server code resolves data paths from process.cwd(), which makes file tracing pull in the
  // whole repo. Keep dev fixtures, docs and local data out of the serverless bundles.
  outputFileTracingExcludes: {
    "*": ["./fixtures/**", "./research_notes/**", "./reports/**", "./docs/**", "./scripts/**", "./data/**", "./.next-*/**", "./.e2e-shots/**"],
  },
};

export default nextConfig;
