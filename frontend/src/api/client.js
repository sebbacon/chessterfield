export async function requestJson(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const hasCustomOptions = Object.keys(options).length > 0
  const headers = { ...(options.headers || {}) }

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !headers['X-CSRFToken']) {
    headers['X-CSRFToken'] = getCsrfToken()
  }

  const fetchOptions = {
    ...options,
    method,
    headers,
  }
  if (!hasCustomOptions || (method === 'GET' && !options.body && Object.keys(headers).length === 0)) {
    delete fetchOptions.method
    delete fetchOptions.headers
  }

  const response = Object.keys(fetchOptions).length === 0
    ? await fetch(url)
    : await fetch(url, fetchOptions)

  const data = await parseJson(response)
  if (!response.ok) {
    throw new Error(data?.error || `HTTP ${response.status}`)
  }
  return data
}

async function parseJson(response) {
  if (typeof response.json !== 'function') return null
  try {
    return await response.json()
  } catch {
    return null
  }
}

export function getCsrfToken() {
  return document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('csrftoken='))?.split('=')[1] ?? ''
}
