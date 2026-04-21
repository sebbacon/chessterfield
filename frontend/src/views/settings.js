import { ensureSession } from '../state/session.js'
import { readUserSettings, SETTING_OPTIONS, writeUserSettings } from '../settings.js'

export async function mountSettings(app, navigate) {
  const session = await ensureSession()
  const settings = readUserSettings(session)

  app.innerHTML = `
    <div class="settings-layout">
      <div class="settings-card">
        <div class="settings-header">
          <button id="settings-back" class="btn-secondary">← Library</button>
          <div class="settings-header-copy">
            <h1>Settings</h1>
            <p class="settings-subtitle">${session.authenticated ? 'Saved to your account.' : 'Saved only on this device.'}</p>
          </div>
          <div class="account-pill">${accountLabel(session)}</div>
        </div>

        <div class="settings-notice">
          ${session.authenticated
            ? 'These preferences follow your account across sessions.'
            : 'These preferences are stored in this browser with local storage until you clear them.'}
        </div>

        <form id="settings-form" class="settings-form">
          ${selectFieldHtml('preferred_side', 'Preferred play side', settings.preferred_side)}
          ${selectFieldHtml('engine_move_speed', 'Engine move speed', settings.engine_move_speed)}
          ${selectFieldHtml('analysis_visibility', 'Best-next-moves panel', settings.analysis_visibility)}
          ${selectFieldHtml('default_library_mode', 'Default library view', settings.default_library_mode)}

          <div class="settings-actions">
            <button type="submit" class="btn-primary">Save settings</button>
            <span id="settings-status" class="settings-status" aria-live="polite"></span>
          </div>
        </form>
      </div>
    </div>
  `

  app.querySelector('#settings-back').addEventListener('click', () => navigate('library'))
  app.querySelector('#settings-form').addEventListener('submit', async event => {
    event.preventDefault()

    const form = new FormData(event.currentTarget)
    const payload = {
      preferred_side: form.get('preferred_side'),
      engine_move_speed: form.get('engine_move_speed'),
      analysis_visibility: form.get('analysis_visibility'),
      default_library_mode: form.get('default_library_mode'),
    }
    const statusEl = app.querySelector('#settings-status')
    statusEl.textContent = 'Saving...'

    try {
      await writeUserSettings(session, payload)
      statusEl.textContent = 'Saved'
    } catch {
      statusEl.textContent = 'Could not save settings'
    }
  })
}

function selectFieldHtml(field, label, selectedValue) {
  const helpText = helpTextForField(field)
  return `
    <label class="settings-field">
      <span class="settings-label">${label}</span>
      <select name="${escapeHtml(field)}" class="settings-select">
        ${SETTING_OPTIONS[field].map(([value, optionLabel]) => `
          <option value="${escapeHtml(value)}" ${value === selectedValue ? 'selected' : ''}>${escapeHtml(optionLabel)}</option>
        `).join('')}
      </select>
      <span class="settings-help">${escapeHtml(helpText)}</span>
    </label>
  `
}

function helpTextForField(field) {
  switch (field) {
    case 'preferred_side':
      return 'Used when you open a saved position without explicitly choosing a side.'
    case 'engine_move_speed':
      return 'Controls how long Stockfish thinks before playing its move.'
    case 'analysis_visibility':
      return 'Sets whether the best-next-moves panel starts open or hidden.'
    default:
      return 'Sets which tab the library opens to by default.'
  }
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
