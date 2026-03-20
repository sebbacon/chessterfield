import { fenToMiniBoard } from '../chess/miniboard.js'

export async function mountLibrary(app, navigate) {
  app.innerHTML = `
    <div class="library-layout">
      <aside class="sidebar">
        <div class="sidebar-section">
          <h2>Browse</h2>
          <div class="browse-toggle">
            <button id="show-positions" class="browse-btn active" type="button">Positions</button>
            <button id="show-games" class="browse-btn" type="button">Games</button>
          </div>
        </div>
        <div class="sidebar-section" id="tag-section">
          <h2>Tags</h2>
          <div id="tag-list">Loading...</div>
        </div>
      </aside>
      <main class="library-main">
        <div class="library-header">
          <h1 id="library-title">Positions</h1>
          <button id="go-import" class="btn-primary">+ Import Position</button>
        </div>
        <div id="library-grid">Loading...</div>
      </main>
    </div>
  `

  app.querySelector('#go-import').addEventListener('click', () => navigate('import'))

  const pages = {
    positions: { current: 1, total: 1 },
    games: { current: 1, total: 1 },
  }
  let allTags = []
  let mode = 'positions'
  let selectedTags = new Set()
  let requestSeq = 0

  app.querySelector('#show-positions').addEventListener('click', () => switchMode('positions'))
  app.querySelector('#show-games').addEventListener('click', () => switchMode('games'))

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

  function switchMode(nextMode) {
    if (mode === nextMode) return
    mode = nextMode
    pages[mode].current = 1
    updateModeUi()
    loadCurrent(true)
  }

  function updateModeUi() {
    const positionsBtn = app.querySelector('#show-positions')
    const gamesBtn = app.querySelector('#show-games')
    const title = app.querySelector('#library-title')
    const importBtn = app.querySelector('#go-import')
    const tagSection = app.querySelector('#tag-section')

    positionsBtn.classList.toggle('active', mode === 'positions')
    gamesBtn.classList.toggle('active', mode === 'games')
    title.textContent = mode === 'positions' ? 'Positions' : 'Games'
    importBtn.hidden = mode !== 'positions'
    tagSection.hidden = mode !== 'positions'
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
        pages.positions.current = 1
        if (mode === 'positions') loadPositions(true)
        renderTags()
      })
    })
  }

  function loadCurrent(replace = true) {
    return mode === 'positions' ? loadPositions(replace) : loadGames(replace)
  }

  async function loadPositions(replace = true) {
    const seq = ++requestSeq
    const requestedMode = mode
    const grid = app.querySelector('#library-grid')
    if (replace) grid.innerHTML = '<p>Loading...</p>'
    try {
      const params = [...selectedTags].map(t => `tag=${encodeURIComponent(t)}`)
      params.push(`page=${pages.positions.current}`)
      const r = await fetch('/api/positions/?' + params.join('&'))
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      if (seq !== requestSeq || requestedMode !== mode) return
      pages.positions.total = data.total_pages
      if (replace) renderPositions(data.results)
      else appendCards(data.results, positionCardHtml)
    } catch {
      if (seq === requestSeq && requestedMode === mode) showToast('Failed to load positions')
    }
  }

  async function loadGames(replace = true) {
    const seq = ++requestSeq
    const requestedMode = mode
    const grid = app.querySelector('#library-grid')
    if (replace) grid.innerHTML = '<p>Loading...</p>'
    try {
      const r = await fetch(`/api/games/?page=${pages.games.current}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      if (seq !== requestSeq || requestedMode !== mode) return
      pages.games.total = data.total_pages
      if (replace) renderGames(data.results)
      else appendCards(data.results, gameCardHtml)
    } catch {
      if (seq === requestSeq && requestedMode === mode) showToast('Failed to load games')
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

  function gameCardHtml(game) {
    return `
      <div class="position-card game-card">
        <div class="position-miniboard">${fenToMiniBoard(game.fen)}</div>
        <div class="position-info">
          <div class="game-result ${gameOutcomeClass(game)}">${escapeHtml(game.result_label)}</div>
          <h3>${escapeHtml(game.name)}</h3>
          <p class="game-meta">Played as ${escapeHtml(capitalize(game.user_color))}</p>
          <p class="game-meta">${escapeHtml(game.winner_label)}</p>
        </div>
      </div>
    `
  }

  function bindPlayButtons(container) {
    container.querySelectorAll('.play-btn').forEach(btn => {
      btn.addEventListener('click', () => navigate('play', parseInt(btn.dataset.id)))
    })
  }

  function renderPositions(positions) {
    const grid = app.querySelector('#library-grid')
    if (positions.length === 0) {
      grid.innerHTML = '<p class="muted">No positions yet. Import one!</p>'
      return
    }
    grid.innerHTML = positions.map(positionCardHtml).join('') + loadMoreHtml()
    bindPlayButtons(grid)
    bindLoadMore(grid)
  }

  function renderGames(games) {
    const grid = app.querySelector('#library-grid')
    if (games.length === 0) {
      grid.innerHTML = '<p class="muted">No games yet. Re-run the Lichess importer to build game summaries.</p>'
      return
    }
    grid.innerHTML = games.map(gameCardHtml).join('') + loadMoreHtml()
    bindLoadMore(grid)
  }

  function appendCards(items, renderCard) {
    const grid = app.querySelector('#library-grid')
    const oldBtn = grid.querySelector('#load-more-btn')
    if (oldBtn) oldBtn.parentElement.remove()
    const frag = document.createDocumentFragment()
    const wrapper = document.createElement('div')
    wrapper.innerHTML = items.map(renderCard).join('') + loadMoreHtml()
    while (wrapper.firstChild) frag.appendChild(wrapper.firstChild)
    grid.appendChild(frag)
    bindPlayButtons(grid)
    bindLoadMore(grid)
  }

  function loadMoreHtml() {
    if (pages[mode].current >= pages[mode].total) return ''
    return '<div class="load-more-row"><button id="load-more-btn" class="btn-secondary">Load more</button></div>'
  }

  function bindLoadMore(grid) {
    const btn = grid.querySelector('#load-more-btn')
    if (!btn) return
    btn.addEventListener('click', () => {
      pages[mode].current++
      loadCurrent(false)
    })
  }

  updateModeUi()
  await Promise.all([loadTags(), loadCurrent()])
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function gameOutcomeClass(game) {
  if (game.winner === 'draw') return 'draw'
  if (!game.winner) return 'unknown'
  return game.winner === game.user_color ? 'win' : 'loss'
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function showToast(msg) {
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 4000)
}
