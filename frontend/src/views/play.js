import { Chess } from 'chess.js'
import { Chessground } from 'chessground'
import { parseStockfishLine, cpToPercent } from '../chess/eval.js'

// Import Chessground CSS (Vite handles this)
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'

export async function mountPlay(app, navigate, positionId) {
  // --- Fetch position data ---
  let position
  try {
    const r = await fetch(`/api/positions/${positionId}/`)
    if (!r.ok) throw new Error('Not found')
    position = await r.json()
  } catch {
    app.innerHTML = '<p class="muted" style="padding:2rem">Position not found. <button id="back" class="btn-secondary">Back</button></p>'
    app.querySelector('#back').addEventListener('click', () => navigate('library'))
    return
  }

  // --- Render layout ---
  app.innerHTML = `
    <div class="play-layout">
      <aside class="sidebar play-sidebar-left">
        <div class="pos-info">
          <h2>${escapeHtml(position.name)}</h2>
          <div class="tags">${position.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
          <p class="fen-display">${escapeHtml(position.fen)}</p>
        </div>
        <div class="side-selector">
          <p>Play as</p>
          <div class="side-buttons">
            <button class="side-btn active" data-side="white">White</button>
            <button class="side-btn" data-side="black">Black</button>
          </div>
        </div>
        <div class="play-controls">
          <button id="resign-btn" class="btn-secondary">Resign</button>
          <button id="back-btn" class="btn-secondary">← Library</button>
        </div>
        <div id="engine-banner" class="engine-banner hidden">Engine unavailable — analysis disabled</div>
      </aside>

      <main class="play-main">
        <div id="board-wrap">
          <div id="board"></div>
        </div>
      </main>

      <aside class="sidebar play-sidebar-right">
        <div class="eval-bar-wrap">
          <div class="eval-label" id="eval-white-label"></div>
          <div class="eval-bar-outer">
            <div class="eval-bar-fill" id="eval-fill" style="height:50%"></div>
          </div>
          <div class="eval-label" id="eval-black-label"></div>
        </div>
        <div class="engine-info">
          <span id="engine-depth">depth —</span>
          <span id="engine-score">—</span>
        </div>
        <div class="move-history-wrap">
          <h3>Moves</h3>
          <ol id="move-history" class="move-history"></ol>
        </div>
      </aside>
    </div>

    <div class="result-overlay hidden" id="result-overlay">
      <div class="result-card">
        <h2 id="result-text"></h2>
        <button id="play-again-btn" class="btn-primary">Play Again</button>
        <button id="back-to-library-btn" class="btn-secondary">Back to Library</button>
      </div>
    </div>
  `

  // --- State ---
  let userColor = 'white'
  let chess = new Chess(position.fen)
  let cg = null
  let worker = null
  let workerReady = false
  let gameOver = false

  // --- Worker setup ---
  try {
    worker = new Worker(new URL('../chess/worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = handleWorkerMessage
    worker.onerror = () => {
      app.querySelector('#engine-banner').classList.remove('hidden')
      workerReady = false
    }
  } catch {
    app.querySelector('#engine-banner').classList.remove('hidden')
  }

  function sendToEngine(cmd) {
    if (worker && workerReady) worker.postMessage({ type: 'cmd', cmd })
  }

  function handleWorkerMessage(e) {
    const { type, line } = e.data
    if (type === 'ready') {
      workerReady = true
      // Enable the board now that the engine is ready (if it's the user's turn)
      if (cg && isUserTurn() && !gameOver) {
        cg.set({ movable: { color: userColor, dests: toDests(chess) } })
      }
      return
    }
    if (type === 'error') { app.querySelector('#engine-banner').classList.remove('hidden'); return }
    if (type !== 'output') return

    // Parse eval info
    const parsed = parseStockfishLine(line)
    if (parsed) updateEvalBar(parsed)

    // Engine move
    if (line.startsWith('bestmove') && !gameOver) {
      const match = line.match(/bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/)
      if (match) applyEngineMove(match[1])
    }
  }

  // --- Eval bar ---
  function updateEvalBar({ cp, mate, depth }) {
    const fill = app.querySelector('#eval-fill')
    const depthEl = app.querySelector('#engine-depth')
    const scoreEl = app.querySelector('#engine-score')
    const whiteLabel = app.querySelector('#eval-white-label')
    const blackLabel = app.querySelector('#eval-black-label')

    depthEl.textContent = `depth ${depth}`

    if (mate !== null) {
      const percent = mate > 0 ? 100 : 0
      fill.style.height = percent + '%'
      const label = `M${Math.abs(mate)}`
      scoreEl.textContent = mate > 0 ? `+${label}` : `-${label}`
      whiteLabel.textContent = mate > 0 ? label : ''
      blackLabel.textContent = mate < 0 ? label : ''
    } else if (cp !== null) {
      const percent = cpToPercent(cp)
      fill.style.height = percent + '%'
      const display = cp > 0 ? `+${(cp / 100).toFixed(1)}` : (cp / 100).toFixed(1)
      scoreEl.textContent = display
      whiteLabel.textContent = cp > 0 ? display : ''
      blackLabel.textContent = cp < 0 ? display : ''
    }
  }

  // --- Move history ---
  function updateMoveHistory() {
    const ol = app.querySelector('#move-history')
    const history = chess.history()
    ol.innerHTML = ''
    for (let i = 0; i < history.length; i += 2) {
      const li = document.createElement('li')
      li.textContent = `${history[i] ?? ''} ${history[i + 1] ?? ''}`
      ol.appendChild(li)
    }
    ol.scrollTop = ol.scrollHeight
  }

  // --- Game-end detection ---
  function checkGameEnd() {
    if (chess.isCheckmate()) {
      const matedSide = chess.turn() // 'w' or 'b'
      const userMated = (matedSide === 'w' && userColor === 'white') || (matedSide === 'b' && userColor === 'black')
      return userMated ? 'Checkmate — Engine wins' : 'Checkmate — You win!'
    }
    if (chess.isStalemate()) return 'Stalemate — Draw'
    if (chess.isInsufficientMaterial()) return 'Insufficient Material — Draw'
    if (chess.isThreefoldRepetition()) return 'Threefold Repetition — Draw'
    if (typeof chess.isDrawByFiftyMoves === 'function' && chess.isDrawByFiftyMoves()) return 'Fifty-Move Rule — Draw'
    return null
  }

  function showResult(text) {
    gameOver = true
    sendToEngine('stop')
    const overlay = app.querySelector('#result-overlay')
    app.querySelector('#result-text').textContent = text
    overlay.classList.remove('hidden')
  }

  // --- Chessground helpers ---
  function toDests(ch) {
    const dests = new Map()
    ch.moves({ verbose: true }).forEach(m => {
      if (!dests.has(m.from)) dests.set(m.from, [])
      dests.get(m.from).push(m.to)
    })
    return dests
  }

  function isUserTurn() {
    const turn = chess.turn() // 'w' or 'b'
    return (turn === 'w' && userColor === 'white') || (turn === 'b' && userColor === 'black')
  }

  // --- Apply engine move ---
  function applyEngineMove(uciMove) {
    if (gameOver) return
    const from = uciMove.slice(0, 2)
    const to = uciMove.slice(2, 4)
    const promotion = uciMove[4] ?? undefined

    const move = chess.move({ from, to, promotion })
    if (!move) return
    updateMoveHistory()

    cg.set({
      fen: chess.fen(),
      turnColor: chess.turn() === 'w' ? 'white' : 'black',
      movable: {
        color: userColor,
        dests: isUserTurn() ? toDests(chess) : new Map(),
      },
      lastMove: [from, to],
    })

    const result = checkGameEnd()
    if (result) { showResult(result); return }

    // After engine moves, it's user's turn — start eval for user's position
    if (workerReady) {
      sendToEngine(`position fen ${chess.fen()}`)
      sendToEngine('go movetime 3000')
    }
  }

  // --- Chessground init ---
  function initBoard() {
    const boardEl = app.querySelector('#board')
    const orientation = userColor

    cg = Chessground(boardEl, {
      fen: chess.fen(),
      orientation,
      turnColor: chess.turn() === 'w' ? 'white' : 'black',
      movable: {
        free: false,
        color: userColor,
        dests: (isUserTurn() && workerReady) ? toDests(chess) : new Map(),
        events: {
          after(orig, dest) {
            // Promotion: always promote to queen for simplicity
            const move = chess.move({ from: orig, to: dest, promotion: 'q' })
            if (!move) return

            updateMoveHistory()
            cg.set({
              fen: chess.fen(),
              turnColor: chess.turn() === 'w' ? 'white' : 'black',
              movable: { color: userColor, dests: new Map() }, // disable while engine thinks
            })

            const result = checkGameEnd()
            if (result) { showResult(result); return }

            // Trigger engine
            if (workerReady) {
              sendToEngine('stop')
              sendToEngine(`position fen ${chess.fen()}`)
              sendToEngine('go movetime 3000')
            }
          },
        },
      },
      highlight: { lastMove: true, check: true },
      animation: { enabled: true, duration: 200 },
    })
  }

  // --- Engine first move (when engine goes first) ---
  function engineGoFirst() {
    if (workerReady) {
      sendToEngine(`position fen ${chess.fen()}`)
      sendToEngine('go movetime 3000')
    } else if (worker) {
      // Worker not ready yet — wait for ready message then trigger
      const originalHandler = worker.onmessage
      worker.onmessage = (e) => {
        originalHandler(e)
        if (e.data.type === 'ready') {
          sendToEngine(`position fen ${chess.fen()}`)
          sendToEngine('go movetime 3000')
          worker.onmessage = originalHandler
        }
      }
    }
  }

  // --- Side selector ---
  app.querySelectorAll('.side-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      app.querySelectorAll('.side-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      userColor = btn.dataset.side
      startGame()
    })
  })

  // --- Resign ---
  app.querySelector('#resign-btn').addEventListener('click', () => {
    if (!gameOver) showResult('You resigned — Engine wins')
  })

  app.querySelector('#back-btn').addEventListener('click', () => { if (worker) worker.terminate(); navigate('library') })

  // --- Result overlay buttons ---
  app.querySelector('#play-again-btn').addEventListener('click', () => {
    app.querySelector('#result-overlay').classList.add('hidden')
    startGame()
  })
  app.querySelector('#back-to-library-btn').addEventListener('click', () => { if (worker) worker.terminate(); navigate('library') })

  // --- Start / restart game ---
  function startGame() {
    gameOver = false
    chess = new Chess(position.fen)
    updateMoveHistory()
    app.querySelector('#eval-fill').style.height = '50%'
    app.querySelector('#engine-depth').textContent = 'depth —'
    app.querySelector('#engine-score').textContent = '—'
    app.querySelector('#eval-white-label').textContent = ''
    app.querySelector('#eval-black-label').textContent = ''

    if (cg) cg.destroy()
    initBoard()

    sendToEngine('stop')
    sendToEngine('ucinewgame')

    const fenTurn = chess.turn() // 'w' or 'b'
    const engineGoesFirst = (fenTurn === 'w' && userColor === 'black') ||
                            (fenTurn === 'b' && userColor === 'white')

    if (engineGoesFirst) {
      // Disable board until engine responds
      cg.set({ movable: { color: userColor, dests: new Map() } })
      engineGoFirst()
    }
  }

  startGame()
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
