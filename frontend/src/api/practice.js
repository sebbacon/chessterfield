import { requestJson } from './client.js'

export function createPracticeAttempt(payload) {
  return requestJson('/api/practice/attempts/', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function finishPracticeAttempt(attemptId, payload) {
  return requestJson(`/api/practice/attempts/${attemptId}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

