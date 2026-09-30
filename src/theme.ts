export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'unseen-theme';

export function getTheme(): Theme {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function initializeTheme(): Theme {
  const theme = getTheme();
  document.documentElement.dataset.theme = theme;
  return theme;
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The current page still changes theme even when persistence is unavailable.
  }
}