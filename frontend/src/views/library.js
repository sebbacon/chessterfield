import { fenToMiniBoard } from '../chess/miniboard.js'

export async function mountLibrary(app, navigate) {
  app.innerHTML = `
    <div class="library-layout">
      <aside class="sidebar" id="tag-sidebar">
        <h2>Tags</h2>
        <div id="tag-list">Loading...</div>
      </aside>
      <main class="library-main">
        <div class="library-header">
          <h1>Positions</h1>
          <button id="go-import" class="btn-primary">+ Import Position</button>
        </div>
        <div id="position-grid">Loading...</div>
      </main>
    </div>
  `

  app.querySelector('#go-import').addEventListener('click', () => navigate('import'))

  let allTags = []
  let selectedTags = new Set()

  async function loadTags() {
    try {
      const r = await fetch('/api/tags/')
      allTags = await r.json()
      renderTags()
    } catch {
      showToast('Failed to load tags')
    }
  }

  function renderTags() {
    const container = app.querySelector('#tag-list')
    if (allTags.length === 0) {
      container.innerHTML = '<p class="muted">No tags yet</p>'
      return
    }
    container.innerHTML = allTags.map(t => `
      <label class="tag-filter ${selectedTags.has(t.name) ? 'active' : ''}">
        <input type="checkbox" value="${escapeHtml(t.name)}" ${selectedTags.has(t.name) ? 'checked' : ''}>
        ${escapeHtml(t.name)}
      </label>
    `).join('')

    container.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedTags.add(cb.value)
        else selectedTags.delete(cb.value)
        loadPositions()
      })
    })
  }

  async function loadPositions() {
    const grid = app.querySelector('#position-grid')
    grid.innerHTML = '<p>Loading...</p>'
    try {
      const params = [...selectedTags].map(t => `tag=${encodeURIComponent(t)}`).join('&')
      const url = '/api/positions/' + (params ? `?${params}` : '')
      const r = await fetch(url)
      const positions = await r.json()
      renderPositions(positions)
    } catch {
      showToast('Failed to load positions')
    }
  }

  function renderPositions(positions) {
    const grid = app.querySelector('#position-grid')
    if (positions.length === 0) {
      grid.innerHTML = '<p class="muted">No positions yet. Import one!</p>'
      return
    }
    grid.innerHTML = positions.map(p => `
      <div class="position-card">
        <div class="position-miniboard">${fenToMiniBoard(p.fen)}</div>
        <div class="position-info">
          <h3>${escapeHtml(p.name)}</h3>
          <div class="tags">${p.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
        </div>
        <button class="btn-primary play-btn" data-id="${p.id}">Play</button>
      </div>
    `).join('')

    grid.querySelectorAll('.play-btn').forEach(btn => {
      btn.addEventListener('click', () => navigate('play', parseInt(btn.dataset.id)))
    })
  }

  await Promise.all([loadTags(), loadPositions()])
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function showToast(msg) {
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 4000)
}
