import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allows running several isolated dev servers side by side (e.g. NEXT_DIST_DIR=.next-stage).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The projection window must never show dev UI on the LED wall.
  devIndicators: false,
};

export default nextConfig;
