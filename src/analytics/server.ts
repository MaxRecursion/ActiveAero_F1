/**
 * `POST /api/collect` stores one session row. `GET /api/stats` is the reading of the last 30 days:
 * HTML in a browser, JSON when asked for.
 */
import { parsePayload } from './record.ts';
import { loadEvents, RETENTION_SECONDS, storageKey, summarize, utcDay, type AnalyticsStore, type AnalyticsSummary } from './store.ts';

const MAX_BODY = 2048;

function sameSite(request: Request): boolean {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).host === url.host;
    } catch {
      return false;
    }
  }
  const referrer = request.headers.get('referer');
  if (!referrer) return false;
  try {
    return new URL(referrer).host === url.host;
  } catch {
    return false;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

async function collect(request: Request, store: AnalyticsStore, now: Date): Promise<Response> {
  if (!sameSite(request)) return text('forbidden', 403);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return text('too large', 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return text('bad json', 400);
  }
  const payload = parsePayload(parsed);
  if (!payload) return text('bad payload', 400);
  const key = storageKey(utcDay(now), payload.record, payload.id);
  await store.put(key, JSON.stringify(payload.record), RETENTION_SECONDS);
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

function wantsJson(request: Request): boolean {
  const url = new URL(request.url);
  if (url.searchParams.get('format') === 'json') return true;
  const accept = request.headers.get('accept') ?? '';
  return accept.includes('application/json') && !accept.includes('text/html');
}

export async function handleAnalytics(request: Request, store: AnalyticsStore, pathname: string, now = new Date()): Promise<Response | null> {
  if (pathname !== '/api/collect' && pathname !== '/api/stats') return null;
  try {
    if (pathname === '/api/collect') {
      if (request.method !== 'POST') return text('method', 405);
      return await collect(request, store, now);
    }
    if (request.method !== 'GET') return text('method', 405);
    const { events, truncated } = await loadEvents(store, now);
    const summary = summarize(events, now, store.persistent, truncated);
    if (wantsJson(request)) return json(summary);
    return new Response(renderStats(summary), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      },
    });
  } catch (err) {
    console.error(err);
    return text('unavailable', 500);
  }
}

function esc(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'));
}

function num(value: number): string {
  return new Intl.NumberFormat('en-GB').format(value);
}

function dwell(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

function rows(entries: [string, number][], empty: string): string {
  if (!entries.length) return `<p class="empty">${empty}</p>`;
  return `<table>${entries.map(([label, count]) => `<tr><th>${esc(label)}</th><td>${num(count)}</td></tr>`).join('')}</table>`;
}

function accessLabel(row: AnalyticsSummary['access'][number]): string {
  const channel = row.channel === 'referral' ? 'Link' : row.channel[0]!.toUpperCase() + row.channel.slice(1);
  const extra = [row.medium, row.campaign].filter(Boolean).join(' · ');
  const via = row.via === 'direct' ? 'No referrer' : row.via === 'same-site' ? 'Opened from this site' : row.via;
  return extra ? `${channel} · ${via} · ${extra}` : `${channel} · ${via}`;
}

export function renderStats(summary: AnalyticsSummary): string {
  const access = summary.access.map((row) => [accessLabel(row), row.visits] as [string, number]);
  const days = summary.byDay.map((day) => [day.day, day.visits] as [string, number]);
  const banner = summary.persistent
    ? ''
    : '<p class="banner">These numbers live only in this server process. On Cloudflare Pages, bind a KV namespace named ANALYTICS to keep them.</p>';
  const truncated = summary.truncated ? '<p class="banner">The report stopped early because there are more stored rows than this page will read.</p>' : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="referrer" content="no-referrer" />
  <title>UNSEEN visits</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; font: 16px/1.45 system-ui, sans-serif; background: #f4f1ea; color: #1c1b19; }
    main { max-width: 40rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
    h1 { font-size: 1.6rem; font-weight: 650; letter-spacing: -0.02em; margin: 0 0 0.25rem; }
    h2 { font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; margin: 2rem 0 0.6rem; }
    p { margin: 0.3rem 0; }
    .range { color: #5c5852; }
    .totals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin: 1.25rem 0 0; }
    .totals div { background: white; border-radius: 0.6rem; padding: 0.8rem 0.9rem; }
    .totals strong { display: block; font-size: 1.7rem; letter-spacing: -0.03em; }
    .totals span { color: #5c5852; font-size: 0.85rem; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 0.6rem; overflow: hidden; }
    th, td { text-align: left; padding: 0.45rem 0.75rem; border-top: 1px solid #ece7de; font-weight: 450; }
    td { text-align: right; font-variant-numeric: tabular-nums; }
    tr:first-child th, tr:first-child td { border-top: 0; }
    .empty, .note, .banner { color: #5c5852; }
    .banner { background: #fff6d8; color: #3d3420; padding: 0.7rem 0.8rem; border-radius: 0.5rem; }
    a { color: inherit; }
    @media (prefers-color-scheme: dark) {
      body { background: #141311; color: #f3efe6; }
      .range, .totals span, .empty, .note { color: #b7b0a4; }
      .totals div, table { background: #211f1c; }
      th, td { border-top-color: #322e28; }
      .banner { background: #3a321c; color: #f3e6c0; }
    }
  </style>
</head>
<body>
  <main>
    <h1>UNSEEN visits</h1>
    <p class="range">${esc(summary.from)} – ${esc(summary.to)} UTC · <a href="?format=json">JSON</a></p>
    ${banner}
    ${truncated}
    <section class="totals">
      <div><strong>${num(summary.visits)}</strong><span>Visits</span></div>
      <div><strong>${num(summary.firstTime)}</strong><span>First-time browsers</span></div>
      <div><strong>${num(summary.returning)}</strong><span>Returning browsers</span></div>
    </section>
    <h2>How they arrived</h2>
    ${rows(access, 'No visits in this window.')}
    <h2>Days</h2>
    ${rows(days, 'No days.')}
    <h2>Screens</h2>
    ${rows(Object.entries(summary.devices), 'No visits in this window.')}
    <h2>Browsers and systems</h2>
    ${rows([...Object.entries(summary.browsers), ...Object.entries(summary.systems)], 'No visits in this window.')}
    <h2>Window size and theme</h2>
    ${rows([...Object.entries(summary.viewports), ...Object.entries(summary.themes)], 'No visits in this window.')}
    <h2>Languages</h2>
    ${rows(Object.entries(summary.languages), 'No visits in this window.')}
    <h2>Where they landed</h2>
    ${rows(Object.entries(summary.landings), 'No visits in this window.')}
    <h2>Stations opened</h2>
    ${rows(Object.entries(summary.stations), 'No station has been opened long enough to record.')}
    <h2>Startup</h2>
    ${rows(Object.entries(summary.outcomes), 'No visits in this window.')}
    <p class="note">Average time open: ${esc(dwell(summary.avgDwellS))} across ${num(summary.engagementSessions)} sessions that reported it.</p>
    <p class="note">Cookieless. Each page load is one visit. First-time means this browser has not opened UNSEEN before. “No referrer” includes browsers that hid where they came from. The report stores a referrer host, a campaign name, the kind of screen, and the stations opened. It does not store an IP address, an account, or the raw browser string. Rows expire after 90 days.</p>
  </main>
</body>
</html>`;
}
