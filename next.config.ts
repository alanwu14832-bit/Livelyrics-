import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allows running several isolated dev servers side by side (e.g. NEXT_DIST_DIR=.next-stage).
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
