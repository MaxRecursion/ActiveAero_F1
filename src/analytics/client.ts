/**
 * Sends two cookieless notes to `/api/collect`: one when the page finishes starting (or fails),
 * and one when the visitor leaves, with the stations they opened. Automated browsers are ignored
 * so screenshots and Lighthouse do not become visitors.
 */
import { getTheme } from '../theme';
import { buildEngagement, buildVisit, type Outcome, type VisitInput } from './record';

const VISITED_KEY = 'unseen-visited';

export interface AnalyticsHandle {
  outcome(outcome: Outcome): void;
}

let active: Session | null = null;

class Session {
  readonly id = crypto.randomUUID();
  private readonly started = Date.now();
  private readonly returning = markReturning();
  private readonly webgl: boolean;
  private stations: string[] = [];
  private visitSent = false;
  private lastEngagement = '';

  constructor(webgl: boolean) {
    this.webgl = webgl;
    document.addEventListener('visibilitychange', this.onHide);
    window.addEventListener('pagehide', this.onPageHide);
  }

  noteStation(id: string) {
    if (!this.stations.includes(id)) this.stations.push(id);
  }

  outcome(outcome: Outcome) {
    this.sendVisit(outcome);
  }

  private onHide = () => {
    if (document.visibilityState === 'hidden') this.sendEngagement();
  };

  private onPageHide = () => {
    if (!this.visitSent) this.sendVisit('left-early');
    this.sendEngagement();
  };

  private sendVisit(outcome: Outcome) {
    if (this.visitSent) return;
    this.visitSent = true;
    post({ id: this.id, record: buildVisit(readInput(this.webgl, this.returning, outcome)) });
  }

  private sendEngagement() {
    const record = buildEngagement(this.stations, (Date.now() - this.started) / 1000);
    if (!record.stations.length && record.dwellS < 2) return;
    const json = JSON.stringify(record);
    if (json === this.lastEngagement) return;
    if (post({ id: this.id, record })) this.lastEngagement = json;
  }
}

function markReturning(): boolean {
  try {
    const seen = localStorage.getItem(VISITED_KEY) === '1';
    localStorage.setItem(VISITED_KEY, '1');
    return seen;
  } catch {
    return false;
  }
}

function automatedBrowser(): boolean {
  try {
    return navigator.webdriver === true;
  } catch {
    return false;
  }
}

function readInput(webgl: boolean, returning: boolean, outcome: Outcome): VisitInput {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  return {
    referrer: document.referrer,
    pageHref: location.href,
    userAgent: navigator.userAgent,
    language: navigator.language || '',
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    coarsePointer: coarse,
    theme: getTheme(),
    reducedMotion,
    standalone,
    webgl,
    returning,
    outcome,
  };
}

export function collectUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${base.endsWith('/') ? base : `${base}/`}api/collect`;
}

function post(payload: unknown): boolean {
  const json = JSON.stringify(payload);
  try {
    const body = new Blob([json], { type: 'application/json' });
    if (navigator.sendBeacon?.(collectUrl(), body)) return true;
  } catch {
    // fetch below is the fallback when the beacon cannot be queued
  }
  void fetch(collectUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: json,
    keepalive: true,
    credentials: 'omit',
    mode: 'same-origin',
  }).catch(() => {});
  return true;
}

export function installAnalytics(opts: { webgl: boolean }): AnalyticsHandle {
  try {
    if (automatedBrowser() || active) return { outcome() {} };
    active = new Session(opts.webgl);
    return { outcome: (outcome) => active?.outcome(outcome) };
  } catch (err) {
    console.warn('Analytics did not start.', err);
    return { outcome() {} };
  }
}

/** The app calls this on every station change, including the one that opened with the page. */
export function noteStation(id: string): void {
  try {
    active?.noteStation(id);
  } catch {
    // Counting stations must never interrupt the station change.
  }
}
