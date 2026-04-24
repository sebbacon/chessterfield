import { Chess } from 'chess.js'
import { Chessground } from 'chessground'
import { fetchGame, fetchPosition, updatePosition } from '../api/content.js'
import { createPracticeAttempt, finishPracticeAttempt } from '../api/practice.js'
import { parseStockfishLine } from '../chess/eval.js'
import { readUserSetting, writeUserSettings } from '../settings.js'
import { markPositionViewed } from '../viewed-positions.js'
import { ensureSession } from '../state/session.js'
import EngineWorker from '../chess/worker.js?worker'

// Import Chessground CSS (Vite handles this)
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'

let builtWorkerUrlPromise = null
const ANALYSIS_MOVETIME_MS = 1200
const HINT_MOVETIME_MS = 1000
const ANALYSIS_VARIATIONS = 4
const PUZZLE_TARGET_DEPTH_PLIES = 4
const PUZZLE_MATE_LOOKAHEAD_PLIES = 8
const PUZZLE_MATERIAL_SWING_THRESHOLD = 300
const PUZZLE_EVAL_SOLVE_THRESHOLD = 250
const PUZZLE_EVAL_HOLD_ROOT_THRESHOLD = 125
const PUZZLE_EVAL_HOLD_MIN_THRESHOLD = 125
const PUZZLE_EVAL_HOLD_RATIO = 0.4
const PUZZLE_EVAL_FAIL_THRESHOLD = 0
const ENGINE_MOVE_SPEEDS = {
  fast: { label: 'Fast (~1s)', movetimeMs: 1000 },
  standard: { label: 'Standard (~3s)', movetimeMs: 3000 },
  slow: { label: 'Slow (~5s)', movetimeMs: 5000 },
}

function isCrossOriginWorkerError(error) {
  return error instanceof DOMException && error.name === 'SecurityError'
}

async function resolveBuiltWorkerUrl() {
  if (!builtWorkerUrlPromise) {
    builtWorkerUrlPromise = (async () => {
      const manifestResponse = await fetch('/static/.vite/manifest.json')
      if (!manifestResponse.ok) throw new Error('Missing build manifest')

      const manifest = await manifestResponse.json()
      const mainFile = manifest['src/main.js']?.file
      if (!mainFile) throw new Error('Missing main build entry')

      const mainResponse = await fetch(`/static/${mainFile}`)
      if (!mainResponse.ok) throw new Error('Missing built main asset')

      const mainSource = await mainResponse.text()
      const workerMatch = mainSource.match(/worker-[A-Za-z0-9_-]+\.js/)
      if (!workerMatch) throw new Error('Missing built worker asset')

      return `/static/assets/${workerMatch[0]}`
    })()
  }

  return builtWorkerUrlPromise
}

async function createEngineWorker() {
  try {
    return new EngineWorker()
  } catch (error) {
    if (!isCrossOriginWorkerError(error)) throw error

    const builtWorkerUrl = await resolveBuiltWorkerUrl()
    return new Worker(builtWorkerUrl, { type: 'module' })
  }
}

export async function mountPlay(app, navigate, itemId, initialPlayState = {}, syncState = () => {}, contextState = {}) {
  const session = await ensureSession()
  // --- Fetch position or game-end data ---
  let position
  const isGame = typeof itemId === 'string' && itemId.startsWith('game:')
  const browseState = contextState.browse || contextState || {}
  const workoutState = contextState.workout || {}
  const positionContext = isGame
    ? { tags: [], progress: 'all', sort: 'oldest', tactic: null }
    : resolvePositionContext({
        session,
        playState: initialPlayState,
        browseState,
        workoutState,
      })
  let browseOnly = isGame
  let initialHistory = null
  let initialUserColor = normalizePlaySide(initialPlayState.side) || preferredSideFromSession(session)
  const resourceId = isGame ? itemId.slice(5) : itemId
  const returnView = initialPlayState.from === 'workout' ? 'workout' : 'browse'
  try {
    const data = isGame
      ? await fetchGame(resourceId)
      : await fetchPosition(resourceId, positionContext)
    if (!isGame && initialPlayState.from === 'workout' && !isFenPlayable(data.fen) && data.next_position_id) {
      navigate('play', data.next_position_id, {
        workout: workoutState,
        play: { ply: 0, side: null, from: 'workout' },
      }, { replace: true })
      return
    }
    if (isGame) {
      position = gameToPlayablePosition(data)
      initialHistory = gameToPositionHistory(data)
      initialUserColor = data.user_color || 'white'
    } else {
      position = data
      initialHistory = [{ fen: data.fen, lastMove: null, moveSan: null }]
      initialUserColor = initialUserColor || fenSideToColor(data.fen)
    }
    validatePlayablePosition(position, initialHistory)
  } catch {
    app.innerHTML = `<p class="muted" style="padding:2rem">${isGame ? 'Game' : 'Position'} could not be loaded. <button id="back" class="btn-secondary">Back</button></p>`
    app.querySelector('#back').addEventListener('click', () => navigate(returnView))
    return
  }

  const viewedStatus = !isGame ? await markPositionViewed(position.id, session) : null
  const nextPositionId = !isGame ? position.next_position_id : null
  const hasSequenceContext = !isGame && hasPositionSequenceContext(positionContext)
  const canAdvanceToNextPosition = !isGame && (Boolean(nextPositionId) || hasSequenceContext)
  const nextActionLabel = nextPositionId ? 'Next Position →' : `Back to ${capitalize(returnView)} →`
  const backButtonLabel = returnView === 'workout' ? '← Workout' : '← Browse'
  const initialEngineMoveSpeed = normalizeEngineMoveSpeed(readUserSetting(session, 'engine_move_speed'))

  // --- Render layout ---
  app.innerHTML = `
    <div class="play-layout">
      <main class="play-main">
        <div class="play-topbar">
          <div class="play-topbar-nav">
            <button id="back-btn" class="btn-secondary">${backButtonLabel}</button>
            ${canAdvanceToNextPosition ? `<button id="next-position-btn" class="btn-secondary">${nextActionLabel}</button>` : ''}
          </div>
          <div class="play-topbar-actions">
            <div class="account-pill">${accountLabel(session)}</div>
            ${viewedStatus ? `
              <span class="viewed-pill" aria-label="Seen on this device">
                <span class="viewed-pill-icon" aria-hidden="true">✓</span>
                Seen
              </span>
            ` : ''}
            <button id="settings-btn" class="btn-secondary" type="button">Settings</button>
            <button id="hint-btn" class="btn-secondary" ${browseOnly ? 'hidden' : 'disabled'}>Hint</button>
            <button id="restart-btn" class="btn-secondary" ${browseOnly ? 'hidden' : ''}>Restart</button>
            <button id="resign-btn" class="btn-secondary" ${browseOnly ? 'hidden' : ''}>Resign</button>
          </div>
        </div>
        <div id="board-wrap">
          <div id="board"></div>
          <div class="result-overlay hidden" id="result-overlay" aria-live="polite">
            <div class="result-card">
              <div class="result-copy">
                <p id="result-eyebrow" class="result-eyebrow">Game over</p>
                <h2 id="result-text"></h2>
              </div>
              <button id="dismiss-result-btn" class="btn-secondary">Dismiss</button>
            </div>
          </div>
          <div id="board-analysis-indicator" class="board-analysis-indicator" hidden aria-live="polite">
            <span class="analysis-spinner" aria-hidden="true"></span>
          </div>
        </div>
      </main>

      <aside class="sidebar play-sidebar-right">
        <div class="move-nav">
          <button id="back-move-btn" class="btn-icon" disabled title="Previous move" aria-label="Previous move">&#9664;</button>
          <button id="fwd-move-btn" class="btn-icon" disabled title="Next move" aria-label="Next move">&#9654;</button>
        </div>
        <div class="play-analysis">
          <div class="analysis-status" aria-live="polite">
            <h3 class="analysis-title">Best next moves</h3>
            <span id="analysis-spinner" class="analysis-spinner" aria-hidden="true"></span>
            <button id="toggle-analysis-visibility" class="btn-secondary analysis-toggle-btn" type="button"></button>
          </div>
          <div id="analysis-lines" class="analysis-lines"></div>
        </div>
        <div class="move-history-wrap">
          <h3>Past moves</h3>
          <ol id="move-history" class="move-history"></ol>
        </div>
      </aside>

      <aside class="sidebar play-sidebar-left">
        <div class="pos-info">
          <h2>${escapeHtml(position.name)}</h2>
          <div class="tags">${position.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
          <p class="fen-display">${escapeHtml(position.fen)}</p>
          ${!isGame ? `
            <div class="position-review-actions">
              <button
                id="flag-position-btn"
                class="btn-secondary position-review-btn"
                type="button"
                ${position.possible_bug ? 'disabled' : ''}
              >
                ${position.possible_bug ? 'Flagged for review' : 'Problem? Flag this position for review'}
              </button>
              <span id="flag-position-status" class="position-review-status" aria-live="polite"></span>
            </div>
          ` : ''}
        </div>
        <div id="practice-summary" class="practice-summary" hidden></div>
        <div id="puzzle-feedback" class="puzzle-feedback" hidden></div>
        <div class="side-selector" ${browseOnly ? 'hidden' : ''}>
          <p>Play as</p>
          <div class="side-buttons">
            <button class="side-btn ${userColorClass(initialUserColor, 'white')}" data-side="white">White</button>
            <button class="side-btn ${userColorClass(initialUserColor, 'black')}" data-side="black">Black</button>
          </div>
        </div>
        <div class="engine-speed-control" ${browseOnly ? 'hidden' : ''}>
          <label class="engine-speed-label" for="engine-speed-select">Engine speed</label>
          <select id="engine-speed-select" class="engine-speed-select">
            ${renderEngineMoveSpeedOptions(initialEngineMoveSpeed)}
          </select>
          <p class="engine-speed-help">Lower think time makes Stockfish reply quicker.</p>
        </div>
        <div id="engine-banner" class="engine-banner hidden">Engine unavailable — analysis disabled</div>
      </aside>
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
  let pendingEngineGo = false
  let currentSearch = null
  let analysisByPly = new Map()
  let analysisHidden = readUserSetting(session, 'analysis_visibility') === 'hidden'
  let engineMoveSpeed = initialEngineMoveSpeed
  let positionHistory = initialHistory
  let viewIndex = positionHistory.length - 1  // which position in positionHistory is displayed
  let currentAttemptId = null
  let attemptClosed = false
  let pendingAttemptClose = null
  let puzzleState = createPuzzleState()
  let puzzleSummary = createPuzzleSummary(position)
  let practiceSummary = createPracticeSummary(position)

  renderPracticeSummary()

  // --- Worker setup ---
  try {
    worker = await createEngineWorker()
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

  function teardownWorker() {
    if (worker) worker.terminate()
    worker = null
  }

  function currentViewedFen() {
    return positionHistory[viewIndex].fen
  }

  function currentViewedPly() {
    return viewIndex
  }

  function requestDisplayedAnalysis({ force = false, asHint = false } = {}) {
    requestAnalysisForPly(currentViewedPly(), currentViewedFen(), { force, asHint })
  }

  function requestAnalysisForPly(ply, fen, { force = false, asHint = false } = {}) {
    if (!workerReady || engineMoving || (hintMode && !asHint)) return
    if (currentSearch && currentSearch.ply === ply && currentSearch.fen === fen && currentSearch.kind === (asHint ? 'hint' : 'analysis')) {
      return
    }
    const existing = analysisByPly.get(ply)
    if (!force && !asHint && existing?.fen === fen && existing.status === 'complete') {
      if (ply === viewIndex) renderAnalysisForPly(ply)
      return
    }

    currentSearch = {
      kind: asHint ? 'hint' : 'analysis',
      ply,
      fen,
      lines: new Map(),
    }
    analysisByPly.set(ply, {
      ...(existing || {}),
      ply,
      fen,
      status: 'loading',
    })
    if (ply === viewIndex) renderAnalysisForPly(ply)
    sendToEngine('stop')
    sendToEngine(`position fen ${fen}`)
    sendToEngine(`go movetime ${asHint ? HINT_MOVETIME_MS : ANALYSIS_MOVETIME_MS}`)
  }

  function requestEngineMove() {
    if (!workerReady) {
      pendingEngineGo = true
      engineMoving = true
      updateHintBtn()
      return
    }

    pendingEngineGo = false
    currentSearch = {
      kind: 'engineMove',
      ply: viewIndex,
      fen: chess.fen(),
      lines: new Map(),
    }
    const existing = analysisByPly.get(viewIndex)
    analysisByPly.set(viewIndex, {
      ...(existing || {}),
      ply: viewIndex,
      fen: chess.fen(),
      status: 'loading',
    })
    renderAnalysisForPly(viewIndex)
    sendToEngine('stop')
    sendToEngine(`position fen ${chess.fen()}`)
    sendToEngine(`go movetime ${engineMoveSpeedConfig(engineMoveSpeed).movetimeMs}`)
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
      sendToEngine(`setoption name MultiPV value ${ANALYSIS_VARIATIONS}`)
      if (cg && !browseOnly && isUserTurn() && !gameOver && atLatest() && !engineMoving) {
        cg.set({ movable: { color: userColor, dests: toDests(chess) } })
      }
      if (pendingEngineGo) requestEngineMove()
      else requestDisplayedAnalysis({ force: true })
      updateHintBtn()
      return
    }
    if (type === 'error') { app.querySelector('#engine-banner').classList.remove('hidden'); return }
    if (type !== 'output') return

    const parsed = parseStockfishLine(line)
    if (parsed) storeSearchLine(parsed)

    if (line.startsWith('bestmove')) {
      const match = line.match(/bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/)
      finalizeSearch(match?.[1] || null)
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

  function storeSearchLine(line) {
    if (!currentSearch) return
    const existing = currentSearch.lines.get(line.multipv)
    if (!existing || line.depth >= existing.depth) {
      currentSearch.lines.set(line.multipv, line)
    }
  }

  function finalizeSearch(bestmoveUci) {
    if (!currentSearch) return

    const search = currentSearch
    currentSearch = null
    const record = buildAnalysisRecord(search, bestmoveUci)
    if (record) {
      analysisByPly.set(search.ply, record)
      maybeFreezePuzzleLine(search, record)
      maybeResolveEvalPuzzle(search, record)
      updateMoveHistory()
      if (search.ply === viewIndex) renderAnalysisForPly(search.ply)
    }

    if (search.kind === 'hint' && bestmoveUci) {
      showHint(bestmoveUci)
      hintMode = false
      updateHintBtn()
      return
    }

    if (search.kind === 'hint') {
      hintMode = false
      updateHintBtn()
      return
    }

    if (search.kind === 'engineMove') {
      engineMoving = false
      updateHintBtn()
      maybeEnableUserMoves()
      if (bestmoveUci) applyEngineMove(bestmoveUci)
      return
    }

    maybeEnableUserMoves()
    updateHintBtn()
  }

  function renderAnalysisForPly(ply) {
    const record = analysisByPly.get(ply)
    const analysisEl = app.querySelector('.play-analysis')
    const titleEl = app.querySelector('.analysis-title')
    const spinnerEl = app.querySelector('#analysis-spinner')
    const boardIndicatorEl = app.querySelector('#board-analysis-indicator')
    const boardSpinnerEl = boardIndicatorEl.querySelector('.analysis-spinner')
    const toggleEl = app.querySelector('#toggle-analysis-visibility')
    const linesEl = app.querySelector('#analysis-lines')
    const loading = record?.status === 'loading' || (currentSearch && currentSearch.ply === ply && currentSearch.fen === currentViewedFen())
    const showBoardIndicator = analysisHidden && loading

    analysisEl.classList.toggle('analysis-hidden', analysisHidden)
    titleEl.hidden = analysisHidden
    toggleEl.textContent = analysisHidden ? 'Show best next moves' : 'Hide'
    toggleEl.setAttribute('aria-pressed', String(analysisHidden))
    spinnerEl.className = `analysis-spinner${loading && !analysisHidden ? ' spinning' : ''}`
    spinnerEl.hidden = analysisHidden
    boardIndicatorEl.hidden = !showBoardIndicator
    boardIndicatorEl.classList.toggle('active', showBoardIndicator)
    boardSpinnerEl.className = `analysis-spinner${showBoardIndicator ? ' spinning' : ''}`

    if (analysisHidden) {
      linesEl.innerHTML = ''
      return
    }

    if (record?.variations?.length) {
      linesEl.innerHTML = renderAnalysisLines(record)
      return
    }

    if (loading) {
      linesEl.innerHTML = renderAnalysisSkeleton()
    } else {
      linesEl.innerHTML = '<p class="analysis-placeholder">Step through moves or wait for analysis.</p>'
    }
  }

  // --- Move history ---
  function updateMoveHistory() {
    const ol = app.querySelector('#move-history')
    const wrap = app.querySelector('.move-history-wrap')
    const history = positionHistory.slice(1).map(step => step.moveSan || '...')
    ol.innerHTML = ''
    let historyIndex = 0
    let moveNumber = fenMoveNumber(positionHistory[0].fen)
    let turn = fenSideToColor(positionHistory[0].fen)

    while (historyIndex < history.length) {
      const li = document.createElement('li')
      li.className = 'move-history-row'

      const moveNumberEl = document.createElement('span')
      moveNumberEl.className = 'move-number'
      moveNumberEl.textContent = `${moveNumber}.`
      li.appendChild(moveNumberEl)

      const whiteCell = document.createElement('div')
      whiteCell.className = 'move-cell move-cell-white'
      const blackCell = document.createElement('div')
      blackCell.className = 'move-cell move-cell-black'

      if (turn === 'white' && history[historyIndex] !== undefined) {
        whiteCell.appendChild(createMoveToken(history[historyIndex], historyIndex + 1))
        historyIndex += 1
        turn = 'black'
      }

      if (turn === 'black' && history[historyIndex] !== undefined) {
        blackCell.appendChild(createMoveToken(history[historyIndex], historyIndex + 1))
        historyIndex += 1
        turn = 'white'
        moveNumber += 1
      }

      li.appendChild(whiteCell)
      li.appendChild(blackCell)
      ol.appendChild(li)
    }

    const cur = ol.querySelector('.current-move')
    if (wrap) keepHistorySelectionVisible(wrap, cur)
  }

  // --- History navigation ---
  function atLatest() { return viewIndex === positionHistory.length - 1 }

  function navigateTo(index, { replace = false } = {}) {
    viewIndex = index
    const { fen, lastMove } = positionHistory[index]
    chess = new Chess(fen)
    cg.set({
      fen,
      lastMove: lastMove ?? undefined,
      movable: {
        color: userColor,
        dests: canPlayFromViewedPosition() ? toDests(chess) : new Map(),
      },
    })
    setDisplayedFen(fen)
    updateMoveHistory()
    updateNavButtons()
    updateHintBtn()
    renderAnalysisForPly(index)
    if (browseOnly) syncPlayState(replace)
    requestAnalysisForPly(index, fen)
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
    engineMoving = false
    hintMode = false
    pendingEngineGo = false
    currentSearch = null
    sendToEngine('stop')
    closeActiveAttempt(resultCodeForText(text), { completionReason: 'game_end' })
    showOverlay({ eyebrow: 'Game over', text })
  }

  function showOverlay({ eyebrow = 'Game over', text }) {
    app.querySelector('#result-eyebrow').textContent = eyebrow
    app.querySelector('#result-text').textContent = text
    app.querySelector('#result-overlay').classList.remove('hidden')
  }

  function hideResult() {
    app.querySelector('#result-overlay').classList.add('hidden')
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

  function canSelectAnalysisMove() {
    return !browseOnly && workerReady && !gameOver && !engineMoving && atLatest() && isUserTurn()
  }

  function canPlayFromViewedPosition() {
    if (browseOnly || !workerReady || engineMoving) return false
    if (!isUserTurn()) return false
    if (gameOver && atLatest()) return false
    if (requiresPuzzleLine() && !puzzleState.expectedLineReady) return false
    return true
  }

  function applyUserMove(orig, dest, promotion = 'q') {
    if (!atLatest()) {
      positionHistory = positionHistory.slice(0, viewIndex + 1)
      gameOver = false
      hideResult()
    }

    const move = chess.move({ from: orig, to: dest, promotion })
    if (!move) return false
    const moveUci = moveToUci(move)

    hintMode = false
    clearHint()
    positionHistory.push({ fen: chess.fen(), lastMove: [orig, dest], moveSan: move.san })
    notePuzzleUserMove(moveUci)
    viewIndex = positionHistory.length - 1
    updateMoveHistory()
    updateNavButtons()
    renderAnalysisForPly(viewIndex)
    cg.set({
      fen: chess.fen(),
      turnColor: chess.turn() === 'w' ? 'white' : 'black',
      movable: { color: userColor, dests: new Map() },
    })
    setDisplayedFen(chess.fen())

    const result = checkGameEnd()
    if (result) {
      showResult(result)
      return true
    }

    if (workerReady) {
      engineMoving = true
      updateHintBtn()
      requestEngineMove()
    }
    return true
  }

  // --- Apply engine move ---
  function applyEngineMove(uciMove) {
    if (gameOver) return
    const from = uciMove.slice(0, 2)
    const to = uciMove.slice(2, 4)
    const promotion = uciMove[4] ?? undefined

    const move = chess.move({ from, to, promotion })
    if (!move) return
    positionHistory.push({ fen: chess.fen(), lastMove: [from, to], moveSan: move.san })
    viewIndex = positionHistory.length - 1
    updateMoveHistory()
    updateNavButtons()
    renderAnalysisForPly(viewIndex)

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

    requestDisplayedAnalysis({ force: true })
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
          dests: canPlayFromViewedPosition() ? toDests(chess) : new Map(),
          events: {
            after(orig, dest) {
              applyUserMove(orig, dest, 'q')
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
    engineMoving = true
    updateHintBtn()
    requestEngineMove()
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
  app.querySelector('#toggle-analysis-visibility').addEventListener('click', () => {
    analysisHidden = !analysisHidden
    writeAnalysisVisibilityPreference(analysisHidden, session)
    renderAnalysisForPly(viewIndex)
  })
  app.querySelector('#settings-btn').addEventListener('click', () => navigate('settings'))
  app.querySelector('#flag-position-btn')?.addEventListener('click', async event => {
    const button = event.currentTarget
    const statusEl = app.querySelector('#flag-position-status')
    button.disabled = true
    statusEl.textContent = 'Flagging...'

    try {
      position = await updatePosition(position.id, { possible_bug: true })
      button.textContent = 'Flagged for review'
      statusEl.textContent = 'Saved'
    } catch {
      button.disabled = false
      statusEl.textContent = 'Could not save'
    }
  })
  app.querySelector('#engine-speed-select')?.addEventListener('change', event => {
    engineMoveSpeed = normalizeEngineMoveSpeed(event.target.value)
    event.target.value = engineMoveSpeed
    writeEngineMoveSpeedPreference(engineMoveSpeed, session)
    if (workerReady && engineMoving && currentSearch?.kind === 'engineMove') {
      requestEngineMove()
    }
  })
  app.querySelector('#analysis-lines').addEventListener('click', e => {
    const button = e.target.closest('.analysis-line-btn')
    if (!button || button.disabled || !canSelectAnalysisMove()) return
    const uci = button.dataset.uci
    if (!uci || uci.length < 4) return
    applyUserMove(uci.slice(0, 2), uci.slice(2, 4), uci[4] || 'q')
  })

  // --- Hint ---
  app.querySelector('#hint-btn').addEventListener('click', () => {
    if (!workerReady || !isUserTurn() || gameOver || engineMoving) return
    hintMode = true
    requestDisplayedAnalysis({ force: true, asHint: true })
  })

  function goToNextPositionOrLibrary() {
    closeActiveAttempt('completed', { completionReason: 'completed' })
    teardownWorker()
    if (nextPositionId) {
      navigate('play', nextPositionId, {
        play: { ply: 0, side: null, from: returnView },
        workout: workoutState,
      })
      return
    }
    navigate(returnView, null, {
      workout: workoutState,
    })
  }

  // --- Resign ---
  app.querySelector('#resign-btn').addEventListener('click', () => {
    if (!gameOver) showResult('You resigned — Engine wins')
  })

  app.querySelector('#restart-btn').addEventListener('click', () => {
    if (!browseOnly) startGame({ replaceUrl: true })
  })

  app.querySelector('#back-btn').addEventListener('click', () => {
    closeActiveAttempt('abandoned', { completionReason: 'abandoned' })
    teardownWorker()
    navigate(returnView, null, { workout: workoutState })
  })
  app.querySelector('#next-position-btn')?.addEventListener('click', goToNextPositionOrLibrary)

  // --- Result panel buttons ---
  app.querySelector('#dismiss-result-btn').addEventListener('click', hideResult)

  // --- Start / restart game ---
  function startGame({ replaceUrl = true } = {}) {
    if (currentAttemptId && !attemptClosed) {
      closeActiveAttempt('abandoned', { completionReason: 'restart' })
    }
    gameOver = false
    engineMoving = false
    hintMode = false
    pendingEngineGo = false
    currentSearch = null
    analysisByPly = new Map()
    positionHistory = initialHistory.map(step => ({ ...step }))
    puzzleState = createPuzzleState()
    currentAttemptId = null
    attemptClosed = false
    pendingAttemptClose = null
    viewIndex = browseOnly
      ? clampPly(initialPlayState.ply, positionHistory.length - 1, positionHistory.length - 1)
      : 0
    hideResult()
    chess = new Chess(positionHistory[viewIndex].fen)
    updateMoveHistory()
    updateNavButtons()
    setDisplayedFen(positionHistory[viewIndex].fen)
    app.querySelector('#analysis-spinner').className = 'analysis-spinner'
    app.querySelector('#analysis-lines').innerHTML = '<p class="analysis-placeholder">Step through moves or wait for analysis.</p>'
    renderAnalysisForPly(viewIndex)
    hidePuzzleFeedback()

    if (cg) cg.destroy()
    initBoard()

    if (browseOnly) {
      navigateTo(viewIndex, { replace: replaceUrl })
      return
    }

    syncPlayState(replaceUrl)
    beginPracticeAttempt()

    sendToEngine('stop')
    sendToEngine('ucinewgame')

    const fenTurn = chess.turn() // 'w' or 'b'
    const engineGoesFirst = (fenTurn === 'w' && userColor === 'black') ||
                            (fenTurn === 'b' && userColor === 'white')

    if (engineGoesFirst) {
      cg.set({ movable: { color: userColor, dests: new Map() } })
      engineGoFirst()
    } else if (workerReady) {
      requestDisplayedAnalysis({ force: true })
    }
  }

  function beginPracticeAttempt() {
    if (!isTrackedPuzzleAttempt()) return
    attemptClosed = false
    createPracticeAttempt({
      position_id: position.id,
      mode: 'classic',
      target_depth_plies: puzzleState.targetDepthPlies,
      metadata: {
        start_fen: position.fen,
        tracked_puzzle: true,
      },
    }).then(payload => {
      currentAttemptId = payload.id
      puzzleState.targetDepthPlies = payload.target_depth_plies || puzzleState.targetDepthPlies
      practiceSummary = mergePracticeSummary(practiceSummary, null, { startedAt: payload.started_at, started: true })
      renderPracticeSummary()
      if (pendingAttemptClose) {
        const queuedPayload = pendingAttemptClose
        pendingAttemptClose = null
        sendAttemptClose(queuedPayload)
      }
    }).catch(() => {
      currentAttemptId = null
    })
  }

  function closeActiveAttempt(result, options = {}) {
    if (!session.authenticated || attemptClosed || browseOnly) return
    attemptClosed = true
    const payload = buildAttemptClosePayload(result, options)
    renderPuzzleFeedback({
      matchedPrefixPlies: payload.matched_prefix_plies,
      targetDepthPlies: payload.target_depth_plies,
      completionReason: payload.completion_reason,
      solved: payload.matched_prefix_plies >= payload.target_depth_plies,
    })
    if (!currentAttemptId) {
      pendingAttemptClose = payload
      return
    }
    sendAttemptClose(payload)
  }

  function sendAttemptClose(payload) {
    void finishPracticeAttempt(currentAttemptId, payload).then(response => {
      puzzleSummary = mergePuzzleSummary(puzzleSummary, response.user_state)
      practiceSummary = mergePracticeSummary(practiceSummary, response.user_state)
      renderPracticeSummary()
      renderPuzzleFeedback({
        matchedPrefixPlies: response.attempt?.matched_prefix_plies ?? payload.matched_prefix_plies,
        targetDepthPlies: response.attempt?.target_depth_plies ?? payload.target_depth_plies,
        completionReason: response.attempt?.completion_reason ?? payload.completion_reason,
        solved: (response.attempt?.matched_prefix_plies ?? payload.matched_prefix_plies)
          >= (response.attempt?.target_depth_plies ?? payload.target_depth_plies),
      })
    }).catch(() => {})
  }

  function createMoveToken(text, ply) {
    const wrap = document.createElement('span')
    wrap.className = 'move-token-wrap'

    const token = document.createElement('span')
    token.className = 'move-token'
    token.textContent = text
    token.dataset.idx = ply
    if (viewIndex === ply) token.classList.add('current-move')

    const assessment = moveAssessmentForPly(ply)
    if (assessment) token.classList.add(assessment.className)
    wrap.appendChild(token)

    if (assessment) {
      const badge = document.createElement('span')
      badge.className = `move-annotation-badge ${assessment.className}`
      badge.textContent = assessment.symbol
      badge.title = assessment.label
      wrap.appendChild(badge)
    }

    const analysis = analysisByPly.get(ply)
    if (analysis?.score) {
      const chip = document.createElement('span')
      chip.className = 'move-eval-chip'
      chip.textContent = formatScoreCompact(analysis.score)
      chip.title = assessment ? `${assessment.label} move` : 'Engine evaluation'
      wrap.appendChild(chip)
    }

    return wrap
  }

  function buildAnalysisRecord(search, bestmoveUci) {
    const variations = [...search.lines.values()]
      .sort((a, b) => a.multipv - b.multipv)
      .slice(0, ANALYSIS_VARIATIONS)
      .map(line => ({
        ...line,
        firstMove: line.pv[0] || bestmoveUci || null,
        san: uciToSan(search.fen, line.pv[0] || bestmoveUci || null),
      }))

    if (variations.length === 0) return null

    return {
      ply: search.ply,
      fen: search.fen,
      status: 'complete',
      depth: highestDepth(search.lines),
      score: { cp: variations[0].cp, mate: variations[0].mate },
      variations,
    }
  }

  function maybeFreezePuzzleLine(search, record) {
    if (!isTrackedPuzzleAttempt() || puzzleState.expectedLineReady) return
    if (search.ply !== 0) return
    const primaryVariation = record?.variations?.[0]
    const puzzleGoal = determinePuzzleGoal({
      fen: positionHistory[0].fen,
      pv: primaryVariation?.pv || [],
      userColor,
      score: primaryVariation,
    })
    const userLine = extractExpectedUserLine(
      positionHistory[0].fen,
      primaryVariation?.pv || [],
      userColor,
      puzzleGoal.targetDepthPlies,
    )
    if (userLine.length === 0) return
    puzzleState.expectedLine = userLine
    puzzleState.targetDepthPlies = userLine.length
    puzzleState.completionMode = puzzleGoal.mode
    puzzleState.evalHoldThreshold = puzzleGoal.mode === 'eval'
      ? heldWinningEvalThreshold(primaryVariation, positionHistory[0].fen)
      : PUZZLE_EVAL_SOLVE_THRESHOLD
    puzzleState.expectedLineReady = true
    renderPuzzleFeedback({
      completionMode: puzzleState.completionMode,
      matchedPrefixPlies: puzzleState.matchedPrefixPlies,
      targetDepthPlies: puzzleState.targetDepthPlies,
      completionReason: 'tracking',
      solved: false,
    })
    maybeEnableUserMoves()
  }

  function notePuzzleUserMove(moveUci) {
    if (!isTrackedPuzzleAttempt() || attemptClosed) return
    puzzleState.playedLine.push(moveUci)
    if (!puzzleState.expectedLineReady) return

    if (puzzleState.completionMode === 'eval') {
      puzzleState.pendingEvalCheck = true
      renderPuzzleFeedback({
        completionMode: puzzleState.completionMode,
        matchedPrefixPlies: puzzleState.playedLine.length,
        targetDepthPlies: puzzleState.targetDepthPlies,
        completionReason: 'tracking',
        solved: false,
      })
      return
    }

    const expectedMove = puzzleState.expectedLine[puzzleState.playedLine.length - 1]
    if (sameMove(expectedMove, moveUci)) {
      puzzleState.matchedPrefixPlies = puzzleState.playedLine.length
      renderPuzzleFeedback({
        completionMode: puzzleState.completionMode,
        matchedPrefixPlies: puzzleState.matchedPrefixPlies,
        targetDepthPlies: puzzleState.targetDepthPlies,
        completionReason: 'tracking',
        solved: false,
      })
      if (puzzleState.matchedPrefixPlies >= puzzleState.targetDepthPlies) {
        closeActiveAttempt('completed', {
          completionReason: 'solved',
          completedNormally: true,
        })
      }
      return
    }

    closeActiveAttempt('lost', {
      completionReason: 'mismatch',
      completedNormally: false,
    })
  }

  function maybeResolveEvalPuzzle(search, record) {
    if (!isTrackedPuzzleAttempt() || attemptClosed) return
    if (puzzleState.completionMode !== 'eval' || !puzzleState.pendingEvalCheck) return
    if (search.kind !== 'analysis') return

    const userScore = scoreForColor(record?.score, userColor, record?.fen)
    if (userScore === null) return

    const completedMoveCount = puzzleState.playedLine.length
    const reachedFallbackDepth = completedMoveCount >= puzzleState.targetDepthPlies
    puzzleState.pendingEvalCheck = false

    if (userScore >= puzzleState.evalHoldThreshold || (reachedFallbackDepth && userScore > PUZZLE_EVAL_FAIL_THRESHOLD)) {
      puzzleState.matchedPrefixPlies = completedMoveCount
      closeActiveAttempt('completed', {
        completionReason: userScore >= puzzleState.evalHoldThreshold ? 'winning_eval' : 'stable_eval',
        completedNormally: true,
        targetDepthOverride: completedMoveCount,
        matchedPrefixOverride: completedMoveCount,
      })
      showOverlay({
        eyebrow: 'Puzzle solved',
        text: 'Solved it! Your move kept the advantage.',
      })
      return
    }

    if (userScore <= PUZZLE_EVAL_FAIL_THRESHOLD) {
      closeActiveAttempt('lost', {
        completionReason: 'eval_drop',
        completedNormally: false,
        targetDepthOverride: Math.max(completedMoveCount, 1),
        matchedPrefixOverride: Math.max(0, completedMoveCount - 1),
      })
      return
    }

    renderPuzzleFeedback({
      completionMode: puzzleState.completionMode,
      matchedPrefixPlies: completedMoveCount,
      targetDepthPlies: puzzleState.targetDepthPlies,
      completionReason: 'tracking',
      solved: false,
    })
  }

  function buildAttemptClosePayload(result, options = {}) {
    const targetDepthPlies = Number(options.targetDepthOverride ?? puzzleState.targetDepthPlies)
    const matchedPrefixPlies = Number(options.matchedPrefixOverride ?? puzzleState.matchedPrefixPlies)
    return {
      result,
      target_depth_plies: targetDepthPlies,
      matched_prefix_plies: matchedPrefixPlies,
      score_delta: Number(options.scoreDeltaOverride ?? matchedPrefixPlies),
      expected_line: puzzleState.expectedLine,
      played_line: puzzleState.playedLine,
      completion_reason: options.completionReason || '',
      completed_normally: Boolean(options.completedNormally),
      metadata: {
        final_fen: chess.fen(),
        ply: viewIndex,
      },
    }
  }

  function maybeEnableUserMoves() {
    if (!cg || browseOnly || !workerReady || engineMoving || !isUserTurn() || gameOver || !atLatest()) return
    if (requiresPuzzleLine() && !puzzleState.expectedLineReady) return
    cg.set({ movable: { color: userColor, dests: toDests(chess) } })
  }

  function isTrackedPuzzleAttempt() {
    return session.authenticated && !browseOnly
  }

  function requiresPuzzleLine() {
    return isTrackedPuzzleAttempt() && !attemptClosed
  }

  function renderPuzzleFeedback(summary) {
    const container = app.querySelector('#puzzle-feedback')
    if (!container || !isTrackedPuzzleAttempt()) return
    const displaySummary = {
      completionMode: summary?.completionMode ?? puzzleState.completionMode,
      ...puzzleSummary,
      ...summary,
      attemptCount: Number(summary?.attemptCount ?? puzzleSummary.attemptCount ?? 0),
      solvedCount: Number(summary?.solvedCount ?? puzzleSummary.solvedCount ?? 0),
    }
    container.hidden = false
    container.innerHTML = puzzleFeedbackHtml(displaySummary)
  }

  function renderPracticeSummary() {
    const container = app.querySelector('#practice-summary')
    if (!container || browseOnly || !session.authenticated) return
    container.hidden = false
    container.innerHTML = practiceSummaryHtml(practiceSummary)
  }

  function hidePuzzleFeedback() {
    const container = app.querySelector('#puzzle-feedback')
    if (!container) return
    container.hidden = true
    container.innerHTML = ''
  }

  function highestDepth(lines) {
    return Math.max(...[...lines.values()].map(line => line.depth))
  }

  function renderAnalysisLines(record) {
    if (!record.variations.length) {
      return '<p class="analysis-placeholder">No analysis lines yet.</p>'
    }

    const selectable = canSelectAnalysisMove()
    return record.variations.map(line => `
      <button
        class="analysis-line-btn"
        type="button"
        data-uci="${escapeHtml(line.firstMove || '')}"
        ${selectable && line.firstMove ? '' : 'disabled'}
      >
        <span class="analysis-rank">${line.multipv}.</span>
        <span class="analysis-move">${escapeHtml(line.san || line.firstMove || '...')}</span>
        <span class="analysis-score">${escapeHtml(formatScoreCompact(line))}</span>
      </button>
    `).join('')
  }

  function renderAnalysisSkeleton() {
    return Array.from({ length: ANALYSIS_VARIATIONS }, () => '<div class="analysis-line-skeleton"></div>').join('')
  }

  function moveAssessmentForPly(ply) {
    if (ply === 0) return null
    const previousStep = positionHistory[ply - 1]
    const currentStep = positionHistory[ply]
    const analysis = analysisByPly.get(ply - 1)
    const moveUci = lastMoveToUci(currentStep?.lastMove)
    if (!analysis?.variations?.length || !moveUci) return null

    const mover = fenSideToColor(previousStep.fen)
    const bestScore = scoreForColor(analysis.variations[0], mover, analysis.fen)
    if (bestScore === null) return null

    const matchedVariation = analysis.variations.find(line => sameMove(line.firstMove, moveUci))
    const actualScore = matchedVariation
      ? scoreForColor(matchedVariation, mover, analysis.fen)
      : scoreForColor(analysisByPly.get(ply)?.score, mover, currentStep.fen)
    if (actualScore === null) return null

    const loss = Math.max(0, bestScore - actualScore)
    if (matchedVariation && sameMove(matchedVariation.firstMove, analysis.variations[0].firstMove)) return qualityMeta('best')
    if (loss <= 60) return qualityMeta('good')
    if (loss <= 120) return qualityMeta('inaccuracy')
    if (loss <= 250) return qualityMeta('mistake')
    return qualityMeta('blunder')
  }

  function qualityMeta(kind) {
    switch (kind) {
      case 'best':
        return { label: 'Best move', className: 'quality-good', symbol: '!' }
      case 'good':
        return { label: 'Good move', className: 'quality-good', symbol: '!' }
      case 'inaccuracy':
        return { label: 'Inaccuracy', className: 'quality-inaccuracy', symbol: '?!' }
      case 'mistake':
        return { label: 'Mistake', className: 'quality-mistake', symbol: '?' }
      default:
        return { label: 'Blunder', className: 'quality-blunder', symbol: '??' }
    }
  }

  function formatScoreCompact(score) {
    if (!score) return '—'
    if (score.mate !== null) {
      return `${score.mate > 0 ? '+' : '-'}M${Math.abs(score.mate)}`
    }
    const cp = score.cp || 0
    return cp > 0 ? `+${(cp / 100).toFixed(1)}` : (cp / 100).toFixed(1)
  }

  function scoreToNumeric(score) {
    if (!score) return null
    if (score.mate !== null) {
      return Math.sign(score.mate) * (100000 - Math.min(Math.abs(score.mate), 999))
    }
    if (score.cp === null || score.cp === undefined) return null
    return score.cp
  }

  function scoreForColor(score, color, fen) {
    const numeric = scoreToNumeric(score)
    if (numeric === null || !fen) return null
    const sideToMove = fenSideToColor(fen)
    return color === sideToMove ? numeric : -numeric
  }

  function lastMoveToUci(lastMove) {
    if (!Array.isArray(lastMove) || lastMove.length < 2) return null
    return `${lastMove[0]}${lastMove[1]}`
  }

  function sameMove(left, right) {
    if (!left || !right) return false
    return left.slice(0, 4) === right.slice(0, 4)
  }

  function heldWinningEvalThreshold(score, fen) {
    const rootUserScore = scoreForColor(score, userColor, fen)
    if (rootUserScore === null || rootUserScore < PUZZLE_EVAL_HOLD_ROOT_THRESHOLD) {
      return PUZZLE_EVAL_SOLVE_THRESHOLD
    }
    return Math.max(
      PUZZLE_EVAL_HOLD_MIN_THRESHOLD,
      Math.min(PUZZLE_EVAL_SOLVE_THRESHOLD, Math.round(rootUserScore * PUZZLE_EVAL_HOLD_RATIO)),
    )
  }

  function uciToSan(fen, uciMove) {
    if (!uciMove) return null
    try {
      const board = new Chess(fen)
      const move = board.move({
        from: uciMove.slice(0, 2),
        to: uciMove.slice(2, 4),
        promotion: uciMove[4] || undefined,
      })
      return move?.san || uciMove
    } catch {
      return uciMove
    }
  }

  startGame({ replaceUrl: true })
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
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

function fenSideToColor(fen) {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white'
}

function fenMoveNumber(fen) {
  const moveNumber = Number.parseInt(fen.split(' ')[5], 10)
  return Number.isFinite(moveNumber) && moveNumber > 0 ? moveNumber : 1
}

function normalizePlaySide(side) {
  return side === 'white' || side === 'black' ? side : null
}

function normalizeTagFilters(tags) {
  if (!Array.isArray(tags)) return []
  return [...new Set(tags.map(tag => String(tag).trim()).filter(Boolean))]
}

function validatePlayablePosition(position, history) {
  validateFen(position?.fen)
  if (!Array.isArray(history) || history.length === 0) {
    throw new Error('Missing position history')
  }
  history.forEach(step => validateFen(step?.fen))
}

function validateFen(fen) {
  new Chess(fen)
}

function isFenPlayable(fen) {
  try {
    validateFen(fen)
    return true
  } catch {
    return false
  }
}

function resolvePositionContext({ session, playState = {}, browseState = {}, workoutState = {} }) {
  if (playState.from === 'workout') {
    return {
      tags: [],
      progress: 'all',
      sort: session.authenticated ? 'workout' : 'oldest',
      tactic: normalizeWorkoutTactic(workoutState.tactic),
    }
  }

  return {
    tags: browseState.mode === 'positions' ? normalizeTagFilters(browseState.tags) : [],
    progress: session.authenticated ? normalizeBrowseProgress(browseState.viewed) : 'all',
    sort: 'oldest',
    tactic: null,
  }
}

function hasPositionSequenceContext(positionContext) {
  return positionContext.tags.length > 0
    || positionContext.progress !== 'all'
    || positionContext.sort === 'workout'
    || Boolean(positionContext.tactic)
}

function normalizeBrowseProgress(value) {
  return ['not_started', 'in_progress', 'revision', 'mastered'].includes(value) ? value : 'all'
}

function normalizeWorkoutTactic(value) {
  const normalized = String(value || '').trim()
  return normalized || 'all'
}

function capitalize(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1)
}

function keepHistorySelectionVisible(container, currentMoveEl) {
  if (!currentMoveEl) {
    container.scrollTop = container.scrollHeight
    return
  }
  if (container.clientHeight <= 0 || container.scrollHeight <= container.clientHeight) return

  const row = currentMoveEl.closest('li') || currentMoveEl
  const top = row.offsetTop
  const bottom = top + row.offsetHeight
  const visibleTop = container.scrollTop
  const visibleBottom = visibleTop + container.clientHeight

  if (top < visibleTop) {
    container.scrollTop = top
  } else if (bottom > visibleBottom) {
    container.scrollTop = bottom - container.clientHeight
  }
}

function writeAnalysisVisibilityPreference(hidden, session) {
  void writeUserSettings(session, {
    analysis_visibility: hidden ? 'hidden' : 'visible',
  })
}

function writeEngineMoveSpeedPreference(speed, session) {
  const normalized = normalizeEngineMoveSpeed(speed)
  void writeUserSettings(session, { engine_move_speed: normalized })
}

function normalizeEngineMoveSpeed(speed) {
  return Object.prototype.hasOwnProperty.call(ENGINE_MOVE_SPEEDS, speed) ? speed : 'standard'
}

function engineMoveSpeedConfig(speed) {
  return ENGINE_MOVE_SPEEDS[normalizeEngineMoveSpeed(speed)]
}

function renderEngineMoveSpeedOptions(selectedSpeed) {
  const normalized = normalizeEngineMoveSpeed(selectedSpeed)
  return Object.entries(ENGINE_MOVE_SPEEDS).map(([value, option]) => `
    <option value="${escapeHtml(value)}" ${value === normalized ? 'selected' : ''}>${escapeHtml(option.label)}</option>
  `).join('')
}

function preferredSideFromSession(session) {
  const preferred = readUserSetting(session, 'preferred_side')
  return preferred === 'white' || preferred === 'black' ? preferred : null
}

function accountLabel(session) {
  if (session.authenticated) {
    return `${escapeHtml(session.user.display_name)} <a class="account-link account-link-secondary" href="/accounts/logout/">Sign out</a>`
  }
  return '<a class="account-link account-link-secondary" href="/accounts/login/">Sign in</a>'
}

function scoreDeltaForResult(result) {
  switch (result) {
    case 'won':
      return 10
    case 'completed':
      return 5
    case 'draw':
      return 2
    default:
      return 0
  }
}

function resultCodeForText(text) {
  if (text.includes('You win')) return 'won'
  if (text.includes('Draw')) return 'draw'
  if (text.includes('You resigned')) return 'abandoned'
  if (text.includes('Engine wins')) return 'lost'
  return 'completed'
}

function createPuzzleState() {
  return {
    completionMode: 'line',
    evalHoldThreshold: PUZZLE_EVAL_SOLVE_THRESHOLD,
    pendingEvalCheck: false,
    targetDepthPlies: PUZZLE_TARGET_DEPTH_PLIES,
    expectedLine: [],
    expectedLineReady: false,
    playedLine: [],
    matchedPrefixPlies: 0,
  }
}

function createPuzzleSummary(position) {
  const scoreSummary = position?.score_summary || {}
  return {
    attemptCount: Number(scoreSummary.attempt_count || 0),
    solvedCount: Number(scoreSummary.solved_count || 0),
  }
}

function mergePuzzleSummary(currentSummary, userState) {
  if (!userState) return currentSummary
  return {
    attemptCount: Number(userState.attempt_count ?? currentSummary.attemptCount ?? 0),
    solvedCount: Number(userState.solved_count ?? currentSummary.solvedCount ?? 0),
  }
}

function createPracticeSummary(position) {
  const userState = position?.user_state || {}
  const scoreSummary = position?.score_summary || {}
  const attemptCount = Number(userState.attempt_count ?? scoreSummary.attempt_count ?? 0)
  const lastAttemptedAt = userState.last_played_at || null
  const started = Boolean(lastAttemptedAt || attemptCount > 0)
  return {
    started,
    attemptCount,
    masteryScore: Number(userState.mastery_score ?? scoreSummary.mastery_score ?? 0),
    lastAttemptedAt,
    status: normalizePracticeStatus(userState.status, started),
  }
}

function mergePracticeSummary(currentSummary, userState, options = {}) {
  const nextSummary = {
    ...currentSummary,
  }

  if (userState) {
    const attemptCount = Number(userState.attempt_count ?? nextSummary.attemptCount ?? 0)
    const lastAttemptedAt = userState.last_played_at ?? nextSummary.lastAttemptedAt ?? null
    const started = Boolean(lastAttemptedAt || attemptCount > 0 || options.started)
    nextSummary.attemptCount = attemptCount
    nextSummary.masteryScore = Number(userState.mastery_score ?? nextSummary.masteryScore ?? 0)
    nextSummary.lastAttemptedAt = lastAttemptedAt
    nextSummary.started = started
    nextSummary.status = normalizePracticeStatus(userState.status, started)
    return nextSummary
  }

  const attemptCount = Number(options.attemptCount ?? nextSummary.attemptCount ?? 0)
  const lastAttemptedAt = options.startedAt ?? nextSummary.lastAttemptedAt ?? null
  const started = Boolean(options.started ?? nextSummary.started ?? lastAttemptedAt ?? attemptCount > 0)
  return {
    ...nextSummary,
    attemptCount,
    lastAttemptedAt,
    started,
    status: normalizePracticeStatus(nextSummary.status, started),
  }
}

function moveToUci(move) {
  return `${move.from}${move.to}${move.promotion || ''}`
}

function determinePuzzleGoal({ fen, pv, userColor, score }) {
  const mateTargetDepth = mateCompletionDepth({ fen, pv, userColor, score })
  if (mateTargetDepth !== null) {
    return { mode: 'line', targetDepthPlies: mateTargetDepth }
  }

  const advantageTargetDepth = materialSwingCompletionDepth({ fen, pv, userColor })
  if (advantageTargetDepth !== null) {
    return { mode: 'eval', targetDepthPlies: advantageTargetDepth }
  }

  return { mode: 'eval', targetDepthPlies: PUZZLE_TARGET_DEPTH_PLIES }
}

function mateCompletionDepth({ fen, pv, userColor, score }) {
  const mateDistance = Number(score?.mate)
  if (!Number.isFinite(mateDistance) || mateDistance === 0) return null
  const sideToMove = fenSideToColor(fen)
  const mateFavorsUser = (mateDistance > 0 && sideToMove === userColor)
    || (mateDistance < 0 && sideToMove !== userColor)
  if (!mateFavorsUser) return null
  if (Math.abs(mateDistance) > PUZZLE_MATE_LOOKAHEAD_PLIES) return null

  const mateTargetByScore = Math.abs(mateDistance)
  const board = new Chess(fen)
  let userMoveCount = 0
  const limit = Math.min(pv.length, PUZZLE_MATE_LOOKAHEAD_PLIES)

  for (let index = 0; index < limit; index += 1) {
    const move = applyUciMove(board, pv[index])
    if (!move) break
    if (move.color === colorToChessJs(userColor)) userMoveCount += 1
    if (board.isCheckmate()) {
      return userMoveCount > 0 ? userMoveCount : mateTargetByScore
    }
  }

  return Math.max(1, Math.min(mateTargetByScore, countUserMovesInPv(fen, pv, userColor)))
}

function materialSwingCompletionDepth({ fen, pv, userColor }) {
  const board = new Chess(fen)
  const initialMaterialScore = materialScoreForColor(board, userColor)
  let userMoveCount = 0

  for (let index = 0; index < pv.length; index += 1) {
    const move = applyUciMove(board, pv[index])
    if (!move) break
    const moverColor = move.color === 'w' ? 'white' : 'black'
    if (moverColor === userColor) userMoveCount += 1

    const durableCheckpoint = board.turn() === colorToChessJs(userColor) || index === pv.length - 1 || board.isGameOver()
    if (!durableCheckpoint || userMoveCount === 0) continue

    const currentMaterialScore = materialScoreForColor(board, userColor)
    if ((currentMaterialScore - initialMaterialScore) >= PUZZLE_MATERIAL_SWING_THRESHOLD) {
      return userMoveCount
    }
  }

  return null
}

function applyUciMove(board, uciMove) {
  try {
    return board.move({
      from: uciMove.slice(0, 2),
      to: uciMove.slice(2, 4),
      promotion: uciMove[4] || undefined,
    })
  } catch {
    return null
  }
}

function materialScoreForColor(board, color) {
  const weights = {
    p: 100,
    n: 320,
    b: 330,
    r: 500,
    q: 900,
    k: 0,
  }
  let score = 0
  for (const row of board.board()) {
    for (const piece of row) {
      if (!piece) continue
      const value = weights[piece.type] || 0
      score += piece.color === colorToChessJs(color) ? value : -value
    }
  }
  return score
}

function colorToChessJs(color) {
  return color === 'black' ? 'b' : 'w'
}

function extractExpectedUserLine(fen, pv, userColor, targetDepthPlies) {
  const line = []
  let turn = fenSideToColor(fen)
  for (const move of pv) {
    if (turn === userColor) {
      line.push(move)
      if (line.length >= targetDepthPlies) break
    }
    turn = turn === 'white' ? 'black' : 'white'
  }
  return line
}

function countUserMovesInPv(fen, pv, userColor) {
  let count = 0
  let turn = fenSideToColor(fen)
  for (const move of pv) {
    if (!move) continue
    if (turn === userColor) count += 1
    turn = turn === 'white' ? 'black' : 'white'
  }
  return count
}

function puzzleFeedbackHtml(summary) {
  const headline = puzzleFeedbackHeadline(summary)
  return `
    <div class="puzzle-feedback-card">
      <p class="puzzle-feedback-label">Puzzle record</p>
      <p class="puzzle-feedback-stats">
        <strong>Attempts:</strong> ${summary.attemptCount}
        <span aria-hidden="true"> · </span>
        <strong>Successful:</strong> ${summary.solvedCount}
      </p>
      ${headline ? `<p class="puzzle-feedback-headline">${escapeHtml(headline)}</p>` : ''}
    </div>
  `
}

function puzzleFeedbackHeadline(summary) {
  if (summary.completionMode === 'eval') {
    if (summary.completionReason === 'tracking') {
      return 'Checking the continuation'
    }
    if (summary.solved) {
      return `Solved in ${summary.matchedPrefixPlies} move${summary.matchedPrefixPlies === 1 ? '' : 's'}`
    }
    if (summary.completionReason === 'eval_drop') {
      return 'That continuation did not work'
    }
    return ''
  }
  if (summary.completionReason === 'tracking') {
    return summary.matchedPrefixPlies > 0
      ? `Current attempt: ${summary.matchedPrefixPlies}/${summary.targetDepthPlies}`
      : ''
  }
  if (summary.solved) {
    return `Solved the line: ${summary.matchedPrefixPlies}/${summary.targetDepthPlies}`
  }
  return `Matched ${summary.matchedPrefixPlies}/${summary.targetDepthPlies} best moves`
}

function practiceSummaryHtml(summary) {
  return `
    <div class="practice-summary-card">
      <p class="practice-summary-label">Practice summary</p>
      <p class="practice-summary-row">
        <strong>Status:</strong> ${escapeHtml(practiceStatusLabel(summary.status, summary.started))}
        <span aria-hidden="true"> · </span>
        <strong>Mastery:</strong> ${escapeHtml(formatMasteryScore(summary.masteryScore))}
      </p>
      <p class="practice-summary-row">
        <strong>Attempts:</strong> ${summary.attemptCount}
        <span aria-hidden="true"> · </span>
        <strong>Last attempted:</strong> ${summary.lastAttemptedAt ? `
          <time datetime="${escapeHtml(summary.lastAttemptedAt)}">${escapeHtml(formatAttemptedAt(summary.lastAttemptedAt))}</time>
        ` : 'Never'}
      </p>
    </div>
  `
}

function normalizePracticeStatus(status, started = false) {
  if (status === 'in_progress' || status === 'revision' || status === 'mastered') return status
  return started ? 'in_progress' : 'new'
}

function practiceStatusLabel(status, started = false) {
  switch (normalizePracticeStatus(status, started)) {
    case 'in_progress':
      return 'In progress'
    case 'revision':
      return 'Revision'
    case 'mastered':
      return 'Mastered'
    default:
      return 'Not started'
  }
}

function formatMasteryScore(score) {
  const numeric = Number(score)
  return Number.isFinite(numeric) ? `${numeric}%` : '0%'
}

function formatAttemptedAt(value) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}
