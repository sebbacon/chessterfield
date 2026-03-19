import './style.css'
import { mountLibrary } from './views/library.js'
import { mountImport } from './views/import.js'
import { mountPlay } from './views/play.js'

const app = document.getElementById('app')

// State: { view: 'library'|'import'|'play', positionId: number|null }
let state = { view: 'library', positionId: null }

function navigate(view, positionId = null) {
  state = { view, positionId }
  render()
}

function render() {
  switch (state.view) {
    case 'library':
      mountLibrary(app, navigate)
      break
    case 'import':
      mountImport(app, navigate)
      break
    case 'play':
      mountPlay(app, navigate, state.positionId)
      break
    default:
      mountLibrary(app, navigate)
  }
}

render()
