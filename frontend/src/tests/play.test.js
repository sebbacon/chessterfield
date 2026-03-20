/**
 * Integration test for the Play view game loop.
 *
 * Mocks: fetch (position API), Worker (Stockfish), Chessground.
 * Tests: after a user move, the engine receives UCI commands and its
 *        bestmove response is applied to the board.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountPlay } from '../views/play.js'

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

function mockPosition(fen = STARTING_FEN) {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 1, name: 'Test', fen, notes: '', tags: [] }) })
  ))
}

// --- Tests ---

describe('Play view game loop', () => {
  let app
  let mockWorker
  let navigate
  let cgMock  // the cg instance returned by the mocked Chessground

  beforeEach(() => {
    app = makeApp()
    navigate = vi.fn()
    capturedCgConfig = null

    // Stub Worker: record postMessage calls; expose onmessage setter for test control
    mockWorker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null }
    vi.stubGlobal('Worker', vi.fn(() => mockWorker))

    // import.meta.url not available in JSDOM – stub URL constructor used by mountPlay
    vi.stubGlobal('URL', class {
      constructor(url) { this.href = String(url) }
      toString() { return this.href }
    })

    mockPosition()
  })

  afterEach(() => {
    app.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('sends stop + position + go to engine after user move', async () => {
    await mountPlay(app, navigate, 1)
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
    await mountPlay(app, navigate, 1)
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
    await mountPlay(app, navigate, 1)
    const cgMockInstance = vi.mocked(await import('chessground').then(m => m.Chessground)).mock.results.at(-1).value

    // Board should start with no legal moves (disabled while engine loads)
    expect(capturedCgConfig.movable.dests).toEqual(new Map())

    // Signal ready — board should become active
    mockWorker.onmessage({ data: { type: 'ready' } })
    const lastSet = cgMockInstance.set.mock.calls.at(-1)?.[0]
    expect(lastSet?.movable?.dests).not.toEqual(new Map())
  })

  it('can open a game at its final position', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 2,
          name: 'vs opponent (2026-03-20)',
          fen: STARTING_FEN,
          user_color: 'white',
          result_label: 'You won',
        }),
      })
    ))

    await mountPlay(app, navigate, 'game:2')

    expect(fetch).toHaveBeenCalledWith('/api/games/2/')
    expect(app.textContent).toContain('vs opponent (2026-03-20) — Final Position')
    expect(app.textContent).toContain('You won')
  })
})
