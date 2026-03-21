export const DEFAULT_STATE = {
  view: 'library',
  itemId: null,
  library: {
    mode: 'positions',
    page: 1,
    tags: [],
  },
  play: {
    ply: null,
    side: 'white',
  },
}


export function parseUrlState(search = window.location.search) {
  const params = new URLSearchParams(search)
  const view = ['library', 'import', 'play'].includes(params.get('view')) ? params.get('view') : 'library'

  const mode = params.get('mode') === 'games' ? 'games' : 'positions'
  const page = clampPositiveInt(params.get('page'), 1)
  const tags = (params.get('tags') || '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)

  const item = params.get('item')
  const ply = params.get('ply')
  const side = params.get('side') === 'black' ? 'black' : 'white'

  return {
    view,
    itemId: item ? decodeURIComponent(item) : null,
    library: {
      mode,
      page,
      tags,
    },
    play: {
      ply: ply === null ? null : clampPositiveInt(ply, null),
      side,
    },
  }
}


export function buildUrlFromState(state, base = window.location.pathname) {
  const url = new URL(base, window.location.origin)
  const params = url.searchParams

  if (state.view !== 'library') params.set('view', state.view)

  if (state.view === 'library') {
    if (state.library.mode === 'games') params.set('mode', 'games')
    if (state.library.page > 1) params.set('page', String(state.library.page))
    if (state.library.tags.length > 0) params.set('tags', state.library.tags.join(','))
  }

  if (state.view === 'play' && state.itemId !== null) {
    params.set('item', String(state.itemId))
    if (state.play.ply !== null) params.set('ply', String(state.play.ply))
    if (typeof state.itemId !== 'string' || !state.itemId.startsWith('game:')) {
      if (state.play.side === 'black') params.set('side', 'black')
    }
  }

  return url.pathname + (params.toString() ? `?${params.toString()}` : '')
}


export function mergeState(currentState, partial) {
  return {
    ...currentState,
    ...partial,
    library: {
      ...currentState.library,
      ...(partial.library || {}),
    },
    play: {
      ...currentState.play,
      ...(partial.play || {}),
    },
  }
}


function clampPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}
