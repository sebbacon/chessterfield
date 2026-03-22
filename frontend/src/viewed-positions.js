const STORAGE_KEY = 'chessterfield:viewed-positions:v1'

export function getViewedPositionIds() {
  return new Set(Object.keys(readViewedPositions()))
}

export function isPositionViewed(positionId) {
  return Object.prototype.hasOwnProperty.call(readViewedPositions(), String(positionId))
}

export function markPositionViewed(positionId) {
  const key = String(positionId)
  const viewedPositions = readViewedPositions()
  const alreadyViewed = Object.prototype.hasOwnProperty.call(viewedPositions, key)
  if (!alreadyViewed) {
    viewedPositions[key] = new Date().toISOString()
    writeViewedPositions(viewedPositions)
  }
  return {
    alreadyViewed,
    viewedAt: viewedPositions[key],
  }
}

function readViewedPositions() {
  if (!hasLocalStorage()) return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed
  } catch {
    return {}
  }
}

function writeViewedPositions(viewedPositions) {
  if (!hasLocalStorage()) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(viewedPositions))
}

function hasLocalStorage() {
  return typeof window !== 'undefined' && window.localStorage
}
