let engine = null

async function init() {
  try {
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
  if (type === 'cmd' && engine) engine.onCustomMessage(cmd)
}

init()
