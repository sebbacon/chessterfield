import { updateMySettings } from './api/user.js'

export const SETTING_DEFAULTS = {
  preferred_side: 'auto',
  analysis_visibility: 'visible',
  engine_move_speed: 'standard',
  default_library_mode: 'positions',
}

export const SETTING_OPTIONS = {
  preferred_side: [
    ['auto', 'Auto'],
    ['white', 'White'],
    ['black', 'Black'],
  ],
  analysis_visibility: [
    ['visible', 'Show best-next-moves panel'],
    ['hidden', 'Hide best-next-moves panel'],
  ],
  engine_move_speed: [
    ['fast', 'Fast (~1s)'],
    ['standard', 'Standard (~3s)'],
    ['slow', 'Slow (~5s)'],
  ],
  default_library_mode: [
    ['positions', 'Positions'],
    ['games', 'Games'],
  ],
}

const STORAGE_KEYS = {
  preferred_side: 'chessterfield:preferred-side:v1',
  analysis_visibility: 'chessterfield:analysis-visibility:v1',
  engine_move_speed: 'chessterfield:engine-move-speed:v1',
  default_library_mode: 'chessterfield:default-library-mode:v1',
}

export function readUserSettings(session) {
  if (session?.authenticated) {
    const normalized = normalizeSettingsObject(session.user?.settings)
    ensureSessionSettings(session, normalized)
    return normalized
  }

  if (!hasLocalStorage()) return { ...SETTING_DEFAULTS }

  return normalizeSettingsObject({
    preferred_side: window.localStorage.getItem(STORAGE_KEYS.preferred_side),
    analysis_visibility: window.localStorage.getItem(STORAGE_KEYS.analysis_visibility),
    engine_move_speed: window.localStorage.getItem(STORAGE_KEYS.engine_move_speed),
    default_library_mode: window.localStorage.getItem(STORAGE_KEYS.default_library_mode),
  })
}

export function readUserSetting(session, field) {
  return readUserSettings(session)[field]
}

export async function writeUserSettings(session, partial) {
  const normalizedPartial = normalizeSettingsPartial(partial)

  if (session?.authenticated) {
    const response = await updateMySettings(normalizedPartial)
    const merged = normalizeSettingsObject({
      ...readUserSettings(session),
      ...(response?.settings || normalizedPartial),
    })
    ensureSessionSettings(session, merged)
    return merged
  }

  if (hasLocalStorage()) {
    for (const [field, value] of Object.entries(normalizedPartial)) {
      window.localStorage.setItem(STORAGE_KEYS[field], value)
    }
  }
  return readUserSettings(session)
}

function ensureSessionSettings(session, settings) {
  if (!session) return
  if (!session.user) session.user = {}
  session.user.settings = { ...settings }
}

function normalizeSettingsObject(rawSettings = {}) {
  return {
    preferred_side: normalizePreferredSide(rawSettings?.preferred_side),
    analysis_visibility: normalizeAnalysisVisibility(rawSettings?.analysis_visibility),
    engine_move_speed: normalizeEngineMoveSpeed(rawSettings?.engine_move_speed),
    default_library_mode: normalizeLibraryMode(rawSettings?.default_library_mode),
  }
}

function normalizeSettingsPartial(partial = {}) {
  const normalized = {}

  if (Object.prototype.hasOwnProperty.call(partial, 'preferred_side')) {
    normalized.preferred_side = normalizePreferredSide(partial.preferred_side)
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'analysis_visibility')) {
    normalized.analysis_visibility = normalizeAnalysisVisibility(partial.analysis_visibility)
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'engine_move_speed')) {
    normalized.engine_move_speed = normalizeEngineMoveSpeed(partial.engine_move_speed)
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'default_library_mode')) {
    normalized.default_library_mode = normalizeLibraryMode(partial.default_library_mode)
  }

  return normalized
}

function normalizePreferredSide(value) {
  return optionExists('preferred_side', value) ? value : SETTING_DEFAULTS.preferred_side
}

function normalizeAnalysisVisibility(value) {
  if (value === 'shown') return 'visible'
  return optionExists('analysis_visibility', value) ? value : SETTING_DEFAULTS.analysis_visibility
}

function normalizeEngineMoveSpeed(value) {
  return optionExists('engine_move_speed', value) ? value : SETTING_DEFAULTS.engine_move_speed
}

function normalizeLibraryMode(value) {
  return optionExists('default_library_mode', value) ? value : SETTING_DEFAULTS.default_library_mode
}

function optionExists(field, value) {
  return SETTING_OPTIONS[field].some(([optionValue]) => optionValue === value)
}

function hasLocalStorage() {
  return typeof window !== 'undefined' && window.localStorage
}
