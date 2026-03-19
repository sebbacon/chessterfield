// This file runs as a Web Worker.
// It wraps the Stockfish engine and exposes a simple message protocol.
//
// Incoming messages (from main thread):
//   { type: 'cmd', cmd: '<uci command string>' }
//
// Outgoing messages (to main thread):
//   { type: 'output', line: '<stockfish output line>' }
//   { type: 'ready' }
//   { type: 'error', message: '<error string>' }

let engine = null

async function init() {
  try {
    // stockfish npm package: import the factory function
    // The package provides a WASM-backed engine via an emscripten module
    const { default: Stockfish } = await import('stockfish/src/stockfish-nnue-16-single.js')
    engine = await Stockfish()
    engine.addMessageListener((line) => {
      self.postMessage({ type: 'output', line })
    })
    engine.postMessage('uci')
    // Wait for uciok then signal ready
    // (uciok arrives via the message listener above; caller can watch for 'uciok' in output)
    self.postMessage({ type: 'ready' })
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message })
  }
}

self.onmessage = (e) => {
  const { type, cmd } = e.data
  if (type === 'cmd' && engine) {
    engine.postMessage(cmd)
  }
}

init()
