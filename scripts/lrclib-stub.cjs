// A stand-in for LRCLIB during the e2e runs (round 20): every search finds nothing and every exact
// lookup is a 404, at once, so the home page's automatic lyric search never reaches the internet and
// never races a test. Start it next to the server and point the server at it:
//
//   LRCLIB_STUB_PORT=3429 node scripts/lrclib-stub.cjs &
//   LIVELYRICS_LRCLIB_URL=http://127.0.0.1:3429/lrclib/api npx next start -p 3100
//
// (scripts/e2e-free-research.cjs's own stub answers the same two paths.)
const http = require("node:http");

const PORT = Number(process.env.LRCLIB_STUB_PORT || 3429);

const server = http.createServer((req, res) => {
  const p = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname;
  if (p === "/lrclib/api/search") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end("[]");
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end('{"code":404,"name":"TrackNotFound","message":"Failed to find specified track"}');
});
server.listen(PORT, "127.0.0.1", () => console.log(`LRCLIB stub on http://127.0.0.1:${PORT}/lrclib/api`));
