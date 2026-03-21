import { Chess } from 'chess.js'
import { Chessground } from 'chessground'
import { parseStockfishLine, cpToPercent } from '../chess/eval.js'

// Import Chessground CSS (Vite handles this)
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'

export async function mountPlay(app, navigate, itemId, initialPlayState = {}, syncState = () => {}) {
  // --- Fetch position or game-end data ---
  let position
  const isGame = typeof itemId === 'string' && itemId.startsWith('game:')
  let browseOnly = isGame
  let initialHistory = null
  let initialUserColor = initialPlayState.side === 'black' ? 'black' : 'white'
  const resourceId = isGame ? itemId.slice(5) : itemId
  const resourceUrl = isGame ? `/api/games/${resourceId}/` : `/api/positions/${resourceId}/`
  try {
    const r = await fetch(resourceUrl)
    if (!r.ok) throw new Error('Not found')
    const data = await r.json()
    if (isGame) {
      position = gameToPlayablePosition(data)
      initialHistory = gameToPositionHistory(data)
      initialUserColor = data.user_color || 'white'
    } else {
      position = data
      initialHistory = [{ fen: data.fen, lastMove: null, moveSan: null }]
    }
  } catch {
    app.innerHTML = `<p class="muted" style="padding:2rem">${isGame ? 'Game' : 'Position'} not found. <button id="back" class="btn-secondary">Back</button></p>`
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
        <div class="side-selector" ${browseOnly ? 'hidden' : ''}>
          <p>Play as</p>
          <div class="side-buttons">
            <button class="side-btn ${userColorClass(initialUserColor, 'white')}" data-side="white">White</button>
            <button class="side-btn ${userColorClass(initialUserColor, 'black')}" data-side="black">Black</button>
          </div>
        </div>
        <div class="play-controls">
          <button id="hint-btn" class="btn-secondary" ${browseOnly ? 'hidden' : 'disabled'}>Hint</button>
          <button id="resign-btn" class="btn-secondary" ${browseOnly ? 'hidden' : ''}>Resign</button>
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
          <span id="eval-delta" class="eval-delta"></span>
        </div>
        <div class="move-history-wrap">
          <h3>Moves</h3>
          <ol id="move-history" class="move-history"></ol>
          <div class="move-nav">
            <button id="back-move-btn" class="btn-icon" disabled title="Previous move">&#9664;</button>
            <button id="fwd-move-btn" class="btn-icon" disabled title="Next move">&#9654;</button>
          </div>
        </div>
      </aside>
    </div>

    <div class="result-overlay hidden" id="result-overlay">
      <div class="result-card">
        <h2 id="result-text"></h2>
        <button id="play-again-btn" class="btn-primary" ${browseOnly ? 'hidden' : ''}>Play Again</button>
        <button id="back-to-library-btn" class="btn-secondary">Back to Library</button>
      </div>
    </div>
  `

  // --- State ---
  let userColor = initialUserColor
  let chess = new Chess(position.fen)
  let cg = null
  let worker = null
  let workerReady = false
  let gameOver = false
  let engineMoving = false  // true when engine is making a move (vs just analyzing)
  let hintMode = false      // true when waiting for engine's hint bestmove
  let pendingEval = null    // latest eval from info lines, committed on bestmove
  let committedCp = null    // last committed cp (for delta calculation)
  let positionHistory = initialHistory
  let viewIndex = positionHistory.length - 1  // which position in positionHistory is displayed

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

  function currentViewedFen() {
    return positionHistory[viewIndex].fen
  }

  function requestPositionAnalysis(fen) {
    if (!workerReady || engineMoving || hintMode) return
    sendToEngine('stop')
    sendToEngine(`position fen ${fen}`)
    sendToEngine('go movetime 1000')
  }

  function setDisplayedFen(fen) {
    app.querySelector('.fen-display').textContent = fen
  }

  function syncPlayState(replace = false) {
    syncState({
      play: {
        ply: browseOnly ? viewIndex : 0,
        side: userColor,
      },
    }, { replace })
  }

  function handleWorkerMessage(e) {
    const { type, line } = e.data
    if (type === 'ready') {
      workerReady = true
      // Enable the board now that the engine is ready (if it's the user's turn)
      if (cg && !browseOnly && isUserTurn() && !gameOver) {
        cg.set({ movable: { color: userColor, dests: toDests(chess) } })
      }
      if (browseOnly) requestPositionAnalysis(currentViewedFen())
      updateHintBtn()
      return
    }
    if (type === 'error') { app.querySelector('#engine-banner').classList.remove('hidden'); return }
    if (type !== 'output') return

    // Buffer eval info — committed on bestmove
    const parsed = parseStockfishLine(line)
    if (parsed) storePendingEval(parsed)

    // Engine move or hint
    if (line.startsWith('bestmove') && !gameOver) {
      commitEval()
      const match = line.match(/bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/)
      if (hintMode && match) {
        showHint(match[1])
        hintMode = false
      } else if (engineMoving && match) {
        applyEngineMove(match[1])
      }
      engineMoving = false
    }
  }

  // --- Hint ---
  function showHint(uciMove) {
    const orig = uciMove.slice(0, 2)
    const dest = uciMove.slice(2, 4)
    cg.set({ drawable: { autoShapes: [{ orig, dest, brush: 'green' }] } })
  }

  function clearHint() {
    cg.set({ drawable: { autoShapes: [] } })
  }

  function updateHintBtn() {
    const btn = app.querySelector('#hint-btn')
    if (!btn) return
    if (browseOnly) {
      btn.disabled = true
      return
    }
    btn.disabled = !workerReady || !isUserTurn() || gameOver || engineMoving || !atLatest()
  }

  // --- Eval bar ---
  // Buffer incoming info lines; only update the bar on bestmove so the
  // transition animates once from the previous committed position.
  function storePendingEval({ cp, mate, depth }) {
    app.querySelector('#engine-depth').textContent = `depth ${depth}`
    pendingEval = { cp, mate }
  }

  function commitEval() {
    if (!pendingEval) return
    const { cp, mate } = pendingEval
    pendingEval = null

    const fill = app.querySelector('#eval-fill')
    const scoreEl = app.querySelector('#engine-score')
    const deltaEl = app.querySelector('#eval-delta')
    const whiteLabel = app.querySelector('#eval-white-label')
    const blackLabel = app.querySelector('#eval-black-label')

    if (mate !== null) {
      fill.style.height = (mate > 0 ? 100 : 0) + '%'
      const label = `M${Math.abs(mate)}`
      scoreEl.textContent = mate > 0 ? `+${label}` : `-${label}`
      whiteLabel.textContent = mate > 0 ? label : ''
      blackLabel.textContent = mate < 0 ? label : ''
      deltaEl.textContent = ''
      committedCp = null
    } else if (cp !== null) {
      fill.style.height = cpToPercent(cp) + '%'
      const display = cp > 0 ? `+${(cp / 100).toFixed(1)}` : (cp / 100).toFixed(1)
      scoreEl.textContent = display
      whiteLabel.textContent = cp > 0 ? display : ''
      blackLabel.textContent = cp < 0 ? display : ''

      if (committedCp !== null) {
        const delta = (cp - committedCp) / 100
        const abs = Math.abs(delta).toFixed(1)
        deltaEl.textContent = delta >= 0 ? `▲${abs}` : `▼${abs}`
        deltaEl.className = `eval-delta ${delta >= 0 ? 'positive' : 'negative'}`
      } else {
        deltaEl.textContent = ''
      }
      committedCp = cp
    }
  }

  // --- Move history ---
  function updateMoveHistory() {
    const ol = app.querySelector('#move-history')
    const history = browseOnly
      ? positionHistory.slice(1).map(step => step.moveSan || '...')
      : chess.history()
    ol.innerHTML = ''
    for (let i = 0; i < history.length; i += 2) {
      const li = document.createElement('li')
      const w = document.createElement('span')
      w.className = 'move-token'
      w.textContent = history[i]
      w.dataset.idx = i + 1
      if (viewIndex === i + 1) w.classList.add('current-move')
      li.appendChild(w)
      if (history[i + 1] !== undefined) {
        li.appendChild(document.createTextNode(' '))
        const b = document.createElement('span')
        b.className = 'move-token'
        b.textContent = history[i + 1]
        b.dataset.idx = i + 2
        if (viewIndex === i + 2) b.classList.add('current-move')
        li.appendChild(b)
      }
      ol.appendChild(li)
    }
    // Scroll current move into view
    const cur = ol.querySelector('.current-move')
    if (cur) cur.scrollIntoView?.({ block: 'nearest' })
    else ol.scrollTop = ol.scrollHeight
  }

  // --- History navigation ---
  function atLatest() { return viewIndex === positionHistory.length - 1 }

  function navigateTo(index, { replace = false } = {}) {
    viewIndex = index
    const { fen, lastMove } = positionHistory[index]
    const live = atLatest()
    if (browseOnly) chess = new Chess(fen)
    cg.set({
      fen,
      lastMove: lastMove ?? undefined,
      movable: {
        color: userColor,
        dests: (!browseOnly && live && isUserTurn() && workerReady && !gameOver) ? toDests(chess) : new Map(),
      },
    })
    setDisplayedFen(fen)
    updateMoveHistory()
    updateNavButtons()
    updateHintBtn()
    if (browseOnly) {
      syncPlayState(replace)
      requestPositionAnalysis(fen)
    }
  }

  function updateNavButtons() {
    app.querySelector('#back-move-btn').disabled = viewIndex === 0
    app.querySelector('#fwd-move-btn').disabled = atLatest()
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
    positionHistory.push({ fen: chess.fen(), lastMove: [from, to] })
    viewIndex = positionHistory.length - 1
    updateMoveHistory()
    updateNavButtons()

    cg.set({
      fen: chess.fen(),
      turnColor: chess.turn() === 'w' ? 'white' : 'black',
      movable: {
        color: userColor,
        dests: isUserTurn() ? toDests(chess) : new Map(),
      },
      lastMove: [from, to],
    })
    setDisplayedFen(chess.fen())

    const result = checkGameEnd()
    if (result) { showResult(result); return }

    // After engine moves, analyse user's position for the eval bar (no move applied)
    if (workerReady) {
      engineMoving = false
      updateHintBtn()
      sendToEngine(`position fen ${chess.fen()}`)
      sendToEngine('go movetime 3000')
    }
  }

  // --- Chessground init ---
  function initBoard() {
    const boardEl = app.querySelector('#board')
    const orientation = userColor
    const movable = browseOnly
      ? {
          free: false,
          color: userColor,
          dests: new Map(),
        }
      : {
          free: false,
          color: userColor,
          dests: (isUserTurn() && workerReady) ? toDests(chess) : new Map(),
          events: {
            after(orig, dest) {
              // Promotion: always promote to queen for simplicity
              const move = chess.move({ from: orig, to: dest, promotion: 'q' })
              if (!move) return

              hintMode = false
              clearHint()
              positionHistory.push({ fen: chess.fen(), lastMove: [orig, dest] })
              viewIndex = positionHistory.length - 1
              updateMoveHistory()
              updateNavButtons()
              cg.set({
                fen: chess.fen(),
                turnColor: chess.turn() === 'w' ? 'white' : 'black',
                movable: { color: userColor, dests: new Map() }, // disable while engine thinks
              })
              setDisplayedFen(chess.fen())

              const result = checkGameEnd()
              if (result) { showResult(result); return }

              // Trigger engine move
              if (workerReady) {
                engineMoving = true
                updateHintBtn()
                sendToEngine('stop')
                sendToEngine(`position fen ${chess.fen()}`)
                sendToEngine('go movetime 3000')
              }
            },
          },
        }

    cg = Chessground(boardEl, {
      fen: chess.fen(),
      orientation,
      turnColor: chess.turn() === 'w' ? 'white' : 'black',
      movable,
      highlight: { lastMove: true, check: true },
      animation: { enabled: true, duration: 200 },
    })
  }

  // --- Engine first move (when engine goes first) ---
  function engineGoFirst() {
    if (workerReady) {
      engineMoving = true
      sendToEngine(`position fen ${chess.fen()}`)
      sendToEngine('go movetime 3000')
    } else if (worker) {
      // Worker not ready yet — wait for ready message then trigger
      const originalHandler = worker.onmessage
      worker.onmessage = (e) => {
        originalHandler(e)
        if (e.data.type === 'ready') {
          engineMoving = true
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
      startGame({ replaceUrl: false })
    })
  })

  // --- History navigation ---
  app.querySelector('#back-move-btn').addEventListener('click', () => {
    if (viewIndex > 0) navigateTo(viewIndex - 1)
  })
  app.querySelector('#fwd-move-btn').addEventListener('click', () => {
    if (!atLatest()) navigateTo(viewIndex + 1)
  })
  app.querySelector('#move-history').addEventListener('click', e => {
    const token = e.target.closest('.move-token')
    if (token) navigateTo(parseInt(token.dataset.idx))
  })

  // --- Hint ---
  app.querySelector('#hint-btn').addEventListener('click', () => {
    if (!workerReady || !isUserTurn() || gameOver || engineMoving) return
    hintMode = true
    sendToEngine('stop')
    sendToEngine(`position fen ${chess.fen()}`)
    sendToEngine('go movetime 1000')
  })

  // --- Resign ---
  app.querySelector('#resign-btn').addEventListener('click', () => {
    if (!gameOver) showResult('You resigned — Engine wins')
  })

  app.querySelector('#back-btn').addEventListener('click', () => { if (worker) worker.terminate(); navigate('library') })

  // --- Result overlay buttons ---
  app.querySelector('#play-again-btn').addEventListener('click', () => {
    app.querySelector('#result-overlay').classList.add('hidden')
    startGame({ replaceUrl: true })
  })
  app.querySelector('#back-to-library-btn').addEventListener('click', () => { if (worker) worker.terminate(); navigate('library') })

  // --- Start / restart game ---
  function startGame({ replaceUrl = true } = {}) {
    gameOver = false
    engineMoving = false
    hintMode = false
    pendingEval = null
    committedCp = null
    positionHistory = initialHistory.map(step => ({ ...step }))
    viewIndex = browseOnly
      ? clampPly(initialPlayState.ply, positionHistory.length - 1, positionHistory.length - 1)
      : 0
    chess = new Chess(positionHistory[viewIndex].fen)
    updateMoveHistory()
    updateNavButtons()
    setDisplayedFen(positionHistory[viewIndex].fen)
    app.querySelector('#eval-fill').style.height = '50%'
    app.querySelector('#engine-depth').textContent = 'depth —'
    app.querySelector('#engine-score').textContent = '—'
    app.querySelector('#eval-delta').textContent = ''
    app.querySelector('#eval-white-label').textContent = ''
    app.querySelector('#eval-black-label').textContent = ''

    if (cg) cg.destroy()
    initBoard()

    if (browseOnly) {
      navigateTo(viewIndex, { replace: replaceUrl })
      return
    }

    syncPlayState(replaceUrl)

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

  startGame({ replaceUrl: true })
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}


function gameToPlayablePosition(game) {
  return {
    id: game.id,
    name: `${game.name} — Final Position`,
    fen: game.fen,
    notes: '',
    tags: ['game', game.user_color, game.result_label],
  }
}


function gameToPositionHistory(game) {
  return (game.history || []).map(step => ({
    fen: step.fen,
    lastMove: step.last_move,
    moveSan: step.move_san,
  }))
}


function clampPly(value, max, fallback) {
  if (value === null || value === undefined) return fallback
  return Math.max(0, Math.min(max, value))
}


function userColorClass(current, expected) {
  return current === expected ? 'active' : ''
}
