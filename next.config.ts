import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * 「AI 自動對時」 (round 15) runs ONNX Runtime Web in the lyric editor's worker. Its WebAssembly
 * files are self-hosted rather than fetched from a CDN: copied here from node_modules/onnxruntime-web/dist
 * into public/ort/<version>/ (git-ignored) whenever Next loads this config (dev, build — on Vercel
 * too — and start), and served with an immutable cache header. Returns the public base path.
 */
function selfHostOrtWasm(): string {
  const FILES = ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"];
  try {
    const require = createRequire(path.join(process.cwd(), "package.json"));
    const dist = path.dirname(require.resolve("onnxruntime-web"));
    const version = (JSON.parse(fs.readFileSync(path.join(dist, "..", "package.json"), "utf8")) as { version: string }).version;
    const root = path.join(process.cwd(), "public", "ort");
    const target = path.join(root, version);
    fs.mkdirSync(target, { recursive: true });
    for (const f of FILES) {
      const from = path.join(dist, f);
      const to = path.join(target, f);
      if (!fs.existsSync(to) || fs.statSync(to).size !== fs.statSync(from).size) fs.copyFileSync(from, to);
    }
    // an older runtime's files would only take space in the deployment
    for (const old of fs.readdirSync(root)) if (old !== version) fs.rmSync(path.join(root, old), { recursive: true, force: true });
    return `/ort/${version}/`;
  } catch (err) {
    console.warn(`[livelyrics] could not copy the ONNX Runtime WebAssembly files: ${err instanceof Error ? err.message : String(err)}`);
    return "/ort/missing/";
  }
}

const ORT_WASM_BASE = selfHostOrtWasm();

const nextConfig: NextConfig = {
  // Allows running several isolated dev servers side by side (e.g. NEXT_DIST_DIR=.next-stage).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The projection window must never show dev UI on the LED wall.
  devIndicators: false,
  // where the lyric editor's 「AI 自動對時」 worker loads ONNX Runtime's WebAssembly (see above)
  env: { LIVELYRICS_ORT_WASM_BASE: ORT_WASM_BASE },
  experimental: {
    // Local-mode uploads pass through the password proxy (src/proxy.ts), and Next buffers a
    // proxied request body only up to this size (10 MB by default): a longer body was cut short
    // and the route saw an incomplete multipart upload. The limit covers the audio upload
    // (MAX_AUDIO_BYTES, 200 MB) plus the form overhead (FORM_OVERHEAD_BYTES, 64 MB);
    // src/lib/server/upload-limit.test.ts keeps them in step.
    proxyClientMaxBodySize: "264mb",
  },
  // Server code resolves data paths from process.cwd(), which makes file tracing pull in the
  // whole repo. Keep dev fixtures, docs and local data out of the serverless bundles — and the
  // speech recogniser, which only ever runs in the browser.
  outputFileTracingExcludes: {
    "*": [
      "./fixtures/**",
      "./research_notes/**",
      "./reports/**",
      "./docs/**",
      "./scripts/**",
      "./data/**",
      "./.next-*/**",
      "./.e2e-shots/**",
      "./scratch/**",
      "./public/ort/**",
      "./node_modules/@huggingface/**",
      "./node_modules/onnxruntime-node/**",
      "./node_modules/onnxruntime-web/**",
      "./node_modules/onnxruntime-common/**",
    ],
  },
  async headers() {
    return [
      {
        // versioned path (public/ort/<version>/): the files never change under one URL
        source: "/ort/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
  webpack(config, { isServer, webpack }) {
    if (isServer) {
      // the lyric editor's SSR pass compiles its 「AI 自動對時」 worker too (it only ever runs in the
      // browser): an empty stand-in keeps transformers.js out of the server bundle and its tracing
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/asr\.worker\.ts$/, path.join(process.cwd(), "src/lib/asr/asr.worker.server.ts")));
    } else {
      config.resolve ??= {};
      config.resolve.alias = {
        ...config.resolve.alias,
        // transformers.js' web build never needs these Node packages: keep them out of client chunks
        "onnxruntime-node": false,
        sharp: false,
        // ONNX Runtime Web without its bundled copy of the WebAssembly glue: the worker points it at
        // the self-hosted files (selfHostOrtWasm), and webpack does not emit a second 27 MB copy
        "onnxruntime-web/webgpu$": path.join(path.dirname(createRequire(path.join(process.cwd(), "package.json")).resolve("onnxruntime-web")), "ort.webgpu.min.mjs"),
      };
    }
    return config;
  },
};

export default nextConfig;
