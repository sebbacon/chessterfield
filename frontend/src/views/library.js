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
  let positionRequestSeq = 0
  let currentPage = 1
  let totalPages = 1

  async function loadTags() {
    try {
      const r = await fetch('/api/tags/')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
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
        currentPage = 1
        loadPositions(true)
      })
    })
  }

  async function loadPositions(replace = true) {
    const seq = ++positionRequestSeq
    const grid = app.querySelector('#position-grid')
    if (replace) grid.innerHTML = '<p>Loading...</p>'
    try {
      const params = [...selectedTags].map(t => `tag=${encodeURIComponent(t)}`)
      params.push(`page=${currentPage}`)
      const url = '/api/positions/?' + params.join('&')
      const r = await fetch(url)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      if (seq !== positionRequestSeq) return
      totalPages = data.total_pages
      if (replace) {
        renderPositions(data.results, data.count)
      } else {
        appendPositions(data.results)
      }
    } catch {
      if (seq === positionRequestSeq) showToast('Failed to load positions')
    }
  }

  function positionCardHtml(p) {
    return `
      <div class="position-card">
        <div class="position-miniboard">${fenToMiniBoard(p.fen)}</div>
        <div class="position-info">
          <h3>${escapeHtml(p.name)}</h3>
          <div class="tags">${p.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
        </div>
        <button class="btn-primary play-btn" data-id="${p.id}">Play</button>
      </div>
    `
  }

  function bindPlayButtons(container) {
    container.querySelectorAll('.play-btn').forEach(btn => {
      btn.addEventListener('click', () => navigate('play', parseInt(btn.dataset.id)))
    })
  }

  function renderPositions(positions, count) {
    const grid = app.querySelector('#position-grid')
    if (positions.length === 0) {
      grid.innerHTML = '<p class="muted">No positions yet. Import one!</p>'
      return
    }
    grid.innerHTML = positions.map(positionCardHtml).join('') + loadMoreHtml(count)
    bindPlayButtons(grid)
    bindLoadMore(grid)
  }

  function appendPositions(positions) {
    const grid = app.querySelector('#position-grid')
    const oldBtn = grid.querySelector('#load-more-btn')
    if (oldBtn) oldBtn.parentElement.remove()
    const frag = document.createDocumentFragment()
    const wrapper = document.createElement('div')
    wrapper.innerHTML = positions.map(positionCardHtml).join('') + loadMoreHtml()
    while (wrapper.firstChild) frag.appendChild(wrapper.firstChild)
    grid.appendChild(frag)
    bindPlayButtons(grid)
    bindLoadMore(grid)
  }

  function loadMoreHtml() {
    if (currentPage >= totalPages) return ''
    return `<div class="load-more-row"><button id="load-more-btn" class="btn-secondary">Load more</button></div>`
  }

  function bindLoadMore(grid) {
    const btn = grid.querySelector('#load-more-btn')
    if (!btn) return
    btn.addEventListener('click', () => {
      currentPage++
      loadPositions(false)
    })
  }

  await Promise.all([loadTags(), loadPositions()])
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function showToast(msg) {
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 4000)
}
