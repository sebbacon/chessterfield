import './style.css'
import { mountLibrary } from './views/library.js'
import { mountImport } from './views/import.js'
import { mountPlay } from './views/play.js'

const app = document.getElementById('app')

// State: { view: 'library'|'import'|'play', itemId: number|string|null }
let state = { view: 'library', itemId: null }

function navigate(view, itemId = null) {
  state = { view, itemId }
  render()
}

function render() {
  let p
  switch (state.view) {
    case 'library':
      p = mountLibrary(app, navigate)
      break
    case 'import':
      p = mountImport(app, navigate)
      break
    case 'play':
      p = mountPlay(app, navigate, state.itemId)
      break
    default:
      p = mountLibrary(app, navigate)
  }
  if (p && typeof p.catch === 'function') {
    p.catch(err => console.error('View mount failed:', err))
  }
}

render()
