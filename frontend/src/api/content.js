import { requestJson } from './client.js'

export function fetchTags() {
  return requestJson('/api/tags/')
}

export function fetchPositions({ tags = [], page = 1, progress = 'all', sort = 'oldest' } = {}) {
  const params = new URLSearchParams()
  params.set('page', String(page))
  if (progress !== 'all') params.set('progress', progress)
  if (sort !== 'oldest') params.set('sort', sort)
  tags.forEach(tag => params.append('tag', tag))
  return requestJson(`/api/positions/?${params.toString()}`)
}

export function fetchPosition(positionId, { tags = [] } = {}) {
  const params = new URLSearchParams()
  tags.forEach(tag => params.append('tag', tag))
  const query = params.toString()
  return requestJson(`/api/positions/${positionId}/${query ? `?${query}` : ''}`)
}

export function createPosition(payload) {
  return requestJson('/api/positions/', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function fetchGames({ page = 1 } = {}) {
  return requestJson(`/api/games/?page=${page}`)
}

export function fetchGame(gameId) {
  return requestJson(`/api/games/${gameId}/`)
}

