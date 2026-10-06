import { describe, expect, it } from 'vitest';
import { handleAnalytics } from './server';
import { MemoryStore } from './store';
import {
  browserFamily,
  buildVisit,
  classifyAccess,
  deviceClass,
  osFamily,
  parsePayload,
  stationFromHash,
} from './record';

const NOW = new Date('2026-10-06T15:00:00Z');
const ID = '8b6f4c2e-1a2b-4c3d-8e4f-123456789abc';

function visit(overrides: Partial<Parameters<typeof buildVisit>[0]> = {}) {
  return buildVisit({
    referrer: '',
    pageHref: 'https://unseen.example/#/downforce',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    language: 'en-GB',
    viewportWidth: 1440,
    viewportHeight: 900,
    coarsePointer: false,
    theme: 'light',
    reducedMotion: false,
    standalone: false,
    webgl: true,
    returning: false,
    outcome: 'ready',
    ...overrides,
  });
}

describe('how a visit arrived', () => {
  it('treats a missing referrer as direct', () => {
    expect(classifyAccess('', 'https://unseen.example/')).toMatchObject({ channel: 'direct', via: 'direct' });
  });

  it('reads a tagged link as a campaign', () => {
    expect(classifyAccess('https://google.com/search', 'https://unseen.example/?utm_source=Newsletter&utm_medium=email&utm_campaign=spring')).toEqual({
      channel: 'campaign',
      via: 'newsletter',
      medium: 'email',
      campaign: 'spring',
    });
  });

  it('classifies search, social, and other sites', () => {
    expect(classifyAccess('https://www.google.co.uk/search?q=unseen', 'https://unseen.example/').channel).toBe('search');
    expect(classifyAccess('https://t.co/abc', 'https://unseen.example/')).toMatchObject({ channel: 'social', via: 't.co' });
    expect(classifyAccess('https://en.wikipedia.org/wiki/Downforce', 'https://unseen.example/')).toMatchObject({
      channel: 'referral',
      via: 'en.wikipedia.org',
    });
  });

  it('does not treat a reload of this site as a new source', () => {
    expect(classifyAccess('https://unseen.example/index.html', 'https://unseen.example/#/energy')).toMatchObject({ via: 'same-site' });
  });

  it('drops a source that is not a plain token', () => {
    expect(parsePayload({ id: ID, record: { ...visit(), via: '<script>' } })).toMatchObject({ record: { via: 'script' } });
    expect(parsePayload({ id: ID, record: { ...visit(), via: '!!!' } })).toBeNull();
  });
});

describe('the screen and the landing station', () => {
  it('maps hashes the way the app routes them', () => {
    expect(stationFromHash('')).toBe('downforce');
    expect(stationFromHash('#/aero-map')).toBe('aeroMap');
    expect(stationFromHash('#/nope')).toBe('other');
  });

  it('separates phones, tablets, and desktops', () => {
    expect(deviceClass(390, 844, true)).toBe('phone');
    expect(deviceClass(844, 390, true)).toBe('phone');
    expect(deviceClass(1024, 768, true)).toBe('tablet');
    expect(deviceClass(500, 400, false)).toBe('desktop');
  });

  it('names the browser family without keeping the raw string', () => {
    expect(browserFamily('Mozilla/5.0 Edg/120.0 Chrome/120.0 Safari/537.36')).toBe('edge');
    expect(browserFamily('Mozilla/5.0 Firefox/121.0')).toBe('firefox');
    expect(browserFamily('Mozilla/5.0 (iPhone) CriOS/120.0 Safari/604.1')).toBe('chrome');
    expect(osFamily('Mozilla/5.0 (iPhone) CriOS/120.0')).toBe('ios');
    expect(osFamily('Mozilla/5.0 (Linux; Android 14)')).toBe('android');
  });
});

async function must(response: Response | null): Promise<Response> {
  if (!response) throw new Error('expected a response');
  return response;
}

describe('collect and stats', () => {
  it('stores a same-site visit and overwrites that session when it leaves', async () => {
    const store = new MemoryStore();
    const post = async (record: unknown, id = ID) =>
      must(
        await handleAnalytics(
          new Request('http://localhost/api/collect', {
            method: 'POST',
            headers: { origin: 'http://localhost', 'content-type': 'application/json' },
            body: JSON.stringify({ id, record }),
          }),
          store,
          '/api/collect',
          NOW,
        ),
      );

    expect((await post(visit({ returning: false }))).status).toBe(204);
    expect(
      (
        await post({
          kind: 'engagement',
          stations: ['downforce', 'energy', 'downforce', 'nope'],
          dwellS: 125,
        })
      ).status,
    ).toBe(204);
    expect((await post({ kind: 'engagement', stations: ['downforce', 'energy', 'braking'], dwellS: 200 })).status).toBe(204);

    const stats = await must(await handleAnalytics(new Request('http://localhost/api/stats?format=json'), store, '/api/stats', NOW));
    const body = (await stats.json()) as {
      visits: number;
      firstTime: number;
      stations: Record<string, number>;
      access: { via: string }[];
      avgDwellS: number;
      persistent: boolean;
    };
    expect(body.visits).toBe(1);
    expect(body.firstTime).toBe(1);
    expect(body.stations).toEqual({ downforce: 1, energy: 1, braking: 1 });
    expect(body.access[0]?.via).toBe('direct');
    expect(body.avgDwellS).toBe(200);
    expect(body.persistent).toBe(false);

    const page = await must(await handleAnalytics(new Request('http://localhost/api/stats', { headers: { accept: 'text/html' } }), store, '/api/stats', NOW));
    expect(await page.text()).toContain('>1<');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('refuses a post from another site', async () => {
    const response = await must(
      await handleAnalytics(
        new Request('https://unseen.example/api/collect', {
          method: 'POST',
          headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
          body: JSON.stringify({ id: ID, record: visit() }),
        }),
        new MemoryStore(),
        '/api/collect',
        NOW,
      ),
    );
    expect(response.status).toBe(403);
  });

  it('counts a returning browser separately', async () => {
    const store = new MemoryStore();
    await handleAnalytics(
      new Request('http://localhost/api/collect', {
        method: 'POST',
        headers: { origin: 'http://localhost' },
        body: JSON.stringify({ id: ID, record: visit({ returning: true, referrer: 'https://news.ycombinator.com/item' }) }),
      }),
      store,
      '/api/collect',
      NOW,
    );
    const stats = await (await must(await handleAnalytics(new Request('http://localhost/api/stats?format=json'), store, '/api/stats', NOW))).json();
    expect(stats).toMatchObject({ visits: 1, returning: 1, firstTime: 0, access: [{ channel: 'social', via: 'news.ycombinator.com' }] });
  });
});
