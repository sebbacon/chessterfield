import { Chess } from 'chess.js'

import { createPosition, fetchTags } from '../api/content.js'
import { ensureSession } from '../state/session.js'

export async function mountImport(app, navigate) {
  const session = await ensureSession()
  app.innerHTML = `
    <div class="import-layout">
      <div class="import-card">
        <div class="import-header">
          <button id="go-back" class="btn-secondary">← Library</button>
          <h1>Import Position</h1>
          <div class="account-pill">${accountLabel(session)}</div>
        </div>
        <form id="import-form">
          <label>
            FEN *
            <input type="text" id="fen-input" placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" autocomplete="off">
            <span class="field-error" id="fen-error"></span>
          </label>
          <label>
            Name *
            <input type="text" id="name-input" placeholder="e.g. Sicilian Najdorf">
            <span class="field-error" id="name-error"></span>
          </label>
          <label>
            Notes
            <textarea id="notes-input" rows="3" placeholder="Optional notes about this position"></textarea>
          </label>
          <label>
            Tags
            <div class="tag-input-area">
              <input type="text" id="tag-input" placeholder="Type tag and press Enter">
              <div id="tag-suggestions" class="tag-suggestions"></div>
            </div>
            <div id="selected-tags" class="selected-tags"></div>
          </label>
          <div class="form-actions">
            <button type="submit" class="btn-primary">Save Position</button>
          </div>
        </form>
      </div>
    </div>
  `

  app.querySelector('#go-back').addEventListener('click', () => navigate('library'))

  // Tag picker
  let existingTags = []
  let selectedTags = new Set()

  try {
    existingTags = (await fetchTags()).map(t => t.name)
  } catch {
    // tag suggestions won't work, that's fine
  }

  const tagInput = app.querySelector('#tag-input')
  const suggestionsEl = app.querySelector('#tag-suggestions')
  const selectedTagsEl = app.querySelector('#selected-tags')

  function renderSelectedTags() {
    selectedTagsEl.innerHTML = [...selectedTags].map(t =>
      `<span class="tag-chip">${escapeHtml(t)} <button class="remove-tag" data-tag="${escapeHtml(t)}">×</button></span>`
    ).join('')
    selectedTagsEl.querySelectorAll('.remove-tag').forEach(btn => {
      btn.addEventListener('click', () => { selectedTags.delete(btn.dataset.tag); renderSelectedTags() })
    })
  }

  function addTag(name) {
    const trimmed = name.trim().toLowerCase()
    if (trimmed) { selectedTags.add(trimmed); renderSelectedTags() }
    tagInput.value = ''
    suggestionsEl.innerHTML = ''
  }

  function commitPendingTag() {
    if (tagInput.value.trim()) addTag(tagInput.value)
  }

  tagInput.addEventListener('input', () => {
    const val = tagInput.value.trim().toLowerCase()
    if (!val) { suggestionsEl.innerHTML = ''; return }
    const matches = existingTags.filter(t => t.includes(val) && !selectedTags.has(t))
    suggestionsEl.innerHTML = matches.slice(0, 6).map(t =>
      `<div class="suggestion" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</div>`
    ).join('')
    suggestionsEl.querySelectorAll('.suggestion').forEach(el => {
      el.addEventListener('mousedown', (e) => { e.preventDefault(); addTag(el.dataset.tag) })
    })
  })

  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput.value) }
  })
  tagInput.addEventListener('blur', commitPendingTag)

  // FEN validation
  const fenInput = app.querySelector('#fen-input')
  const fenError = app.querySelector('#fen-error')

  function validateFen(fen) {
    try {
      new Chess(fen)
      fenError.textContent = ''
      return true
    } catch {
      fenError.textContent = 'Invalid FEN string'
      return false
    }
  }

  fenInput.addEventListener('blur', () => { if (fenInput.value) validateFen(fenInput.value) })

  // Form submit
  app.querySelector('#import-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    commitPendingTag()

    const fen = fenInput.value.trim()
    const name = app.querySelector('#name-input').value.trim()
    const nameError = app.querySelector('#name-error')

    let valid = true
    if (!fen) { fenError.textContent = 'FEN is required'; valid = false } else if (!validateFen(fen)) { valid = false }
    if (!name) { nameError.textContent = 'Name is required'; valid = false } else { nameError.textContent = '' }
    if (!valid) return

    try {
      await createPosition({
        name,
        fen,
        notes: app.querySelector('#notes-input').value,
        tags: [...selectedTags],
      })
      navigate('library')
    } catch {
      showToast('Failed to save position')
    }
  })
}

function accountLabel(session) {
  return session.authenticated
    ? `Signed in as ${escapeHtml(session.user.display_name)}`
    : '<a href="/accounts/login/">Sign in</a>'
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function showToast(msg) {
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 4000)
}
