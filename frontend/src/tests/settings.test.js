import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetSessionCache } from '../state/session.js'
import { mountSettings } from '../views/settings.js'

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

describe('Settings view', () => {
  let app
  let navigate

  beforeEach(() => {
    resetSessionCache()
    app = makeApp()
    navigate = vi.fn()
  })

  afterEach(() => {
    app.remove()
    window.localStorage.clear()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('stores anonymous settings in local storage', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url === '/api/me/') {
        return makeResponse({ authenticated: false, user: null, practice_modes: [] })
      }
      throw new Error(`Unhandled fetch ${url}`)
    }))

    await mountSettings(app, navigate)

    app.querySelector('select[name="preferred_side"]').value = 'black'
    expect(app.querySelector('select[name="engine_move_speed"]')?.value).toBe('instant')
    app.querySelector('select[name="engine_move_speed"]').value = 'fast'
    app.querySelector('select[name="analysis_visibility"]').value = 'hidden'
    app.querySelector('select[name="default_library_mode"]').value = 'games'
    app.querySelector('#settings-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flush()

    expect(window.localStorage.getItem('chessterfield:preferred-side:v1')).toBe('black')
    expect(window.localStorage.getItem('chessterfield:engine-move-speed:v1')).toBe('fast')
    expect(window.localStorage.getItem('chessterfield:analysis-visibility:v1')).toBe('hidden')
    expect(window.localStorage.getItem('chessterfield:default-library-mode:v1')).toBe('games')
    expect(app.querySelector('#settings-status')?.textContent).toBe('Saved')
  })

  it('loads and saves signed-in settings through the API', async () => {
    const fetchMock = vi.fn((url, options) => {
      if (url === '/api/me/') {
        return makeResponse({
          authenticated: true,
          user: {
            id: 7,
            username: 'player1',
            display_name: 'Player 1',
            settings: {
              preferred_side: 'white',
              analysis_visibility: 'hidden',
              engine_move_speed: 'slow',
              default_library_mode: 'games',
            },
          },
          practice_modes: [],
        })
      }
      if (url === '/api/me/settings/' && options?.method === 'PATCH') {
        return makeResponse({
          settings: JSON.parse(options.body),
        })
      }
      throw new Error(`Unhandled fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await mountSettings(app, navigate)

    expect(app.querySelector('select[name="preferred_side"]')?.value).toBe('white')
    expect(app.querySelector('select[name="engine_move_speed"]')?.value).toBe('slow')
    expect(app.querySelector('select[name="analysis_visibility"]')?.value).toBe('hidden')
    expect(app.querySelector('select[name="default_library_mode"]')?.value).toBe('games')

    app.querySelector('select[name="preferred_side"]').value = 'auto'
    app.querySelector('select[name="engine_move_speed"]').value = 'instant'
    app.querySelector('#settings-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flush()

    const settingsCall = fetchMock.mock.calls.find(([url]) => url === '/api/me/settings/')
    expect(settingsCall).toBeTruthy()
    expect(JSON.parse(settingsCall[1].body)).toEqual({
      preferred_side: 'auto',
      engine_move_speed: 'instant',
      analysis_visibility: 'hidden',
      default_library_mode: 'games',
    })
  })
})
