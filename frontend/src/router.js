export const DEFAULT_STATE = {
  view: 'library',
  itemId: null,
  library: {
    mode: 'positions',
    page: 1,
    tags: [],
    viewed: 'all',
  },
  play: {
    ply: null,
    side: null,
  },
}


const TAG_PATH_PREFIX = '/tags/'


export function parseUrlState(pathname = window.location.pathname, search = window.location.search) {
  if (pathname.startsWith('?')) {
    search = pathname
    pathname = '/'
  }

  const params = new URLSearchParams(search)
  const view = ['library', 'import', 'play'].includes(params.get('view')) ? params.get('view') : 'library'

  const mode = params.get('mode') === 'games' ? 'games' : 'positions'
  const page = clampPositiveInt(params.get('page'), 1)
  const viewed = normalizeViewedFilter(params.get('viewed'))
  const queryTags = (params.get('tags') || '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
  const pathTags = parseTagPath(pathname)
  const tags = pathTags.length > 0 ? pathTags : queryTags

  const item = params.get('item')
  const ply = params.get('ply')
  const side = normalizePlaySide(params.get('side'))

  return {
    view,
    itemId: item ? decodeURIComponent(item) : null,
    library: {
      mode,
      page,
      tags,
      viewed,
    },
    play: {
      ply: ply === null ? null : clampPositiveInt(ply, null),
      side,
    },
  }
}


export function buildUrlFromState(state) {
  const url = new URL(buildBasePath(state), window.location.origin)
  const params = url.searchParams

  if (state.view !== 'library') params.set('view', state.view)

  if (state.view === 'library') {
    if (state.library.mode === 'games') params.set('mode', 'games')
    if (state.library.page > 1) params.set('page', String(state.library.page))
    if (state.library.mode === 'positions' && state.library.viewed !== 'all') {
      params.set('viewed', state.library.viewed)
    }
    if (state.library.mode !== 'positions' && state.library.tags.length > 0) {
      params.set('tags', state.library.tags.join(','))
    }
  }

  if (state.view === 'play' && state.itemId !== null) {
    params.set('item', String(state.itemId))
    if (state.play.ply !== null) params.set('ply', String(state.play.ply))
    if (typeof state.itemId !== 'string' || !state.itemId.startsWith('game:')) {
      if (state.play.side === 'black' || state.play.side === 'white') params.set('side', state.play.side)
    }
  }

  return url.pathname + (params.toString() ? `?${params.toString()}` : '')
}


function buildBasePath(state) {
  if (state.view === 'library' && state.library.mode === 'positions' && state.library.tags.length > 0) {
    return `${TAG_PATH_PREFIX}${encodeTagPath(state.library.tags)}/`
  }
  return '/'
}


function parseTagPath(pathname) {
  if (!pathname.startsWith(TAG_PATH_PREFIX)) return []
  const raw = pathname.slice(TAG_PATH_PREFIX.length).replace(/\/$/, '')
  if (!raw) return []
  return raw.split('+').map(part => decodeURIComponent(part)).filter(Boolean)
}


function encodeTagPath(tags) {
  return [...tags]
    .map(tag => tag.trim())
    .filter(Boolean)
    .sort()
    .map(tag => encodeURIComponent(tag))
    .join('+')
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

function normalizeViewedFilter(value) {
  return value === 'viewed' || value === 'unviewed' ? value : 'all'
}

function normalizePlaySide(value) {
  return value === 'white' || value === 'black' ? value : null
}
