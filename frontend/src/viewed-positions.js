import { updatePositionProgress } from './api/progress.js'
import { getCachedSession } from './state/session.js'

const STORAGE_KEY = 'chessterfield:viewed-positions:v1'

export function getViewedPositionIds() {
  return new Set(Object.keys(readViewedPositions()))
}

export function isPositionViewed(positionId) {
  return Object.prototype.hasOwnProperty.call(readViewedPositions(), String(positionId))
}

export function isViewedPositionRecord(position) {
  if (position?.user_state) {
    return Boolean(position.user_state.viewed_at)
  }
  return isPositionViewed(position?.id)
}

export async function markPositionViewed(positionId) {
  const session = getCachedSession()
  if (session.authenticated) {
    try {
      return await updatePositionProgress(positionId, { viewed: true })
    } catch {
      // fall back to local marker below if the authenticated call fails
    }
  }

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
