import './style.css'
import { ensureSession } from './state/session.js'
import { buildUrlFromState, DEFAULT_STATE, mergeState, parseUrlState } from './router.js'
import { mountLibrary } from './views/library.js'
import { mountImport } from './views/import.js'
import { mountPlay } from './views/play.js'
import { mountSettings } from './views/settings.js'

const app = document.getElementById('app')

let state = mergeState(DEFAULT_STATE, parseUrlState())

function navigate(view, itemId = null, partial = {}, options = {}) {
  updateState({
    ...partial,
    view,
    itemId,
  }, { ...options, render: true })
}

function syncState(partial = {}, options = {}) {
  updateState(partial, { ...options, render: false })
}

function updateState(partial, { replace = false, render = true } = {}) {
  const nextState = mergeState(state, partial)
  const nextUrl = buildUrlFromState(nextState)
  const currentUrl = window.location.pathname + window.location.search

  state = nextState
  if (nextUrl !== currentUrl) {
    window.history[replace ? 'replaceState' : 'pushState'](null, '', nextUrl)
  }
  if (render) renderView()
}

function renderView() {
  let p
  switch (state.view) {
    case 'library':
      p = mountLibrary(app, navigate, state.library, syncState)
      break
    case 'import':
      p = mountImport(app, navigate)
      break
    case 'play':
      p = mountPlay(app, navigate, state.itemId, state.play, syncState, state.library)
      break
    case 'settings':
      p = mountSettings(app, navigate)
      break
    default:
      p = mountLibrary(app, navigate, state.library, syncState)
  }
  if (p && typeof p.catch === 'function') {
    p.catch(err => console.error('View mount failed:', err))
  }
}

window.addEventListener('popstate', () => {
  state = mergeState(DEFAULT_STATE, parseUrlState())
  renderView()
})

window.history.replaceState(null, '', buildUrlFromState(state))
ensureSession().catch(() => {})
renderView()
