// Copies the onnxruntime-web WebAssembly runtime into public/ort/ so the
// classifier can load it from our own origin. The CSP allows scripts from
// 'self' only, so the runtime cannot come from a CDN; and public/ort/ is
// gitignored because a 14 MB binary that npm already ships has no business in
// the repository's history. Runs before dev and build.
const fs = require("node:fs");
const path = require("node:path");

const src = path.join(__dirname, "..", "node_modules", "onnxruntime-web", "dist");
const dst = path.join(__dirname, "..", "public", "ort");
// The plain SIMD build. The jsep (WebGPU) and asyncify variants are larger and
// not needed for a 96-pixel classifier.
const files = ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"];

fs.mkdirSync(dst, { recursive: true });
for (const name of files) {
  const from = path.join(src, name);
  if (!fs.existsSync(from)) {
    console.error(`copy-ort-wasm: ${from} not found; is onnxruntime-web installed?`);
    process.exit(1);
  }
  const to = path.join(dst, name);
  if (!fs.existsSync(to) || fs.statSync(to).size !== fs.statSync(from).size) {
    fs.copyFileSync(from, to);
  }
}
