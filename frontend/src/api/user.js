import { requestJson } from './client.js'

export function fetchMe() {
  return requestJson('/api/me/')
}

export function updateMySettings(payload) {
  return requestJson('/api/me/settings/', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

