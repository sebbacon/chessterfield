import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountImport } from '../views/import.js'

function makeApp() {
  const div = document.createElement('div')
  document.body.appendChild(div)
  return div
}

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

describe('Import view', () => {
  let app
  let navigate

  beforeEach(() => {
    app = makeApp()
    navigate = vi.fn()
    vi.stubGlobal('fetch', vi.fn((url, options) => {
      if (url === '/api/tags/') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      }
      if (url === '/api/positions/') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 1, name: 'Imported', fen: STARTING_FEN, tags: [] }) })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      value: 'csrftoken=test-token',
    })
  })

  afterEach(() => {
    app.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('submits a typed tag even if Enter was not pressed', async () => {
    await mountImport(app, navigate)

    app.querySelector('#fen-input').value = STARTING_FEN
    app.querySelector('#name-input').value = 'Stage 3 import'
    app.querySelector('#tag-input').value = 'stage3'

    app.querySelector('#import-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await new Promise(resolve => setTimeout(resolve, 0))

    const postCall = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/positions/')
    expect(postCall).toBeTruthy()
    const [, options] = postCall
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({
      name: 'Stage 3 import',
      fen: STARTING_FEN,
      notes: '',
      tags: ['stage3'],
    })
    expect(navigate).toHaveBeenCalledWith('browse')
  })
})
