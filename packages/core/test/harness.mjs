// Test harness for the DOM-free NSX core.
//
// The core ships as browser IIFEs that register onto window.NSXCore /
// window.NSXApi rather than ES exports, so we can't `import` them. Instead we
// stand up the few browser-ish globals they touch at load time, then evaluate
// each source file in global scope so its IIFE runs and registers as usual.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Install the minimal globals the core reads at load time. Returns window. */
export function setupWindow() {
  const win = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    NSXConfig: { GATEWAY: "http://mock", WS_BASE: "ws://mock" },
  };
  globalThis.window = win;
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, opts) { this.type = type; this.detail = opts?.detail; }
  };
  // api.js opens WebSockets at load (connectScale). A no-op stub keeps that
  // harmless — no test drives socket traffic.
  globalThis.WebSocket = class FakeWebSocket {
    constructor() {} close() {} send() {}
    addEventListener() {} removeEventListener() {}
  };
  return win;
}

/** Evaluate a core source file (path relative to packages/core/src). */
export function loadCoreFile(relFromSrc) {
  const code = readFileSync(join(SRC, relFromSrc), "utf8");
  // Indirect eval runs in global scope; the IIFE registers onto window.*.
  (0, eval)(code);
}
