/**
 * Integration test for the Play view game loop.
 *
 * Mocks: fetch (position API), Worker (Stockfish), Chessground.
 * Tests: after a user move, the engine receives UCI commands and its
 *        bestmove response is applied to the board.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountPlay } from '../views/play.js'
import { isPositionViewed } from '../viewed-positions.js'

// --- Module mocks (hoisted) ---

let capturedCgConfig = null

vi.mock('chessground', () => ({
  Chessground: vi.fn((el, config) => {
    capturedCgConfig = config
    return { set: vi.fn(), destroy: vi.fn() }
  }),
}))

vi.mock('chessground/assets/chessground.base.css', () => ({}))
vi.mock('chessground/assets/chessground.brown.css', () => ({}))
vi.mock('chessground/assets/chessground.cburnett.css', () => ({}))

// --- Helpers ---

function makeApp() {
  const div = document.createElement('div')
  document.body.appendChild(div)
  return div
}

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const AFTER_E4_E5_FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'

function mockPosition(fen = STARTING_FEN) {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 1, name: 'Test', fen, notes: '', tags: [], next_position_id: null }) })
  ))
}

// --- Tests ---

describe('Play view game loop', () => {
  let app
  let mockWorker
  let navigate
  let syncState
  let cgMock  // the cg instance returned by the mocked Chessground

  beforeEach(() => {
    app = makeApp()
    navigate = vi.fn()
    syncState = vi.fn()
    capturedCgConfig = null

    // Stub Worker: record postMessage calls; expose onmessage setter for test control
    mockWorker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null }
    vi.stubGlobal('Worker', vi.fn(() => mockWorker))

    // import.meta.url not available in JSDOM – stub URL constructor used by mountPlay
    vi.stubGlobal('URL', class {
      static createObjectURL = vi.fn(() => 'blob:http://localhost/blob-worker')
      static revokeObjectURL = vi.fn()

      constructor(url) {
        this.href = String(url)
        this.origin = this.href.startsWith('http://localhost')
          ? 'http://localhost'
          : 'http://example.com'
      }

      toString() { return this.href }
    })

    mockPosition()
  })

  afterEach(() => {
    app.remove()
    window.localStorage.clear()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('sends stop + position + go to engine after user move', async () => {
    await mountPlay(app, navigate, 1, {}, syncState)
    cgMock = vi.mocked(await import('chessground').then(m => m.Chessground)).mock.results.at(-1).value

    // Signal engine ready
    mockWorker.onmessage({ data: { type: 'ready' } })

    // Simulate user playing e2-e4 via Chessground's after callback
    capturedCgConfig.movable.events.after('e2', 'e4')

    const sentCmds = mockWorker.postMessage.mock.calls.map(c => c[0].cmd).filter(Boolean)
    expect(sentCmds).toContain('stop')
    expect(sentCmds.some(c => c.startsWith('position fen'))).toBe(true)
    expect(sentCmds).toContain('go movetime 3000')
  })

  it('applies engine bestmove to the board after user move', async () => {
    await mountPlay(app, navigate, 1, {}, syncState)
    cgMock = vi.mocked(await import('chessground').then(m => m.Chessground)).mock.results.at(-1).value

    mockWorker.onmessage({ data: { type: 'ready' } })
    capturedCgConfig.movable.events.after('e2', 'e4')

    // Engine responds
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 10 seldepth 12 multipv 1 score cp -30 nodes 5000 time 50 pv e7e5' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e7e5' } })

    // Board should have been updated with the engine's move
    const calls = cgMock.set.mock.calls
    const lastCall = calls.at(-1)?.[0]
    expect(lastCall?.lastMove).toEqual(['e7', 'e5'])
  })

  it('board starts disabled and enables only after engine ready', async () => {
    await mountPlay(app, navigate, 1, {}, syncState)
    const cgMockInstance = vi.mocked(await import('chessground').then(m => m.Chessground)).mock.results.at(-1).value

    // Board should start with no legal moves (disabled while engine loads)
    expect(capturedCgConfig.movable.dests).toEqual(new Map())

    // Signal ready — board should become active
    mockWorker.onmessage({ data: { type: 'ready' } })
    const lastSet = cgMockInstance.set.mock.calls.at(-1)?.[0]
    expect(lastSet?.movable?.dests).not.toEqual(new Map())
  })

  it('analyses the starting position immediately when the engine becomes ready', async () => {
    await mountPlay(app, navigate, 1, {}, syncState)

    mockWorker.onmessage({ data: { type: 'ready' } })

    const sentCmds = mockWorker.postMessage.mock.calls.map(c => c[0].cmd).filter(Boolean)
    expect(sentCmds).toContain('setoption name MultiPV value 4')
    expect(sentCmds).toContain(`position fen ${STARTING_FEN}`)
    expect(sentCmds).toContain('go movetime 1200')
  })

  it('renders multipv alternatives and move-quality signals from engine analysis', async () => {
    await mountPlay(app, navigate, 1, {}, syncState)

    mockWorker.onmessage({ data: { type: 'ready' } })
    expect(app.querySelector('#analysis-spinner')?.className).toContain('spinning')
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp 52 nodes 8000 time 120 pv e2e4 e7e5' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 2 score cp 31 nodes 8000 time 120 pv d2d4 d7d5' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 3 score cp 18 nodes 8000 time 120 pv g1f3 d7d5' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 4 score cp 10 nodes 8000 time 120 pv c2c4 e7e5' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e2e4' } })

    expect(app.querySelector('#analysis-spinner')?.className).not.toContain('spinning')
    expect(app.querySelector('#analysis-lines')?.textContent).toContain('e4')
    expect(app.querySelector('#analysis-lines')?.textContent).toContain('d4')

    capturedCgConfig.movable.events.after('e2', 'e4')
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 14 seldepth 18 multipv 1 score cp 40 nodes 4000 time 80 pv e7e5 g1f3' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e7e5' } })

    expect(app.querySelector('.move-token[data-idx="1"]')?.className).toContain('quality-good')
    expect(app.querySelector('.move-annotation-badge')?.textContent).toBe('!')
    expect(app.querySelector('.move-eval-chip')?.textContent).toBe('+0.4')
  })

  it('lets the user click an analyzed candidate move to play it', async () => {
    await mountPlay(app, navigate, 1, {}, syncState)
    cgMock = vi.mocked(await import('chessground').then(m => m.Chessground)).mock.results.at(-1).value

    mockWorker.onmessage({ data: { type: 'ready' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp 52 nodes 8000 time 120 pv e2e4 e7e5' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 2 score cp 31 nodes 8000 time 120 pv d2d4 d7d5' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e2e4' } })

    const suggestion = app.querySelector('.analysis-line-btn[data-uci="e2e4"]')
    expect(suggestion?.disabled).toBe(false)

    suggestion.click()

    expect(app.querySelector('#move-history').textContent).toContain('e4')
    const lastCall = cgMock.set.mock.calls.at(-1)?.[0]
    expect(lastCall?.fen).toBe(AFTER_E4_FEN)

    const sentCmds = mockWorker.postMessage.mock.calls.map(c => c[0].cmd).filter(Boolean)
    expect(sentCmds).toContain(`position fen ${AFTER_E4_FEN}`)
    expect(sentCmds).toContain('go movetime 3000')
  })

  it('lets the user restart from an earlier ply by playing from history', async () => {
    await mountPlay(app, navigate, 1, {}, syncState)
    cgMock = vi.mocked(await import('chessground').then(m => m.Chessground)).mock.results.at(-1).value

    mockWorker.onmessage({ data: { type: 'ready' } })
    capturedCgConfig.movable.events.after('e2', 'e4')
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 10 seldepth 12 multipv 1 score cp -30 nodes 5000 time 50 pv e7e5' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e7e5' } })

    app.querySelector('#back-move-btn').click()
    app.querySelector('#back-move-btn').click()

    capturedCgConfig.movable.events.after('d2', 'd4')

    expect(app.querySelector('#move-history').textContent).toContain('d4')
    expect(app.querySelector('#move-history').textContent).not.toContain('e4')
    expect(app.querySelector('#move-history').textContent).not.toContain('e5')

    const lastCall = cgMock.set.mock.calls.at(-1)?.[0]
    expect(lastCall?.fen).toBe('rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1')

    const sentCmds = mockWorker.postMessage.mock.calls.map(c => c[0].cmd).filter(Boolean)
    expect(sentCmds).toContain('position fen rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1')
    expect(sentCmds).toContain('go movetime 3000')
  })

  it('keeps the full past-moves list visible when stepping back through the line', async () => {
    await mountPlay(app, navigate, 1, {}, syncState)

    mockWorker.onmessage({ data: { type: 'ready' } })
    capturedCgConfig.movable.events.after('e2', 'e4')
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 10 seldepth 12 multipv 1 score cp -30 nodes 5000 time 50 pv e7e5' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e7e5' } })

    app.querySelector('#back-move-btn').click()

    expect(app.querySelector('#move-history')?.textContent).toContain('e4')
    expect(app.querySelector('#move-history')?.textContent).toContain('e5')
    expect(app.querySelector('.move-token.current-move')?.dataset.idx).toBe('1')
  })

  it('does not use scrollIntoView when history updates', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    await mountPlay(app, navigate, 1, {}, syncState)

    mockWorker.onmessage({ data: { type: 'ready' } })
    capturedCgConfig.movable.events.after('e2', 'e4')
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 10 seldepth 12 multipv 1 score cp -30 nodes 5000 time 50 pv e7e5' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e7e5' } })
    app.querySelector('#back-move-btn').click()

    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('persists hidden best-next-moves visibility between play screens', async () => {
    await mountPlay(app, navigate, 1, {}, syncState)

    mockWorker.onmessage({ data: { type: 'ready' } })
    app.querySelector('#toggle-analysis-visibility')?.click()

    expect(app.querySelector('#analysis-lines')?.textContent).toBe('')
    expect(app.querySelector('#analysis-spinner')?.hidden).toBe(true)
    expect(app.querySelector('#board-analysis-indicator')?.hidden).toBe(false)
    expect(app.querySelector('#board-analysis-indicator .analysis-spinner')?.className).toContain('spinning')
    expect(window.localStorage.getItem('chessterfield:analysis-visibility:v1')).toBe('hidden')

    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp 52 nodes 8000 time 120 pv e2e4 e7e5' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e2e4' } })

    expect(app.querySelector('#board-analysis-indicator')?.hidden).toBe(true)

    app.remove()
    app = makeApp()
    await mountPlay(app, navigate, 2, {}, syncState)

    expect(app.querySelector('#toggle-analysis-visibility')?.textContent).toBe('Show best next moves')
    expect(app.querySelector('#analysis-lines')?.textContent).toBe('')
    expect(app.querySelector('#analysis-spinner')?.hidden).toBe(true)
    expect(app.querySelector('#board-analysis-indicator')?.hidden).toBe(true)
  })

  it('marks saved positions as viewed locally and shows a note', async () => {
    await mountPlay(app, navigate, 1, {}, syncState)

    expect(isPositionViewed(1)).toBe(true)
    expect(app.querySelector('.viewed-pill')?.textContent).toContain('Seen')
  })

  it('shows a next-position button for saved positions and navigates to it', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 1, name: 'Test', fen: STARTING_FEN, notes: '', tags: [], next_position_id: 2 }),
      })
    ))

    await mountPlay(app, navigate, 1, {}, syncState)

    app.querySelector('#next-position-btn').click()
    expect(navigate).toHaveBeenCalledWith('play', 2, {
      play: { ply: 0, side: null },
    })
  })

  it('returns to the library at the end of a filtered next-position flow', async () => {
    vi.stubGlobal('fetch', vi.fn((url) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 1, name: 'Filtered', fen: STARTING_FEN, notes: '', tags: ['endgame'], next_position_id: null }),
      })
    ))

    await mountPlay(app, navigate, 1, {}, syncState, {
      mode: 'positions',
      page: 2,
      tags: ['endgame'],
      viewed: 'all',
    })

    expect(fetch).toHaveBeenCalledWith('/api/positions/1/?tag=endgame')
    expect(app.querySelector('#next-position-btn')?.textContent).toContain('Back to Library')

    app.querySelector('#next-position-btn').click()
    expect(navigate).toHaveBeenCalledWith('library')
  })

  it('defaults play side from the FEN turn when none is specified', async () => {
    mockPosition('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')

    await mountPlay(app, navigate, 1, {}, syncState)

    const activeSide = app.querySelector('.side-btn.active')
    expect(activeSide?.dataset.side).toBe('black')
  })

  it('shows a load error instead of crashing on an invalid position FEN', async () => {
    mockPosition('8/8/8/8/8/8/8/8 w - - 0 1')

    await mountPlay(app, navigate, 1, {}, syncState)

    expect(app.textContent).toContain('Position could not be loaded')
    expect(app.querySelector('#board')).toBeNull()
  })

  it('keeps move history aligned in white and black columns when black moves first', async () => {
    mockPosition('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')

    await mountPlay(app, navigate, 1, {}, syncState)
    mockWorker.onmessage({ data: { type: 'ready' } })

    capturedCgConfig.movable.events.after('e7', 'e5')

    const firstRow = app.querySelector('.move-history li')
    expect(firstRow?.querySelector('.move-number')?.textContent).toBe('1.')
    expect(firstRow?.querySelector('.move-cell-white')?.textContent.trim()).toBe('')
    expect(firstRow?.querySelector('.move-cell-black')?.textContent).toContain('e5')
  })

  it('restarts the current attempt from the starting position', async () => {
    await mountPlay(app, navigate, 1, {}, syncState)
    cgMock = vi.mocked(await import('chessground').then(m => m.Chessground)).mock.results.at(-1).value

    mockWorker.onmessage({ data: { type: 'ready' } })
    capturedCgConfig.movable.events.after('e2', 'e4')
    expect(app.querySelector('#move-history').textContent).toContain('e4')

    app.querySelector('#restart-btn').click()

    expect(app.querySelector('#move-history').textContent).not.toContain('e4')
    expect(app.querySelector('.fen-display')?.textContent).toBe(STARTING_FEN)

    const sentCmds = mockWorker.postMessage.mock.calls.map(c => c[0].cmd).filter(Boolean)
    expect(sentCmds).toContain('ucinewgame')
    expect(cgMock.destroy).toHaveBeenCalled()
  })

  it('shows a dismissible board overlay after checkmate and navigates from the top bar', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 1,
          name: 'Mate in One',
          fen: '6k1/5Q2/6K1/8/8/8/8/8 w - - 0 1',
          notes: '',
          tags: [],
          next_position_id: 2,
        }),
      })
    ))

    await mountPlay(app, navigate, 1, {}, syncState)
    mockWorker.onmessage({ data: { type: 'ready' } })

    capturedCgConfig.movable.events.after('f7', 'g7')

    expect(app.querySelector('#result-overlay')?.classList.contains('hidden')).toBe(false)
    expect(app.querySelector('#result-text')?.textContent).toContain('Checkmate')
    expect(app.querySelector('#board')).not.toBeNull()

    app.querySelector('#dismiss-result-btn').click()
    expect(app.querySelector('#result-overlay')?.classList.contains('hidden')).toBe(true)

    app.querySelector('#restart-btn').click()
    capturedCgConfig.movable.events.after('f7', 'g7')
    app.querySelector('#next-position-btn').click()
    expect(navigate).toHaveBeenCalledWith('play', 2, {
      play: { ply: 0, side: null },
    })
  })

  it('can open a game at its final position and step through history', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 2,
          name: 'vs opponent (2026-03-20)',
          fen: AFTER_E4_E5_FEN,
          user_color: 'white',
          result_label: 'You won',
          history: [
            { fen: STARTING_FEN, last_move: null, move_san: null },
            { fen: AFTER_E4_FEN, last_move: ['e2', 'e4'], move_san: 'e4' },
            { fen: AFTER_E4_E5_FEN, last_move: ['e7', 'e5'], move_san: 'e5' },
          ],
        }),
      })
    ))

    await mountPlay(app, navigate, 'game:2', {}, syncState)
    cgMock = vi.mocked(await import('chessground').then(m => m.Chessground)).mock.results.at(-1).value

    expect(fetch).toHaveBeenCalledWith('/api/games/2/')
    expect(app.textContent).toContain('vs opponent (2026-03-20) — Final Position')
    expect(app.textContent).toContain('You won')
    expect(app.querySelector('#move-history').textContent).toContain('e4')
    expect(app.querySelector('#move-history').textContent).toContain('e5')
    expect(app.querySelector('#back-move-btn').disabled).toBe(false)

    mockWorker.onmessage({ data: { type: 'ready' } })
    let sentCmds = mockWorker.postMessage.mock.calls.map(c => c[0].cmd).filter(Boolean)
    expect(sentCmds).toContain(`position fen ${AFTER_E4_E5_FEN}`)
    expect(sentCmds).toContain('go movetime 1200')

    app.querySelector('#back-move-btn').click()

    const lastCall = cgMock.set.mock.calls.at(-1)?.[0]
    expect(lastCall?.fen).toBe(AFTER_E4_FEN)

    sentCmds = mockWorker.postMessage.mock.calls.map(c => c[0].cmd).filter(Boolean)
    expect(sentCmds).toContain(`position fen ${AFTER_E4_FEN}`)
    expect(syncState).toHaveBeenCalledWith({
      play: { ply: 1, side: 'white' },
    }, { replace: false })
  })
})
