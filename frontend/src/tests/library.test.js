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

  beforeEach(() => {
    app = makeApp()
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
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('switches from positions to games', async () => {
    await mountLibrary(app, vi.fn())
    expect(app.querySelector('h1').textContent).toBe('Positions')
    expect(app.textContent).toContain('Starting Position')

    app.querySelector('#show-games').click()
    await flush()

    expect(app.querySelector('h1').textContent).toBe('Games')
    expect(app.textContent).toContain('vs opponent (2026-03-20)')
    expect(app.textContent).toContain('You won')
  })
})
