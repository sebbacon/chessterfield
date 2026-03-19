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
      if (line === 'uciok') {
        self.postMessage({ type: 'ready' })
        return
      }
      self.postMessage({ type: 'output', line })
    })
    engine.onCustomMessage('uci')
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message })
  }
}

self.onmessage = (e) => {
  const { type, cmd } = e.data
  if (type === 'cmd' && engine) {
    engine.onCustomMessage(cmd)
  }
}

init()
