/**
 * Browser UI preferences module (non-sensitive display settings only).
 * All business records, users, tasks, and authentication sessions are stored in Firebase.
 */
const SETTINGS_KEY = 'ctm_settings';

const DEFAULT_SETTINGS = {
  compactTables: false,
  dateFormat: 'medium',
  confirmStatusChange: false
};

export function getSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...(parsed || {}) };
  } catch (_err) {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    return true;
  } catch (_err) {
    return false;
  }
}

export const Storage = {
  getSettings,
  saveSettings
};

window.CTM = window.CTM || {};
window.CTM.Storage = Storage;
