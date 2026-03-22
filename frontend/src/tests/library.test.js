import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mountLibrary } from '../views/library.js'


const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'


function makeApp() {
  const div = document.createElement('div')
  document.body.appendChild(div)
  return div
}


function makeResponse(data) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  })
}


async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
}


describe('Library view', () => {
  let app
  let navigate
  let syncState

  beforeEach(() => {
    app = makeApp()
    navigate = vi.fn()
    syncState = vi.fn()
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url === '/api/tags/') return makeResponse([])
      if (String(url).startsWith('/api/positions/')) {
        return makeResponse({
          results: [{ id: 1, name: 'Starting Position', fen: STARTING_FEN, tags: [] }],
          count: 1,
          page: 1,
          total_pages: 1,
        })
      }
      if (String(url).startsWith('/api/games/')) {
        return makeResponse({
          results: [{
            id: 2,
            name: 'vs opponent (2026-03-20)',
            fen: STARTING_FEN,
            user_color: 'white',
            winner: 'white',
            winner_label: 'White won',
            result_label: 'You won',
            status: 'mate',
          }],
          count: 1,
          page: 1,
          total_pages: 1,
        })
      }
      throw new Error(`Unhandled fetch ${url}`)
    }))
  })

  afterEach(() => {
    app.remove()
    window.localStorage.clear()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('switches from positions to games', async () => {
    await mountLibrary(app, navigate, {}, syncState)
    expect(app.querySelector('h1').textContent).toBe('Positions')
    expect(app.textContent).toContain('Starting Position')

    app.querySelector('#show-games').click()
    await flush()

    expect(app.querySelector('h1').textContent).toBe('Games')
    expect(app.textContent).toContain('vs opponent (2026-03-20)')
    expect(app.textContent).toContain('You won')
    expect(syncState).toHaveBeenCalledWith({
      library: { mode: 'games', page: 1, tags: [], viewed: 'all' },
      play: { ply: null, side: null },
    }, { replace: false })

    app.querySelector('.open-game-btn').click()
    expect(navigate).toHaveBeenCalledWith('play', 'game:2', {
      play: { ply: null, side: 'white' },
    })
  })

  it('filters positions by viewed status from local storage', async () => {
    window.localStorage.setItem('chessterfield:viewed-positions:v1', JSON.stringify({ 1: '2026-03-21T10:00:00.000Z' }))
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url === '/api/tags/') return makeResponse([])
      if (String(url).startsWith('/api/positions/?page=1')) {
        return makeResponse({
          results: [{ id: 1, name: 'Viewed Position', fen: STARTING_FEN, tags: [] }],
          count: 2,
          page: 1,
          total_pages: 2,
        })
      }
      if (String(url).startsWith('/api/positions/?page=2')) {
        return makeResponse({
          results: [{ id: 2, name: 'Fresh Position', fen: STARTING_FEN, tags: [] }],
          count: 2,
          page: 2,
          total_pages: 2,
        })
      }
      throw new Error(`Unhandled fetch ${url}`)
    }))

    await mountLibrary(app, navigate, {}, syncState)

    app.querySelector('input[name="viewed-filter"][value="unviewed"]').click()
    await flush()

    expect(app.textContent).toContain('Fresh Position')
    expect(app.textContent).not.toContain('Viewed Position')
    expect(syncState).toHaveBeenCalledWith({
      library: { mode: 'positions', page: 1, tags: [], viewed: 'unviewed' },
      play: { ply: null, side: null },
    }, { replace: false })
  })
})
