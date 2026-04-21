import { fetchPositions, fetchTags } from '../api/content.js'
import { ensureSession } from '../state/session.js'

export async function mountWorkout(app, navigate, initialState = {}) {
  const session = await ensureSession()
  const selectedTactic = normalizeWorkoutTactic(initialState.tactic)

  app.innerHTML = `
    <div class="workout-layout">
      <div class="workout-card">
        <div class="workout-header">
          <div class="section-switcher">
            <button id="go-workout" class="btn-secondary section-switcher-btn active" type="button" aria-current="page">Workout</button>
            <button id="go-browse" class="btn-secondary section-switcher-btn" type="button">Browse</button>
          </div>
          <div class="workout-header-main">
            <div>
              <h1>Workout</h1>
              <p class="workout-subtitle">Choose a tactic to run a focused queue of positions.</p>
            </div>
            <div class="workout-header-actions">
              <div class="account-pill">${accountLabel(session)}</div>
              <button id="go-settings" class="btn-secondary" type="button">Settings</button>
            </div>
          </div>
        </div>

        <div class="workout-notice">
          ${session.authenticated
            ? 'Workout order is: not started, in progress, then revision. More recently tried positions appear later within each group.'
            : 'Sign in to order workouts by your progress. Anonymous workouts use saved tactic positions in their existing order.'}
        </div>

        <section class="workout-section">
          <div class="workout-section-header">
            <h2>Tactics</h2>
            <p>Select one to start immediately.</p>
          </div>
          <div id="workout-tactic-list" class="workout-tactic-list">Loading tactics...</div>
          <p id="workout-status" class="workout-status" aria-live="polite"></p>
        </section>
      </div>
    </div>
  `

  app.querySelector('#go-workout').addEventListener('click', () => {})
  app.querySelector('#go-browse').addEventListener('click', () => navigate('browse'))
  app.querySelector('#go-settings').addEventListener('click', () => navigate('settings'))

  try {
    const tags = await fetchTags()
    const tactics = tags
      .map(tag => tag.name)
      .filter(name => name.startsWith('tactic:'))
      .sort((left, right) => formatTacticLabel(left).localeCompare(formatTacticLabel(right)))
    renderTactics(tactics)
  } catch {
    app.querySelector('#workout-tactic-list').innerHTML = '<p class="muted">Could not load tactics.</p>'
  }

  function renderTactics(tactics) {
    const list = app.querySelector('#workout-tactic-list')
    if (tactics.length === 0) {
      list.innerHTML = '<p class="muted">No tactic tags are available yet.</p>'
      return
    }

    const options = ['all', ...tactics]
    list.innerHTML = options.map(tactic => `
      <button
        class="workout-tactic-btn ${selectedTactic === tactic ? 'active' : ''}"
        type="button"
        data-tactic="${escapeHtml(tactic)}"
      >
        ${escapeHtml(tactic === 'all' ? 'All tactics' : formatTacticLabel(tactic))}
      </button>
    `).join('')

    list.querySelectorAll('.workout-tactic-btn').forEach(button => {
      button.addEventListener('click', async () => {
        const tactic = normalizeWorkoutTactic(button.dataset.tactic)
        app.querySelector('#workout-status').textContent = 'Loading positions...'
        try {
          const data = await fetchPositions({
            page: 1,
            sort: session.authenticated ? 'workout' : 'oldest',
            tactic,
          })
          if (!data.results.length) {
            app.querySelector('#workout-status').textContent = 'No positions match that tactic yet.'
            return
          }
          app.querySelector('#workout-status').textContent = ''
          navigate('play', data.results[0].id, {
            workout: { tactic },
            play: { ply: 0, side: null, from: 'workout' },
          })
        } catch {
          app.querySelector('#workout-status').textContent = 'Could not load that workout.'
        }
      })
    })
  }
}

function normalizeWorkoutTactic(value) {
  return String(value || '').trim() || 'all'
}

function formatTacticLabel(tagName) {
  return tagName.replace(/^tactic:/, '')
}

function accountLabel(session) {
  if (session.authenticated) {
    return `${escapeHtml(session.user.display_name)} <a class="account-link account-link-secondary" href="/accounts/logout/">Sign out</a>`
  }
  return '<a class="account-link account-link-secondary" href="/accounts/login/">Sign in</a> <a class="account-link account-link-primary" href="/accounts/signup/">Create account</a>'
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
