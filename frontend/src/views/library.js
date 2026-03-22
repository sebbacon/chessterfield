import { fenToMiniBoard } from '../chess/miniboard.js'
import { getViewedPositionIds } from '../viewed-positions.js'

export async function mountLibrary(app, navigate, initialState = {}, syncState = () => {}) {
  app.innerHTML = `
    <div class="library-layout">
      <div class="library-sidebar-backdrop" id="library-sidebar-backdrop" hidden></div>
      <aside class="sidebar library-sidebar" id="library-sidebar">
        <div class="library-sidebar-header">
          <h2>Browse & Filters</h2>
          <button id="library-nav-close" class="btn-secondary library-nav-close" type="button" aria-label="Close browse and filters">Close</button>
        </div>
        <div class="sidebar-section">
          <h2>Browse</h2>
          <div class="browse-toggle">
            <button id="show-positions" class="browse-btn active" type="button">Positions</button>
            <button id="show-games" class="browse-btn" type="button">Games</button>
          </div>
        </div>
        <div class="sidebar-section" id="viewed-section">
          <h2>Viewed</h2>
          <div id="viewed-filter-list"></div>
        </div>
        <div class="sidebar-section" id="tag-section">
          <h2>Tags</h2>
          <div id="tag-list">Loading...</div>
        </div>
      </aside>
      <main class="library-main">
        <div class="library-header">
          <div class="library-header-main">
            <button
              id="library-nav-toggle"
              class="btn-secondary nav-toggle"
              type="button"
              aria-controls="library-sidebar"
              aria-expanded="false"
            >
              Browse & Filters
            </button>
            <h1 id="library-title">Positions</h1>
          </div>
          <button id="go-import" class="btn-primary">+ Import Position</button>
        </div>
        <div id="library-grid">Loading...</div>
      </main>
    </div>
  `

  app.querySelector('#go-import').addEventListener('click', () => navigate('import'))

  const pages = {
    positions: { current: initialState.mode === 'positions' ? (initialState.page || 1) : 1, total: 1 },
    games: { current: initialState.mode === 'games' ? (initialState.page || 1) : 1, total: 1 },
  }
  let allTags = []
  let mode = initialState.mode === 'games' ? 'games' : 'positions'
  let selectedTags = new Set(initialState.tags || [])
  let viewedFilter = normalizeViewedFilter(initialState.viewed)
  let viewedPositionIds = getViewedPositionIds()
  let requestSeq = 0
  let isSidebarOpen = false
  const mobileQuery = getMobileQuery()
  const navToggle = app.querySelector('#library-nav-toggle')
  const navClose = app.querySelector('#library-nav-close')
  const sidebar = app.querySelector('#library-sidebar')
  const sidebarBackdrop = app.querySelector('#library-sidebar-backdrop')

  app.querySelector('#show-positions').addEventListener('click', () => switchMode('positions'))
  app.querySelector('#show-games').addEventListener('click', () => switchMode('games'))
  navToggle.addEventListener('click', () => {
    isSidebarOpen = !isSidebarOpen
    applySidebarState()
  })
  navClose.addEventListener('click', () => {
    isSidebarOpen = false
    applySidebarState()
  })
  sidebarBackdrop.addEventListener('click', () => {
    isSidebarOpen = false
    applySidebarState()
  })
  mobileQuery.addEventListener('change', () => {
    isSidebarOpen = !mobileQuery.matches
    applySidebarState()
  })

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
    syncLibraryState()
    maybeCloseSidebar()
    loadCurrent(true)
  }

  function updateModeUi() {
    const positionsBtn = app.querySelector('#show-positions')
    const gamesBtn = app.querySelector('#show-games')
    const title = app.querySelector('#library-title')
    const importBtn = app.querySelector('#go-import')
    const viewedSection = app.querySelector('#viewed-section')
    const tagSection = app.querySelector('#tag-section')

    positionsBtn.classList.toggle('active', mode === 'positions')
    gamesBtn.classList.toggle('active', mode === 'games')
    title.textContent = mode === 'positions' ? 'Positions' : 'Games'
    importBtn.hidden = mode !== 'positions'
    viewedSection.hidden = mode !== 'positions'
    tagSection.hidden = mode !== 'positions'
  }

  function renderViewedFilters() {
    const container = app.querySelector('#viewed-filter-list')
    const options = [
      ['all', 'All positions'],
      ['viewed', 'Viewed'],
      ['unviewed', 'Not viewed'],
    ]
    container.innerHTML = options.map(([value, label]) => `
      <label class="viewed-filter-option ${viewedFilter === value ? 'active' : ''}">
        <input type="radio" name="viewed-filter" value="${value}" ${viewedFilter === value ? 'checked' : ''}>
        ${label}
      </label>
    `).join('')

    container.querySelectorAll('input[name=viewed-filter]').forEach(input => {
      input.addEventListener('change', () => {
        viewedFilter = normalizeViewedFilter(input.value)
        pages.positions.current = 1
        pages.positions.total = 1
        syncLibraryState()
        maybeCloseSidebar()
        if (mode === 'positions') loadPositions(true)
        renderViewedFilters()
      })
    })
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
        syncLibraryState()
        maybeCloseSidebar()
        if (mode === 'positions') loadPositions(true)
        renderTags()
      })
    })
  }

  function applySidebarState() {
    const isMobile = mobileQuery.matches
    const expanded = isMobile ? isSidebarOpen : true
    navToggle.setAttribute('aria-expanded', String(expanded))
    sidebar.classList.toggle('mobile-open', isMobile && isSidebarOpen)
    sidebarBackdrop.hidden = !(isMobile && isSidebarOpen)
  }

  function maybeCloseSidebar() {
    if (!mobileQuery.matches) return
    isSidebarOpen = false
    applySidebarState()
  }

  function loadCurrent(replace = true) {
    return mode === 'positions' ? loadPositions(replace) : loadGames(replace)
  }

  async function loadPositions(replace = true) {
    const seq = ++requestSeq
    const requestedMode = mode
    viewedPositionIds = getViewedPositionIds()
    const grid = app.querySelector('#library-grid')
    if (replace) grid.innerHTML = '<p>Loading...</p>'
    try {
      const data = viewedFilter === 'all'
        ? await fetchPositionPage([...selectedTags], pages.positions.current)
        : await fetchAllPositionPages([...selectedTags])
      if (seq !== requestSeq || requestedMode !== mode) return
      if (viewedFilter === 'all') {
        pages.positions.total = data.total_pages
        if (replace) renderPositions(data.results)
        else appendCards(data.results, positionCardHtml)
        return
      }

      const filtered = data.results.filter(position => matchesViewedFilter(position.id, viewedFilter, viewedPositionIds))
      pages.positions.current = 1
      pages.positions.total = 1
      renderPositions(filtered)
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
    const viewed = viewedPositionIds.has(String(p.id))
    return `
      <div class="position-card">
        <div class="position-miniboard">
          <span
            class="position-status-indicator ${viewed ? 'viewed' : 'unviewed'}"
            role="img"
            aria-label="${viewed ? 'Viewed on this device' : 'Not viewed on this device'}"
            title="${viewed ? 'Viewed on this device' : 'Not viewed on this device'}"
          ></span>
          ${fenToMiniBoard(p.fen)}
        </div>
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
        <button class="btn-secondary open-game-btn" data-id="${game.id}">Open at End</button>
      </div>
    `
  }

  function bindPlayButtons(container) {
    container.querySelectorAll('.play-btn').forEach(btn => {
      btn.addEventListener('click', () => navigate('play', parseInt(btn.dataset.id), {
        play: { ply: 0, side: 'white' },
      }))
    })
  }

  function bindOpenGameButtons(container) {
    container.querySelectorAll('.open-game-btn').forEach(btn => {
      btn.addEventListener('click', () => navigate('play', `game:${btn.dataset.id}`, {
        play: { ply: null, side: 'white' },
      }))
    })
  }

  function renderPositions(positions) {
    const grid = app.querySelector('#library-grid')
    if (positions.length === 0) {
      grid.innerHTML = `<p class="muted">${emptyPositionsMessage(viewedFilter)}</p>`
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
    bindOpenGameButtons(grid)
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
    bindOpenGameButtons(grid)
    bindLoadMore(grid)
  }

  function loadMoreHtml() {
    if (mode === 'positions' && viewedFilter !== 'all') return ''
    if (pages[mode].current >= pages[mode].total) return ''
    return '<div class="load-more-row"><button id="load-more-btn" class="btn-secondary">Load more</button></div>'
  }

  function bindLoadMore(grid) {
    const btn = grid.querySelector('#load-more-btn')
    if (!btn) return
    btn.addEventListener('click', () => {
      pages[mode].current++
      syncLibraryState()
      loadCurrent(false)
    })
  }

  function syncLibraryState(replace = false) {
    syncState({
      library: {
        mode,
        page: mode === 'positions' && viewedFilter !== 'all' ? 1 : pages[mode].current,
        tags: [...selectedTags].sort(),
        viewed: viewedFilter,
      },
      play: {
        ply: null,
        side: 'white',
      },
    }, { replace })
  }

  updateModeUi()
  renderViewedFilters()
  isSidebarOpen = !mobileQuery.matches
  applySidebarState()
  syncLibraryState(true)
  await Promise.all([loadTags(), loadCurrent()])
}

function normalizeViewedFilter(value) {
  return value === 'viewed' || value === 'unviewed' ? value : 'all'
}

async function fetchPositionPage(tags, page) {
  const params = buildPositionParams(tags, page)
  const r = await fetch('/api/positions/?' + params.toString())
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

async function fetchAllPositionPages(tags) {
  const firstPage = await fetchPositionPage(tags, 1)
  const results = [...firstPage.results]
  for (let page = 2; page <= firstPage.total_pages; page += 1) {
    const nextPage = await fetchPositionPage(tags, page)
    results.push(...nextPage.results)
  }
  return {
    ...firstPage,
    page: 1,
    total_pages: 1,
    count: results.length,
    results,
  }
}

function buildPositionParams(tags, page) {
  const params = new URLSearchParams()
  params.set('page', String(page))
  tags.forEach(tag => params.append('tag', tag))
  return params
}

function matchesViewedFilter(positionId, viewedFilter, viewedIds) {
  const viewed = viewedIds.has(String(positionId))
  return viewedFilter === 'viewed' ? viewed : !viewed
}

function emptyPositionsMessage(viewedFilter) {
  if (viewedFilter === 'viewed') {
    return 'No viewed positions match these filters yet.'
  }
  if (viewedFilter === 'unviewed') {
    return 'No unviewed positions match these filters.'
  }
  return 'No positions yet. Import one!'
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

function getMobileQuery() {
  if (typeof window.matchMedia === 'function') return window.matchMedia('(max-width: 860px)')
  return {
    matches: false,
    addEventListener() {},
  }
}
