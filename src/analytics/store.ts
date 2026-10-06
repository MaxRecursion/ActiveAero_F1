/**
 * Visit storage and the rollup a person can read. Keys are one row per browser session, overwritten
 * when that session sends a fuller picture, and dropped after 90 days.
 */
import { STATION_IDS, type AnalyticsRecord, type EngagementRecord, type VisitRecord } from './record.ts';

export const REPORT_DAYS = 30;
export const RETENTION_SECONDS = 90 * 24 * 60 * 60;

export interface ListPage {
  keys: string[];
  cursor?: string;
  done: boolean;
}

export interface AnalyticsStore {
  /** False when this process will forget the rows as soon as it stops. */
  readonly persistent: boolean;
  put(key: string, value: string, expirationTtl?: number): Promise<void>;
  get(key: string): Promise<string | null>;
  list(prefix: string, cursor?: string): Promise<ListPage>;
}

interface MemoryRow {
  value: string;
  expiresAt: number | null;
}

export class MemoryStore implements AnalyticsStore {
  readonly persistent = false;
  private rows = new Map<string, MemoryRow>();

  constructor(private now: () => number = () => Date.now()) {}

  async put(key: string, value: string, expirationTtl?: number): Promise<void> {
    const expiresAt = expirationTtl ? this.now() + expirationTtl * 1000 : null;
    this.rows.set(key, { value, expiresAt });
  }

  async get(key: string): Promise<string | null> {
    const row = this.rows.get(key);
    if (!row) return null;
    if (row.expiresAt !== null && row.expiresAt <= this.now()) {
      this.rows.delete(key);
      return null;
    }
    return row.value;
  }

  async list(prefix: string, cursor?: string): Promise<ListPage> {
    const keys = [...this.rows.keys()]
      .filter((key) => key.startsWith(prefix) && this.live(key))
      .sort();
    const start = cursor ? Number(cursor) : 0;
    const slice = keys.slice(start, start + 1000);
    const next = start + slice.length;
    return { keys: slice, done: next >= keys.length, cursor: next >= keys.length ? undefined : String(next) };
  }

  private live(key: string): boolean {
    const row = this.rows.get(key);
    if (!row) return false;
    if (row.expiresAt !== null && row.expiresAt <= this.now()) {
      this.rows.delete(key);
      return false;
    }
    return true;
  }
}

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function recentDays(now: Date, days = REPORT_DAYS): string[] {
  const start = Date.parse(`${utcDay(now)}T00:00:00Z`);
  const list: string[] = [];
  for (let i = days - 1; i >= 0; i--) list.push(new Date(start - i * 86_400_000).toISOString().slice(0, 10));
  return list;
}

export function storageKey(day: string, record: AnalyticsRecord, id: string): string {
  return `v1/${day}/${record.kind === 'visit' ? 'v' : 'e'}/${id}`;
}

export interface StoredEvent {
  day: string;
  record: AnalyticsRecord;
}

export interface DayCount {
  day: string;
  visits: number;
  firstTime: number;
}

export interface AccessRow {
  channel: VisitRecord['channel'];
  via: string;
  medium: string | null;
  campaign: string | null;
  visits: number;
}

export interface AnalyticsSummary {
  from: string;
  to: string;
  generatedAt: string;
  persistent: boolean;
  truncated: boolean;
  visits: number;
  firstTime: number;
  returning: number;
  byDay: DayCount[];
  access: AccessRow[];
  devices: Record<string, number>;
  browsers: Record<string, number>;
  systems: Record<string, number>;
  viewports: Record<string, number>;
  themes: Record<string, number>;
  languages: Record<string, number>;
  landings: Record<string, number>;
  stations: Record<string, number>;
  outcomes: Record<string, number>;
  avgDwellS: number | null;
  engagementSessions: number;
}

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function objectFrom(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

export function summarize(events: StoredEvent[], now: Date, persistent: boolean, truncated = false): AnalyticsSummary {
  const days = recentDays(now);
  const daySet = new Set(days);
  const visits: VisitRecord[] = [];
  const engagements: EngagementRecord[] = [];
  const perDay = new Map<string, { visits: number; firstTime: number }>();
  for (const day of days) perDay.set(day, { visits: 0, firstTime: 0 });

  for (const event of events) {
    if (!daySet.has(event.day)) continue;
    if (event.record.kind === 'visit') {
      visits.push(event.record);
      const bucket = perDay.get(event.day)!;
      bucket.visits += 1;
      if (!event.record.returning) bucket.firstTime += 1;
    } else {
      engagements.push(event.record);
    }
  }

  const access = new Map<string, AccessRow>();
  const devices = new Map<string, number>();
  const browsers = new Map<string, number>();
  const systems = new Map<string, number>();
  const viewports = new Map<string, number>();
  const themes = new Map<string, number>();
  const languages = new Map<string, number>();
  const landings = new Map<string, number>();
  const outcomes = new Map<string, number>();
  for (const visit of visits) {
    const key = [visit.channel, visit.via, visit.medium ?? '', visit.campaign ?? ''].join('\n');
    const row = access.get(key) ?? { channel: visit.channel, via: visit.via, medium: visit.medium, campaign: visit.campaign, visits: 0 };
    row.visits += 1;
    access.set(key, row);
    bump(devices, visit.device);
    bump(browsers, visit.browser);
    bump(systems, visit.os);
    bump(viewports, visit.viewport);
    bump(themes, visit.theme);
    bump(languages, visit.language);
    bump(landings, visit.landing);
    bump(outcomes, visit.outcome);
  }

  const stations = new Map<string, number>();
  let dwell = 0;
  for (const engagement of engagements) {
    dwell += engagement.dwellS;
    for (const station of engagement.stations) bump(stations, station);
  }
  const orderedStations: Record<string, number> = {};
  for (const id of STATION_IDS) if (stations.has(id)) orderedStations[id] = stations.get(id)!;

  const accessRows = [...access.values()].sort((a, b) => b.visits - a.visits || a.via.localeCompare(b.via));
  const shown = accessRows.slice(0, 20);
  if (accessRows.length > 20) {
    shown.push({
      channel: 'referral',
      via: 'other',
      medium: null,
      campaign: null,
      visits: accessRows.slice(20).reduce((sum, row) => sum + row.visits, 0),
    });
  }

  return {
    from: days[0]!,
    to: days[days.length - 1]!,
    generatedAt: now.toISOString(),
    persistent,
    truncated,
    visits: visits.length,
    firstTime: visits.filter((visit) => !visit.returning).length,
    returning: visits.filter((visit) => visit.returning).length,
    byDay: days.map((day) => ({ day, visits: perDay.get(day)!.visits, firstTime: perDay.get(day)!.firstTime })),
    access: shown,
    devices: objectFrom(devices),
    browsers: objectFrom(browsers),
    systems: objectFrom(systems),
    viewports: objectFrom(viewports),
    themes: objectFrom(themes),
    languages: objectFrom(languages),
    landings: objectFrom(landings),
    stations: orderedStations,
    outcomes: objectFrom(outcomes),
    avgDwellS: engagements.length ? Math.round(dwell / engagements.length) : null,
    engagementSessions: engagements.length,
  };
}

export async function loadEvents(store: AnalyticsStore, now: Date): Promise<{ events: StoredEvent[]; truncated: boolean }> {
  const events: StoredEvent[] = [];
  let truncated = false;
  let pages = 0;
  for (const day of recentDays(now)) {
    let cursor: string | undefined;
    do {
      if (pages >= 40) {
        truncated = true;
        return { events, truncated };
      }
      pages += 1;
      const page = await store.list(`v1/${day}/`, cursor);
      for (const key of page.keys) {
        const raw = await store.get(key);
        if (!raw) continue;
        try {
          const record = JSON.parse(raw) as AnalyticsRecord;
          if (record && (record.kind === 'visit' || record.kind === 'engagement')) events.push({ day, record });
        } catch {
          // A bad row is skipped; the next write replaces that session's key.
        }
      }
      cursor = page.done ? undefined : page.cursor;
    } while (cursor);
  }
  return { events, truncated };
}
