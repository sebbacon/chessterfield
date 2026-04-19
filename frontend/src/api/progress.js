import { requestJson } from './client.js'

export function updatePositionProgress(positionId, payload) {
  return requestJson(`/api/progress/positions/${positionId}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

