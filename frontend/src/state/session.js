import { fetchMe } from '../api/user.js'

let sessionPromise = null
let cachedSession = anonymousSession()

export async function ensureSession({ refresh = false } = {}) {
  if (refresh || !sessionPromise) {
    sessionPromise = fetchMe()
      .then(data => {
        cachedSession = normalizeSession(data)
        return cachedSession
      })
      .catch(() => {
        cachedSession = anonymousSession()
        return cachedSession
      })
  }
  return sessionPromise
}

export function getCachedSession() {
  return cachedSession
}

function normalizeSession(data) {
  return {
    authenticated: Boolean(data?.authenticated),
    user: data?.user || null,
    practiceModes: Array.isArray(data?.practice_modes) ? data.practice_modes : [],
  }
}

function anonymousSession() {
  return {
    authenticated: false,
    user: null,
    practiceModes: [],
  }
}

