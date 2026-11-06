#!/usr/bin/env node
/*
 * A tiny local web server for the type-script page.
 *
 *   node serve.mjs <dir> [port]      (port defaults to 3018; 0 picks a free one)
 *
 * It serves the files in <dir> at http://127.0.0.1:<port>/ and nothing else: only this
 * computer can reach it, and paths that try to climb out of <dir> are refused.
 * Why it exists: the Claude desktop app's browser pane shows file:// pages as still
 * pictures, with no JavaScript. Over http the page runs. (A normal browser can still
 * open the HTML file directly.)
 *
 * No dependencies. Stop it with Ctrl+C (or by stopping the background task).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

const [dirArg, portArg] = process.argv.slice(2);
if (!dirArg) {
  console.error("Usage: node serve.mjs <dir> [port]   (port defaults to 3018)");
  process.exit(1);
}
const root = path.resolve(dirArg);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`serve: "${root}" is not a folder.`);
  process.exit(1);
}
const port = portArg === undefined ? 3018 : Number(portArg);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`serve: "${portArg}" is not a port number (use 0–65535).`);
  process.exit(1);
}

function send(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(text);
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Only GET and HEAD.");
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
  } catch {
    return send(res, 400, "Bad address.");
  }
  if (rel.includes("\0")) return send(res, 400, "Bad address.");
  // Decoding can turn %2f / %5c into slashes, so check where the path really lands.
  const file = path.resolve(root, "." + path.sep + rel);
  const inside = path.relative(root, file);
  if (inside.startsWith("..") || path.isAbsolute(inside)) return send(res, 403, "Outside the served folder.");

  let target = file;
  try {
    if (fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
    if (!fs.statSync(target).isFile()) return send(res, 404, "Not found.");
  } catch {
    return send(res, 404, "Not found.");
  }
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(target).toLowerCase()] || "application/octet-stream",
    "Content-Length": fs.statSync(target).size,
    // The page is regenerated in place, so always fetch the newest copy.
    "Cache-Control": "no-store",
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(target).on("error", () => res.destroy()).pipe(res);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`serve: port ${port} is already in use. It may be this server, already running; ` +
      `if so, just open the page. Otherwise pick another port: node serve.mjs "${dirArg}" ${port + 1}`);
  } else {
    console.error("serve: " + err.message);
  }
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`Serving ${root}`);
  console.log(`at ${url}`);
});
