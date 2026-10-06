/**
 * What one visit is allowed to say about itself. Coarse on purpose: a referrer host, a station
 * name, a class of screen. No address, no account, no raw user-agent string.
 */
import type { StationId } from '../ui/types.ts';

export const STATION_IDS = Object.keys({
  downforce: true,
  activeAero: true,
  energy: true,
  braking: true,
  tow: true,
  aeroMap: true,
} satisfies Record<StationId, true>) as StationId[];

const STATION_HASH: Record<string, StationId> = {
  '#/downforce': 'downforce',
  '#/active-aero': 'activeAero',
  '#/energy': 'energy',
  '#/braking': 'braking',
  '#/tow': 'tow',
  '#/aero-map': 'aeroMap',
};

export type Channel = 'direct' | 'search' | 'social' | 'referral' | 'campaign';
export type Device = 'phone' | 'tablet' | 'desktop';
export type BrowserName = 'firefox' | 'safari' | 'chrome' | 'edge' | 'other';
export type OsName = 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'chromeos' | 'other';
export type Viewport = 'narrow' | 'medium' | 'wide';
export type Outcome = 'ready' | 'no-webgl' | 'start-failed' | 'left-early';

export interface VisitRecord {
  kind: 'visit';
  returning: boolean;
  landing: StationId | 'other';
  channel: Channel;
  /** Host, campaign source, or "direct" / "same-site". */
  via: string;
  medium: string | null;
  campaign: string | null;
  device: Device;
  browser: BrowserName;
  os: OsName;
  viewport: Viewport;
  theme: 'light' | 'dark';
  reducedMotion: boolean;
  language: string;
  display: 'browser' | 'standalone';
  webgl: boolean;
  outcome: Outcome;
}

export interface EngagementRecord {
  kind: 'engagement';
  stations: StationId[];
  dwellS: number;
}

export type AnalyticsRecord = VisitRecord | EngagementRecord;

const SEARCH_HOSTS = ['bing.com', 'duckduckgo.com', 'search.yahoo.com', 'yahoo.com', 'ecosia.org', 'baidu.com', 'startpage.com', 'search.brave.com'];

const SOCIAL_HOSTS = [
  't.co',
  'twitter.com',
  'x.com',
  'facebook.com',
  'fb.com',
  'instagram.com',
  'linkedin.com',
  'lnkd.in',
  'reddit.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'bsky.app',
  'news.ycombinator.com',
  'threads.net',
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sanitizeToken(raw: string | null | undefined, max = 40): string | null {
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '')
    .slice(0, max);
  return cleaned || null;
}

export function sanitizeHost(host: string): string | null {
  const normalized = host.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (!/^[a-z0-9.-]{1,80}$/.test(normalized)) return null;
  if (normalized.startsWith('.') || normalized.includes('..')) return null;
  return normalized;
}

export function stationFromHash(hash: string): StationId | 'other' {
  if (hash === '' || hash === '#' || hash === '#/') return 'downforce';
  return STATION_HASH[hash] ?? 'other';
}

function hostMatches(host: string, patterns: string[]): boolean {
  return patterns.some((pattern) => host === pattern || host.endsWith(`.${pattern}`));
}

function isSearchHost(host: string): boolean {
  if (host === 'google.com' || host.endsWith('.google.com') || /^google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host)) return true;
  if (host === 'yandex.com' || host === 'yandex.ru' || host.endsWith('.yandex.com') || host.endsWith('.yandex.ru')) return true;
  return hostMatches(host, SEARCH_HOSTS);
}

export function classifyAccess(
  referrer: string,
  pageHref: string,
  search = '',
): { channel: Channel; via: string; medium: string | null; campaign: string | null } {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search || new URL(pageHref).search);
  } catch {
    params = new URLSearchParams(search);
  }
  const medium = sanitizeToken(params.get('utm_medium'));
  const campaign = sanitizeToken(params.get('utm_campaign'));
  const source = sanitizeToken(params.get('utm_source'));
  if (source || medium || campaign) {
    return { channel: 'campaign', via: source ?? medium ?? campaign ?? 'campaign', medium, campaign };
  }

  if (!referrer) return { channel: 'direct', via: 'direct', medium: null, campaign: null };
  let referrerUrl: URL;
  let pageUrl: URL | null = null;
  try {
    referrerUrl = new URL(referrer);
    pageUrl = new URL(pageHref);
  } catch {
    return { channel: 'direct', via: 'direct', medium: null, campaign: null };
  }
  const host = sanitizeHost(referrerUrl.hostname);
  if (!host) return { channel: 'direct', via: 'direct', medium: null, campaign: null };
  if (pageUrl && sanitizeHost(pageUrl.hostname) === host) {
    return { channel: 'direct', via: 'same-site', medium: null, campaign: null };
  }
  if (isSearchHost(host)) return { channel: 'search', via: host, medium: null, campaign: null };
  if (hostMatches(host, SOCIAL_HOSTS)) return { channel: 'social', via: host, medium: null, campaign: null };
  return { channel: 'referral', via: host, medium: null, campaign: null };
}

export function browserFamily(userAgent: string): BrowserName {
  const ua = userAgent.toLowerCase();
  if (ua.includes('edg/') || ua.includes('edgios')) return 'edge';
  if (ua.includes('firefox') || ua.includes('fxios')) return 'firefox';
  if (ua.includes('chrome') || ua.includes('crios') || ua.includes('chromium')) return 'chrome';
  if (ua.includes('safari')) return 'safari';
  return 'other';
}

export function osFamily(userAgent: string): OsName {
  const ua = userAgent.toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod') || ua.includes('crios') || ua.includes('fxios')) return 'ios';
  if (ua.includes('cros')) return 'chromeos';
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macos';
  if (ua.includes('linux')) return 'linux';
  return 'other';
}

export function deviceClass(width: number, height: number, coarsePointer: boolean): Device {
  if (!coarsePointer) return 'desktop';
  return Math.min(width, height) < 500 ? 'phone' : 'tablet';
}

export function viewportClass(width: number): Viewport {
  if (width < 600) return 'narrow';
  if (width < 1100) return 'medium';
  return 'wide';
}

export function languageCode(language: string): string {
  const primary = language.trim().toLowerCase().split('-')[0] ?? '';
  return /^[a-z]{2}$/.test(primary) ? primary : 'other';
}

export interface VisitInput {
  referrer: string;
  pageHref: string;
  userAgent: string;
  language: string;
  viewportWidth: number;
  viewportHeight: number;
  coarsePointer: boolean;
  theme: string;
  reducedMotion: boolean;
  standalone: boolean;
  webgl: boolean;
  returning: boolean;
  outcome: Outcome;
}

export function buildVisit(input: VisitInput): VisitRecord {
  let hash = '';
  try {
    hash = new URL(input.pageHref).hash;
  } catch {
    hash = '';
  }
  const access = classifyAccess(input.referrer, input.pageHref);
  return {
    kind: 'visit',
    returning: input.returning,
    landing: stationFromHash(hash),
    channel: access.channel,
    via: access.via,
    medium: access.medium,
    campaign: access.campaign,
    device: deviceClass(input.viewportWidth, input.viewportHeight, input.coarsePointer),
    browser: browserFamily(input.userAgent),
    os: osFamily(input.userAgent),
    viewport: viewportClass(input.viewportWidth),
    theme: input.theme === 'dark' ? 'dark' : 'light',
    reducedMotion: input.reducedMotion,
    language: languageCode(input.language),
    display: input.standalone ? 'standalone' : 'browser',
    webgl: input.webgl,
    outcome: input.outcome,
  };
}

export function buildEngagement(stations: readonly string[], dwellS: number): EngagementRecord {
  const seen = new Set<StationId>();
  const list: StationId[] = [];
  for (const id of stations) {
    if (!(STATION_IDS as string[]).includes(id) || seen.has(id as StationId)) continue;
    seen.add(id as StationId);
    list.push(id as StationId);
    if (list.length === STATION_IDS.length) break;
  }
  const dwell = Number.isFinite(dwellS) ? Math.max(0, Math.min(3600, Math.round(dwellS))) : 0;
  return { kind: 'engagement', stations: list, dwellS: dwell };
}

function isOutcome(value: unknown): value is Outcome {
  return value === 'ready' || value === 'no-webgl' || value === 'start-failed' || value === 'left-early';
}

function readVisit(value: Record<string, unknown>): VisitRecord | null {
  if (typeof value.returning !== 'boolean' || typeof value.webgl !== 'boolean') return null;
  if (typeof value.reducedMotion !== 'boolean') return null;
  if (value.theme !== 'light' && value.theme !== 'dark') return null;
  if (value.display !== 'browser' && value.display !== 'standalone') return null;
  if (value.channel !== 'direct' && value.channel !== 'search' && value.channel !== 'social' && value.channel !== 'referral' && value.channel !== 'campaign') {
    return null;
  }
  if (value.device !== 'phone' && value.device !== 'tablet' && value.device !== 'desktop') return null;
  if (value.browser !== 'firefox' && value.browser !== 'safari' && value.browser !== 'chrome' && value.browser !== 'edge' && value.browser !== 'other') {
    return null;
  }
  if (
    value.os !== 'ios' &&
    value.os !== 'android' &&
    value.os !== 'macos' &&
    value.os !== 'windows' &&
    value.os !== 'linux' &&
    value.os !== 'chromeos' &&
    value.os !== 'other'
  ) {
    return null;
  }
  if (value.viewport !== 'narrow' && value.viewport !== 'medium' && value.viewport !== 'wide') return null;
  if (!isOutcome(value.outcome)) return null;
  const landing = value.landing === 'other' || (typeof value.landing === 'string' && (STATION_IDS as string[]).includes(value.landing)) ? value.landing : null;
  if (!landing) return null;
  const via = sanitizeToken(typeof value.via === 'string' ? value.via : '', 80);
  if (!via) return null;
  const medium = value.medium === null ? null : sanitizeToken(typeof value.medium === 'string' ? value.medium : null);
  const campaign = value.campaign === null ? null : sanitizeToken(typeof value.campaign === 'string' ? value.campaign : null);
  if (value.medium !== null && medium === null) return null;
  if (value.campaign !== null && campaign === null) return null;
  const language = typeof value.language === 'string' ? languageCode(value.language) : 'other';
  return {
    kind: 'visit',
    returning: value.returning,
    landing: landing as VisitRecord['landing'],
    channel: value.channel,
    via,
    medium,
    campaign,
    device: value.device,
    browser: value.browser,
    os: value.os,
    viewport: value.viewport,
    theme: value.theme,
    reducedMotion: value.reducedMotion,
    language,
    display: value.display,
    webgl: value.webgl,
    outcome: value.outcome,
  };
}

function readEngagement(value: Record<string, unknown>): EngagementRecord | null {
  if (!Array.isArray(value.stations) || typeof value.dwellS !== 'number') return null;
  return buildEngagement(
    value.stations.filter((id): id is string => typeof id === 'string'),
    value.dwellS,
  );
}

/** A posted body is `{ id, record }`. Anything else is dropped. */
export function parsePayload(data: unknown): { id: string; record: AnalyticsRecord } | null {
  if (!data || typeof data !== 'object') return null;
  const body = data as Record<string, unknown>;
  if (typeof body.id !== 'string' || !UUID.test(body.id)) return null;
  if (!body.record || typeof body.record !== 'object') return null;
  const record = body.record as Record<string, unknown>;
  if (record.kind === 'visit') {
    const visit = readVisit(record);
    return visit ? { id: body.id.toLowerCase(), record: visit } : null;
  }
  if (record.kind === 'engagement') {
    const engagement = readEngagement(record);
    return engagement ? { id: body.id.toLowerCase(), record: engagement } : null;
  }
  return null;
}
