// The server build's stand-in for asr.worker.ts (next.config.ts swaps it in): the lyric editor's
// SSR pass compiles `new Worker(new URL("./asr.worker.ts", import.meta.url))` too, but a worker only
// ever runs in the browser. This keeps the speech recogniser (transformers.js, ONNX Runtime) out of
// the server bundle and out of the serverless file tracing.
export {};
