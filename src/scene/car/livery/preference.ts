/**
 * The last livery the reader picked, kept beside the theme preference.
 */
import { isLiveryId, type LiveryId } from './schemes';

const STORAGE_KEY = 'unseen-livery';

export function getLivery(): LiveryId {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
  return saved && isLiveryId(saved) ? saved : 'clay';
}

export function setLiveryPreference(id: LiveryId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // The car still changes livery even when persistence is unavailable.
  }
}
