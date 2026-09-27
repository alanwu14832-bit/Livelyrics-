import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allows running several isolated dev servers side by side (e.g. NEXT_DIST_DIR=.next-stage).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The projection window must never show dev UI on the LED wall.
  devIndicators: false,
  // Server code resolves data paths from process.cwd(), which makes file tracing pull in the
  // whole repo. Keep dev fixtures, docs and local data out of the serverless bundles.
  outputFileTracingExcludes: {
    "*": ["./fixtures/**", "./research_notes/**", "./reports/**", "./docs/**", "./scripts/**", "./data/**", "./.next-*/**", "./.e2e-shots/**"],
  },
};

export default nextConfig;
