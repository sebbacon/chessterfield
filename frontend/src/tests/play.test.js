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
import { resetSessionCache } from '../state/session.js'

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

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
}

// --- Tests ---

describe('Play view game loop', () => {
  let app
  let mockWorker
  let navigate
  let syncState
  let cgMock  // the cg instance returned by the mocked Chessground

  beforeEach(() => {
    resetSessionCache()
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
    expect(sentCmds).toContain('go movetime 500')
  })

  it('uses the saved engine speed setting for engine moves', async () => {
    window.localStorage.setItem('chessterfield:engine-move-speed:v1', 'fast')

    await mountPlay(app, navigate, 1, {}, syncState)

    mockWorker.onmessage({ data: { type: 'ready' } })
    capturedCgConfig.movable.events.after('e2', 'e4')

    const sentCmds = mockWorker.postMessage.mock.calls.map(c => c[0].cmd).filter(Boolean)
    expect(sentCmds).toContain('go movetime 1000')
    expect(app.querySelector('#engine-speed-select')).toBeNull()
  })

  it('flags a position for review from the play screen', async () => {
    const fetchMock = vi.fn((url, options) => {
      if (url === '/api/me/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ authenticated: false, user: null, practice_modes: [] }),
        })
      }
      if (url === '/api/positions/1/' && options?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 1, name: 'Test', fen: STARTING_FEN, notes: '', tags: [], possible_bug: true, next_position_id: null }),
        })
      }
      if (url === '/api/positions/1/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 1, name: 'Test', fen: STARTING_FEN, notes: '', tags: [], possible_bug: false, next_position_id: null }),
        })
      }
      throw new Error(`Unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await mountPlay(app, navigate, 1, {}, syncState)

    const button = app.querySelector('#flag-position-btn')
    expect(button?.textContent).toContain('Problem? Flag this position for review')
    expect(app.querySelector('#position-review-alert')?.classList.contains('hidden')).toBe(true)

    button.click()
    await flush()

    const patchCall = fetchMock.mock.calls.find(([url, options]) => url === '/api/positions/1/' && options?.method === 'PATCH')
    expect(patchCall).toBeTruthy()
    expect(JSON.parse(patchCall[1].body)).toEqual({ possible_bug: true })
    expect(app.querySelector('#flag-position-btn')).toBeNull()
    expect(app.querySelector('#flag-position-status')?.textContent).toContain('Saved')
    expect(app.querySelector('#position-review-alert')?.classList.contains('hidden')).toBe(false)
    expect(app.querySelector('#position-review-alert')?.textContent).toContain('Flagged for review')
    expect(app.querySelector('#position-review-alert')?.textContent).toContain('may have a bug or issue')
  })

  it('shows a prominent alert for positions already flagged for review', async () => {
    const fetchMock = vi.fn((url) => {
      if (url === '/api/me/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ authenticated: false, user: null, practice_modes: [] }),
        })
      }
      if (url === '/api/positions/1/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 1, name: 'Test', fen: STARTING_FEN, notes: '', tags: [], possible_bug: true, next_position_id: null }),
        })
      }
      throw new Error(`Unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await mountPlay(app, navigate, 1, {}, syncState)

    expect(app.querySelector('#position-review-alert')?.classList.contains('hidden')).toBe(false)
    expect(app.querySelector('#position-review-alert')?.textContent).toContain('Flagged for review')
    expect(app.querySelector('#position-review-alert')?.textContent).toContain('may have a bug or issue')
    expect(app.querySelector('#flag-position-btn')).toBeNull()
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

  it('ignores a stale analysis bestmove after the user move and waits for the engine reply', async () => {
    await mountPlay(app, navigate, 1, {}, syncState)
    cgMock = vi.mocked(await import('chessground').then(m => m.Chessground)).mock.results.at(-1).value

    mockWorker.onmessage({ data: { type: 'ready' } })
    capturedCgConfig.movable.events.after('e2', 'e4')

    expect(() => {
      mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e2e4' } })
    }).not.toThrow()

    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 10 seldepth 12 multipv 1 score cp -30 nodes 5000 time 50 pv e7e5' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e7e5' } })

    const lastCall = cgMock.set.mock.calls.at(-1)?.[0]
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
    expect(sentCmds).toContain('go movetime 500')
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
    expect(sentCmds).toContain('go movetime 500')
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
    expect(app.querySelector('.viewed-pill')).toBeNull()
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
      play: { ply: 0, side: null, from: 'browse' },
      workout: {},
    })
  })

  it('returns to browse at the end of a filtered next-position flow', async () => {
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
    expect(app.querySelector('#next-position-btn')?.textContent).toContain('Back to Browse')

    app.querySelector('#next-position-btn').click()
    expect(navigate).toHaveBeenCalledWith('browse', null, { workout: {} })
  })

  it('uses the workout tactic context for position loading and returns to workout', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url === '/api/me/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ authenticated: true, user: { display_name: 'Player One' }, practice_modes: [] }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 1, name: 'Fork Drill', fen: STARTING_FEN, notes: '', tags: ['tactic:fork'], next_position_id: null }),
      })
    }))

    await mountPlay(app, navigate, 1, { from: 'workout' }, syncState, {
      workout: { tactic: 'tactic:fork' },
    })

    expect(fetch).toHaveBeenCalledWith('/api/positions/1/?sort=workout&tactic=tactic%3Afork')
    expect(app.querySelector('#back-btn')?.textContent).toBe('All workouts')
    expect(app.querySelector('#next-position-btn')?.textContent).toContain('Back to Workout')

    app.querySelector('#next-position-btn')?.click()
    expect(navigate).toHaveBeenCalledWith('workout', null, { workout: { tactic: 'tactic:fork' } })
  })

  it('skips an invalid workout position by redirecting to the next valid one', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url === '/api/me/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ authenticated: true, user: { display_name: 'Player One' }, practice_modes: [] }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 20539,
          name: 'Invalid Workout Position',
          fen: '8/8/8/8/8/8/6r1/1Q1K3n w - - 0 1',
          notes: '',
          tags: ['tactic:Attack On A Pinned Piece'],
          next_position_id: 20540,
        }),
      })
    }))

    await mountPlay(app, navigate, 20539, { from: 'workout' }, syncState, {
      workout: { tactic: 'tactic:Attack On A Pinned Piece' },
    })

    expect(navigate).toHaveBeenCalledWith('play', 20540, {
      workout: { tactic: 'tactic:Attack On A Pinned Piece' },
      play: { ply: 0, side: null, from: 'workout' },
    }, { replace: true })
  })

  it('defaults play side from the FEN turn when none is specified', async () => {
    mockPosition('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')

    await mountPlay(app, navigate, 1, {}, syncState)

    const activeSide = app.querySelector('.side-btn.active')
    expect(activeSide?.dataset.side).toBe('black')
  })

  it('uses the anonymous preferred-side setting when present', async () => {
    window.localStorage.setItem('chessterfield:preferred-side:v1', 'black')

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
      play: { ply: 0, side: null, from: 'browse' },
      workout: {},
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

  it('does not persist puzzle attempts for anonymous users', async () => {
    const fetchMock = vi.fn((url) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 1, name: 'Test', fen: STARTING_FEN, notes: '', tags: [], next_position_id: null }),
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await mountPlay(app, navigate, 1, {}, syncState)
    await flush()
    mockWorker.onmessage({ data: { type: 'ready' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp 52 nodes 8000 time 120 pv e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e2e4' } })
    capturedCgConfig.movable.events.after('e2', 'e4')

    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/practice/attempts/'))).toBe(false)
  })

  it('loads engine speed from signed-in settings and persists changes through the settings API', async () => {
    const fetchMock = vi.fn((url, options) => {
      if (url === '/api/me/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            authenticated: true,
            user: {
              id: 7,
              username: 'player1',
              display_name: 'Player 1',
              settings: {
                preferred_side: 'auto',
                analysis_visibility: 'visible',
                engine_move_speed: 'slow',
                default_library_mode: 'positions',
              },
            },
            practice_modes: [],
          }),
        })
      }
      if (url === '/api/positions/1/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 1,
            name: 'Puzzle',
            fen: STARTING_FEN,
            notes: '',
            tags: [],
            next_position_id: null,
            user_state: {
              status: 'revision',
              last_played_at: '2026-04-19T10:00:00Z',
              mastery_score: 72,
              attempt_count: 3,
            },
            score_summary: {
              mastery_score: 72,
              attempt_count: 3,
            },
          }),
        })
      }
      if (url === '/api/progress/positions/1/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ user_state: { viewed_at: '2026-04-19T10:00:00Z' } }),
        })
      }
      throw new Error(`Unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await mountPlay(app, navigate, 1, {}, syncState)
    expect(app.querySelector('#practice-summary')?.textContent).toContain('Practice summary')
    expect(app.querySelector('#practice-summary')?.textContent).toContain('Status:')
    expect(app.querySelector('#practice-summary')?.textContent).toContain('Revision')
    expect(app.querySelector('#practice-summary')?.textContent).toContain('Mastery:')
    expect(app.querySelector('#practice-summary')?.textContent).toContain('72%')

    expect(app.querySelector('#engine-speed-select')).toBeNull()
  })

  it('records a signed-in solved puzzle against the frozen best line', async () => {
    const fetchMock = vi.fn((url, options) => {
      if (url === '/api/me/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            authenticated: true,
            user: {
              id: 7,
              username: 'player1',
              display_name: 'Player 1',
              settings: {
                preferred_side: 'auto',
                analysis_visibility: 'visible',
                engine_move_speed: 'slow',
                default_library_mode: 'positions',
              },
            },
            practice_modes: [],
          }),
        })
      }
      if (url === '/api/positions/1/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 1,
            name: 'Puzzle',
            fen: STARTING_FEN,
            notes: '',
            tags: [],
            next_position_id: null,
            score_summary: {
              attempt_count: 0,
              solved_count: 0,
            },
          }),
        })
      }
      if (url === '/api/progress/positions/1/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ user_state: { viewed_at: '2026-04-19T10:00:00Z' } }),
        })
      }
      if (url === '/api/practice/attempts/' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 99, mode: 'classic', result: 'active', started_at: '2026-04-19T10:00:00Z', target_depth_plies: 4 }),
        })
      }
      if (url === '/api/practice/attempts/99/' && options?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            attempt: {
              id: 99,
              result: 'completed',
              score_delta: 4,
              target_depth_plies: 4,
              matched_prefix_plies: 4,
              completion_reason: 'winning_eval',
              completed_normally: true,
              expected_line: ['e2e4', 'g1f3', 'f1c4', 'd2d3'],
              played_line: ['e2e4', 'g1f3', 'f1c4', 'd2d3'],
              finished_at: '2026-04-19T10:05:00Z',
            },
            user_state: {
              status: 'revision',
              mastery_score: 41,
              last_played_at: '2026-04-19T10:05:00Z',
              attempt_count: 1,
              best_score: 4,
              last_score: 4,
              best_matched_prefix_plies: 4,
              last_matched_prefix_plies: 4,
              solved_count: 1,
            },
          }),
        })
      }
      throw new Error(`Unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await mountPlay(app, navigate, 1, {}, syncState)
    mockWorker.onmessage({ data: { type: 'ready' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp 52 nodes 8000 time 120 pv e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e2e4' } })

    expect(app.querySelector('#puzzle-feedback')?.textContent).toContain('Attempts:')
    expect(app.querySelector('#puzzle-feedback')?.textContent).toContain('0')
    expect(app.querySelector('#puzzle-feedback')?.textContent).toContain('Successful:')
    expect(app.querySelector('#puzzle-feedback')?.textContent).not.toContain('Target:')

    capturedCgConfig.movable.events.after('e2', 'e4')
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp 20 nodes 4000 time 100 pv e7e5 g1f3' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e7e5' } })

    capturedCgConfig.movable.events.after('g1', 'f3')
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp 18 nodes 4000 time 100 pv b8c6 f1c4' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove b8c6' } })

    capturedCgConfig.movable.events.after('f1', 'c4')
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp 15 nodes 4000 time 100 pv g8f6 d2d3' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove g8f6' } })

    capturedCgConfig.movable.events.after('d2', 'd3')
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp -310 nodes 4000 time 100 pv a7a6 c2c3' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove a7a6' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp 320 nodes 4000 time 100 pv c2c3' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove c2c3' } })
    await flush()

    const closeCall = fetchMock.mock.calls.find(([url, options]) => url === '/api/practice/attempts/99/' && options?.method === 'PATCH')
    expect(closeCall).toBeTruthy()
    const [, options] = closeCall
    expect(JSON.parse(options.body)).toMatchObject({
      result: 'completed',
      target_depth_plies: 4,
      matched_prefix_plies: 4,
      completion_reason: 'winning_eval',
      completed_normally: true,
      expected_line: ['e2e4', 'g1f3', 'f1c4', 'd2d3'],
      played_line: ['e2e4', 'g1f3', 'f1c4', 'd2d3'],
    })
    expect(app.querySelector('#puzzle-feedback')?.textContent).toContain('Attempts:')
    expect(app.querySelector('#puzzle-feedback')?.textContent).toContain('Successful:')
    expect(app.querySelector('#puzzle-feedback')?.textContent).toContain('1')
    expect(app.querySelector('#puzzle-feedback')?.textContent).toContain('Puzzle record')
    expect(app.querySelector('#practice-summary')?.textContent).toContain('Status:')
    expect(app.querySelector('#practice-summary')?.textContent).toContain('Revision')
    expect(app.querySelector('#practice-summary')?.textContent).toContain('Mastery:')
    expect(app.querySelector('#practice-summary')?.textContent).toContain('41%')
    expect(app.querySelector('#puzzle-feedback')?.textContent).not.toContain('Target:')
    expect(app.querySelector('#puzzle-feedback')?.textContent).not.toContain('Puzzle Tracking')
    expect(app.querySelector('#puzzle-feedback')?.textContent).toContain('Solved in 4 moves')
    expect(app.querySelector('#result-overlay')?.classList.contains('hidden')).toBe(false)
    expect(app.querySelector('#result-eyebrow')?.textContent).toContain('Puzzle solved')
    expect(app.querySelector('#result-text')?.textContent).toContain('Solved it! Your move kept the advantage.')
  })

  it('counts shorter solved lines as successful attempts', async () => {
    const fetchMock = vi.fn((url, options) => {
      if (url === '/api/me/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            authenticated: true,
            user: {
              id: 7,
              username: 'player1',
              display_name: 'Player 1',
              settings: {
                preferred_side: 'auto',
                analysis_visibility: 'visible',
                engine_move_speed: 'standard',
                default_library_mode: 'positions',
              },
            },
            practice_modes: [],
          }),
        })
      }
      if (url === '/api/positions/1/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 1,
            name: 'Mate in 2',
            fen: STARTING_FEN,
            notes: '',
            tags: [],
            next_position_id: null,
            score_summary: {
              attempt_count: 0,
              solved_count: 0,
            },
          }),
        })
      }
      if (url === '/api/progress/positions/1/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ user_state: { viewed_at: '2026-04-19T10:00:00Z' } }),
        })
      }
      if (url === '/api/practice/attempts/' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 99, mode: 'classic', result: 'active', started_at: '2026-04-19T10:00:00Z', target_depth_plies: 4 }),
        })
      }
      if (url === '/api/practice/attempts/99/' && options?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            attempt: {
              id: 99,
              result: 'completed',
              score_delta: 2,
              target_depth_plies: 2,
              matched_prefix_plies: 2,
              completion_reason: 'solved',
              completed_normally: true,
              expected_line: ['e2e4', 'd1h5'],
              played_line: ['e2e4', 'd1h5'],
              finished_at: '2026-04-19T10:05:00Z',
            },
            user_state: {
              status: 'revision',
              attempt_count: 1,
              best_score: 2,
              last_score: 2,
              best_matched_prefix_plies: 2,
              last_matched_prefix_plies: 2,
              solved_count: 1,
            },
          }),
        })
      }
      throw new Error(`Unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await mountPlay(app, navigate, 1, {}, syncState)
    mockWorker.onmessage({ data: { type: 'ready' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score mate 2 nodes 8000 time 120 pv e2e4 e7e5 d1h5' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e2e4' } })

    capturedCgConfig.movable.events.after('e2', 'e4')
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score mate 1 nodes 4000 time 100 pv e7e5 d1h5' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e7e5' } })

    capturedCgConfig.movable.events.after('d1', 'h5')
    await flush()

    const closeCall = fetchMock.mock.calls.find(([url, requestOptions]) => url === '/api/practice/attempts/99/' && requestOptions?.method === 'PATCH')
    expect(closeCall).toBeTruthy()
    const [, requestOptions] = closeCall
    expect(JSON.parse(requestOptions.body)).toMatchObject({
      result: 'completed',
      target_depth_plies: 2,
      matched_prefix_plies: 2,
      completion_reason: 'solved',
    })
    expect(app.querySelector('#puzzle-feedback')?.textContent).toContain('Successful:')
    expect(app.querySelector('#puzzle-feedback')?.textContent).toContain('1')
    expect(app.querySelector('#puzzle-feedback')?.textContent).toContain('Solved the line: 2/2')
  })

  it('treats a durable material-winning line as complete before four user moves', async () => {
    const tacticalFen = '4k3/8/8/4q3/8/8/4Q3/4K3 w - - 0 1'
    const fetchMock = vi.fn((url, options) => {
      if (url === '/api/me/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            authenticated: true,
            user: {
              id: 7,
              username: 'player1',
              display_name: 'Player 1',
              settings: {
                preferred_side: 'auto',
                analysis_visibility: 'visible',
                engine_move_speed: 'standard',
                default_library_mode: 'positions',
              },
            },
            practice_modes: [],
          }),
        })
      }
      if (url === '/api/positions/1/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 1,
            name: 'Win The Queen',
            fen: tacticalFen,
            notes: '',
            tags: [],
            next_position_id: null,
            score_summary: {
              attempt_count: 0,
              solved_count: 0,
            },
          }),
        })
      }
      if (url === '/api/practice/attempts/' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 99, mode: 'classic', result: 'active', started_at: '2026-04-19T10:00:00Z', target_depth_plies: 4 }),
        })
      }
      if (url === '/api/practice/attempts/99/' && options?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            attempt: {
              id: 99,
              result: 'completed',
              score_delta: 1,
              target_depth_plies: 1,
              matched_prefix_plies: 1,
              completion_reason: 'winning_eval',
              completed_normally: true,
              expected_line: ['e2e5'],
              played_line: ['e2e5'],
              finished_at: '2026-04-19T10:05:00Z',
            },
            user_state: {
              status: 'revision',
              attempt_count: 1,
              best_score: 1,
              last_score: 1,
              best_matched_prefix_plies: 1,
              last_matched_prefix_plies: 1,
              solved_count: 1,
            },
          }),
        })
      }
      throw new Error(`Unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await mountPlay(app, navigate, 1, {}, syncState)
    mockWorker.onmessage({ data: { type: 'ready' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp 600 nodes 8000 time 120 pv e2e5 e8f7' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e2e5' } })

    capturedCgConfig.movable.events.after('e2', 'e5')
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp -650 nodes 4000 time 100 pv e8f7 e5c7' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e8f7' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp 700 nodes 4000 time 100 pv e5c7' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e5c7' } })
    await flush()

    const closeCall = fetchMock.mock.calls.find(([url, requestOptions]) => url === '/api/practice/attempts/99/' && requestOptions?.method === 'PATCH')
    expect(closeCall).toBeTruthy()
    const [, requestOptions] = closeCall
    expect(JSON.parse(requestOptions.body)).toMatchObject({
      result: 'completed',
      target_depth_plies: 1,
      matched_prefix_plies: 1,
      expected_line: ['e2e5'],
      played_line: ['e2e5'],
      completion_reason: 'winning_eval',
    })
    expect(app.querySelector('#puzzle-feedback')?.textContent).toContain('Solved in 1 move')
  })

  it('solves eval-based puzzles correctly when the user is black', async () => {
    const blackAdvantageFen = 'r4rk1/1p3ppp/p1q1b3/4P3/8/2P1B3/1P3PQP/R5RK b - - 0 1'
    const fetchMock = vi.fn((url, options) => {
      if (url === '/api/me/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            authenticated: true,
            user: {
              id: 7,
              username: 'player1',
              display_name: 'Player 1',
              settings: {
                preferred_side: 'auto',
                analysis_visibility: 'visible',
                engine_move_speed: 'standard',
                default_library_mode: 'positions',
              },
            },
            practice_modes: [],
          }),
        })
      }
      if (url === '/api/positions/1/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 1,
            name: 'Attack On A Pinned Piece',
            fen: blackAdvantageFen,
            notes: '',
            tags: [],
            next_position_id: null,
            score_summary: {
              attempt_count: 0,
              solved_count: 0,
            },
          }),
        })
      }
      if (url === '/api/practice/attempts/' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 99, mode: 'classic', result: 'active', started_at: '2026-04-19T10:00:00Z', target_depth_plies: 3 }),
        })
      }
      if (url === '/api/practice/attempts/99/' && options?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            attempt: {
              id: 99,
              result: 'completed',
              score_delta: 1,
              target_depth_plies: 1,
              matched_prefix_plies: 1,
              completion_reason: 'winning_eval',
              completed_normally: true,
              expected_line: ['e6d5'],
              played_line: ['e6d5'],
              finished_at: '2026-04-19T10:05:00Z',
            },
            user_state: {
              status: 'mastered',
              mastery_score: 100,
              attempt_count: 1,
              best_score: 1,
              last_score: 1,
              best_matched_prefix_plies: 1,
              last_matched_prefix_plies: 1,
              solved_count: 1,
            },
          }),
        })
      }
      throw new Error(`Unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await mountPlay(app, navigate, 1, { side: 'black' }, syncState)
    mockWorker.onmessage({ data: { type: 'ready' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp 549 nodes 8000 time 120 pv e6d5 e3g5 a8e8 g5f6 d5g2 g1g2 e8e6 f2f4' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e6d5' } })

    capturedCgConfig.movable.events.after('e6', 'd5')
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp -556 nodes 4000 time 100 pv e3g5 d5g2' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove e3g5' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp 556 nodes 4000 time 100 pv d5g2 g1g2 a8e8' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove d5g2' } })
    await flush()

    const closeCall = fetchMock.mock.calls.find(([url, requestOptions]) => url === '/api/practice/attempts/99/' && requestOptions?.method === 'PATCH')
    expect(closeCall).toBeTruthy()
    const [, requestOptions] = closeCall
    expect(JSON.parse(requestOptions.body)).toMatchObject({
      result: 'completed',
      matched_prefix_plies: 1,
      completion_reason: 'winning_eval',
      played_line: ['e6d5'],
    })
    expect(app.querySelector('#puzzle-feedback')?.textContent).toContain('Solved in 1 move')
    expect(app.querySelector('#result-overlay')?.classList.contains('hidden')).toBe(false)
    expect(app.querySelector('#result-eyebrow')?.textContent).toContain('Puzzle solved')
  })

  it('counts a softened but still winning continuation as solved', async () => {
    const blackAdvantageFen = '6k1/5R1p/6p1/8/4b1P1/P4R2/1r5P/7K b - - 0 1'
    const fetchMock = vi.fn((url, options) => {
      if (url === '/api/me/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            authenticated: true,
            user: {
              id: 7,
              username: 'player1',
              display_name: 'Player 1',
              settings: {
                preferred_side: 'auto',
                analysis_visibility: 'visible',
                engine_move_speed: 'standard',
                default_library_mode: 'positions',
              },
            },
            practice_modes: [],
          }),
        })
      }
      if (url === '/api/positions/1/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 1,
            name: 'Attack On A Pinned Piece',
            fen: blackAdvantageFen,
            notes: '',
            tags: [],
            next_position_id: null,
            score_summary: {
              attempt_count: 0,
              solved_count: 0,
            },
          }),
        })
      }
      if (url === '/api/practice/attempts/' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 99, mode: 'classic', result: 'active', started_at: '2026-04-19T10:00:00Z', target_depth_plies: 3 }),
        })
      }
      if (url === '/api/practice/attempts/99/' && options?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            attempt: {
              id: 99,
              result: 'completed',
              score_delta: 1,
              target_depth_plies: 1,
              matched_prefix_plies: 1,
              completion_reason: 'winning_eval',
              completed_normally: true,
              expected_line: ['b2f2'],
              played_line: ['b2f2'],
              finished_at: '2026-04-19T10:05:00Z',
            },
            user_state: {
              status: 'mastered',
              mastery_score: 100,
              attempt_count: 1,
              best_score: 1,
              last_score: 1,
              best_matched_prefix_plies: 1,
              last_matched_prefix_plies: 1,
              solved_count: 1,
            },
          }),
        })
      }
      throw new Error(`Unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await mountPlay(app, navigate, 1, { side: 'black' }, syncState)
    mockWorker.onmessage({ data: { type: 'ready' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp 387 nodes 8000 time 120 pv b2f2 h1g1 f2f3' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove b2f2' } })

    capturedCgConfig.movable.events.after('b2', 'f2')
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp -160 nodes 4000 time 100 pv h1g1 f2f3' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove h1g1' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp 160 nodes 4000 time 100 pv f2f3' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove f2f3' } })
    await flush()

    const closeCall = fetchMock.mock.calls.find(([url, requestOptions]) => url === '/api/practice/attempts/99/' && requestOptions?.method === 'PATCH')
    expect(closeCall).toBeTruthy()
    expect(JSON.parse(closeCall[1].body)).toMatchObject({
      result: 'completed',
      matched_prefix_plies: 1,
      completion_reason: 'winning_eval',
      played_line: ['b2f2'],
    })
    expect(app.querySelector('#puzzle-feedback')?.textContent).toContain('Solved in 1 move')
    expect(app.querySelector('#result-overlay')?.classList.contains('hidden')).toBe(false)
  })

  it('counts a modest root advantage that still converts as solved', async () => {
    const blackAdvantageFen = '6k1/5R1p/6p1/8/4b1P1/P4R2/1r5P/7K b - - 0 1'
    const fetchMock = vi.fn((url, options) => {
      if (url === '/api/me/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            authenticated: true,
            user: {
              id: 7,
              username: 'player1',
              display_name: 'Player 1',
              settings: {
                preferred_side: 'auto',
                analysis_visibility: 'visible',
                engine_move_speed: 'standard',
                default_library_mode: 'positions',
              },
            },
            practice_modes: [],
          }),
        })
      }
      if (url === '/api/positions/1/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 1,
            name: 'Attack On A Pinned Piece',
            fen: blackAdvantageFen,
            notes: '',
            tags: [],
            next_position_id: null,
            score_summary: {
              attempt_count: 0,
              solved_count: 0,
            },
          }),
        })
      }
      if (url === '/api/practice/attempts/' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 99, mode: 'classic', result: 'active', started_at: '2026-04-19T10:00:00Z', target_depth_plies: 3 }),
        })
      }
      if (url === '/api/practice/attempts/99/' && options?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            attempt: {
              id: 99,
              result: 'completed',
              score_delta: 1,
              target_depth_plies: 1,
              matched_prefix_plies: 1,
              completion_reason: 'winning_eval',
              completed_normally: true,
              expected_line: ['b2f2'],
              played_line: ['b2f2'],
              finished_at: '2026-04-19T10:05:00Z',
            },
            user_state: {
              status: 'mastered',
              mastery_score: 100,
              attempt_count: 1,
              best_score: 1,
              last_score: 1,
              best_matched_prefix_plies: 1,
              last_matched_prefix_plies: 1,
              solved_count: 1,
            },
          }),
        })
      }
      throw new Error(`Unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await mountPlay(app, navigate, 1, { side: 'black' }, syncState)
    mockWorker.onmessage({ data: { type: 'ready' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp 150 nodes 8000 time 120 pv b2f2 h1g1 f2f3' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove b2f2' } })

    capturedCgConfig.movable.events.after('b2', 'f2')
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp -160 nodes 4000 time 100 pv h1g1 f2f3' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove h1g1' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'info depth 18 seldepth 22 multipv 1 score cp 160 nodes 4000 time 100 pv f2f3' } })
    mockWorker.onmessage({ data: { type: 'output', line: 'bestmove f2f3' } })
    await flush()

    const closeCall = fetchMock.mock.calls.find(([url, requestOptions]) => url === '/api/practice/attempts/99/' && requestOptions?.method === 'PATCH')
    expect(closeCall).toBeTruthy()
    expect(JSON.parse(closeCall[1].body)).toMatchObject({
      result: 'completed',
      matched_prefix_plies: 1,
      completion_reason: 'winning_eval',
      played_line: ['b2f2'],
    })
  })
})
