import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetSessionCache } from '../state/session.js'
import { mountWorkout } from '../views/workout.js'


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


describe('Workout view', () => {
  let app
  let navigate

  beforeEach(() => {
    resetSessionCache()
    app = makeApp()
    navigate = vi.fn()
  })

  afterEach(() => {
    app.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('lists tactic tags and starts a signed-in workout with workout ordering', async () => {
    const fetchMock = vi.fn(url => {
      if (url === '/api/me/') {
        return makeResponse({
          authenticated: true,
          user: { display_name: 'Player One' },
          practice_modes: [],
        })
      }
      if (url === '/api/tags/') {
        return makeResponse([
          { id: 1, name: 'tactic:fork' },
          { id: 2, name: 'opening' },
          { id: 3, name: 'tactic:pin' },
        ])
      }
      if (url === '/api/positions/?page=1&sort=workout&tactic=tactic%3Afork') {
        return makeResponse({
          results: [{ id: 17, name: 'Fork Drill' }],
          count: 1,
          page: 1,
          total_pages: 1,
        })
      }
      throw new Error(`Unhandled fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await mountWorkout(app, navigate, { tactic: 'tactic:fork' })

    expect(app.textContent).toContain('All tactics')
    expect(app.textContent).toContain('fork')
    expect(app.textContent).toContain('pin')
    expect(app.querySelector('.workout-tactic-btn.active')?.textContent).toContain('fork')

    app.querySelector('[data-tactic="tactic:fork"]')?.click()
    await flush()

    expect(navigate).toHaveBeenCalledWith('play', 17, {
      workout: { tactic: 'tactic:fork' },
      play: { ply: 0, side: null, from: 'workout' },
    })
  })

  it('starts the all-tactics workout for anonymous users', async () => {
    const fetchMock = vi.fn(url => {
      if (url === '/api/me/') {
        return makeResponse({
          authenticated: false,
          user: null,
          practice_modes: [],
        })
      }
      if (url === '/api/tags/') {
        return makeResponse([{ id: 1, name: 'tactic:fork' }])
      }
      if (url === '/api/positions/?page=1&tactic=all') {
        return makeResponse({
          results: [{ id: 8, name: 'Anonymous Workout' }],
          count: 1,
          page: 1,
          total_pages: 1,
        })
      }
      throw new Error(`Unhandled fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await mountWorkout(app, navigate, {})

    app.querySelector('[data-tactic="all"]')?.click()
    await flush()

    expect(navigate).toHaveBeenCalledWith('play', 8, {
      workout: { tactic: 'all' },
      play: { ply: 0, side: null, from: 'workout' },
    })
  })
})
