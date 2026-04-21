export const DEFAULT_STATE = {
  view: 'workout',
  itemId: null,
  library: {
    mode: 'positions',
    page: 1,
    tags: [],
    viewed: 'all',
  },
  workout: {
    tactic: 'all',
  },
  play: {
    ply: null,
    side: null,
    from: 'browse',
  },
}


const TAG_PATH_PREFIX = '/tags/'


export function parseUrlState(pathname = window.location.pathname, search = window.location.search) {
  if (pathname.startsWith('?')) {
    search = pathname
    pathname = '/'
  }

  const params = new URLSearchParams(search)
  const explicitView = params.get('view')
  const legacyOrSupportedView = explicitView === 'library'
    ? 'browse'
    : ['browse', 'workout', 'import', 'play', 'settings'].includes(explicitView)
      ? explicitView
      : null
  const inferredBrowse = pathname.startsWith(TAG_PATH_PREFIX)
    || params.has('mode')
    || params.has('page')
    || params.has('progress')
    || params.has('viewed')
    || params.has('tags')
  const view = legacyOrSupportedView || (inferredBrowse ? 'browse' : 'workout')

  const mode = params.get('mode') === 'games' ? 'games' : 'positions'
  const page = clampPositiveInt(params.get('page'), 1)
  const viewed = normalizeViewedFilter(params.get('progress') || params.get('viewed'))
  const queryTags = (params.get('tags') || '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
  const pathTags = parseTagPath(pathname)
  const tags = pathTags.length > 0 ? pathTags : queryTags

  const item = params.get('item')
  const ply = params.get('ply')
  const side = normalizePlaySide(params.get('side'))
  const from = normalizePlayOrigin(params.get('from'))
  const tactic = normalizeWorkoutTactic(params.get('tactic'))

  return {
    view,
    itemId: item ? decodeURIComponent(item) : null,
    library: {
      mode,
      page,
      tags,
      viewed,
    },
    workout: {
      tactic,
    },
    play: {
      ply: ply === null ? null : clampPositiveInt(ply, null),
      side,
      from,
    },
  }
}


export function buildUrlFromState(state) {
  const url = new URL(buildBasePath(state), window.location.origin)
  const params = url.searchParams

  if (state.view !== 'workout') params.set('view', state.view)

  if (state.view === 'browse') {
    if (state.library.mode === 'games') params.set('mode', 'games')
    if (state.library.page > 1) params.set('page', String(state.library.page))
    if (state.library.mode === 'positions' && state.library.viewed !== 'all') {
      params.set('progress', state.library.viewed)
    }
    if (state.library.mode !== 'positions' && state.library.tags.length > 0) {
      params.set('tags', state.library.tags.join(','))
    }
  }

  if (state.view === 'workout' && state.workout.tactic !== 'all') {
    params.set('tactic', state.workout.tactic)
  }

  if (state.view === 'play' && state.itemId !== null) {
    params.set('item', String(state.itemId))
    if (state.play.ply !== null) params.set('ply', String(state.play.ply))
    if (state.play.from === 'workout') {
      params.set('from', 'workout')
      if (state.workout.tactic !== 'all') params.set('tactic', state.workout.tactic)
    }
    if (typeof state.itemId !== 'string' || !state.itemId.startsWith('game:')) {
      if (state.play.side === 'black' || state.play.side === 'white') params.set('side', state.play.side)
    }
  }

  return url.pathname + (params.toString() ? `?${params.toString()}` : '')
}


function buildBasePath(state) {
  if (state.view === 'browse' && state.library.mode === 'positions' && state.library.tags.length > 0) {
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
    workout: {
      ...currentState.workout,
      ...(partial.workout || {}),
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
  return PROGRESS_FILTER_VALUES.has(value) ? value : 'all'
}


const PROGRESS_FILTER_VALUES = new Set([
  'all',
  'not_started',
  'in_progress',
  'revision',
  'mastered',
  'viewed',
  'unviewed',
])

function normalizePlaySide(value) {
  return value === 'white' || value === 'black' ? value : null
}

function normalizePlayOrigin(value) {
  return value === 'workout' ? 'workout' : 'browse'
}

function normalizeWorkoutTactic(value) {
  const normalized = String(value || '').trim()
  return normalized ? normalized : 'all'
}
