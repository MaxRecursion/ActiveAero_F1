import { defineConfig } from 'vitest/config';

// The desktop preview assigns a free port through PORT; honour it strictly so the preview
// never silently lands on a different port. Without PORT, Vite's default (5173, or next free).
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const port = Number(env.PORT) || undefined;
const pagesBasePath = env.PAGES_BASE_PATH;

// Link previews need an absolute image URL. Set SITE_URL for the production domain; a Cloudflare Pages
// build otherwise falls back to CF_PAGES_URL. With neither set (local builds) the tags are left out.
const siteUrl = (env.SITE_URL || env.CF_PAGES_URL || '').replace(/\/+$/, '');
const shareTags = {
  name: 'unseen-share-tags',
  transformIndexHtml() {
    if (!siteUrl) return [];
    return [
      { tag: 'meta', attrs: { property: 'og:url', content: `${siteUrl}/` }, injectTo: 'head' as const },
      { tag: 'meta', attrs: { property: 'og:image', content: `${siteUrl}/og.png` }, injectTo: 'head' as const },
      { tag: 'meta', attrs: { name: 'twitter:image', content: `${siteUrl}/og.png` }, injectTo: 'head' as const },
    ];
  },
};

export default defineConfig({
  base: pagesBasePath ?? './',
  plugins: [shareTags],
  server: { port, strictPort: port !== undefined },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    // three.js changes rarely; its own file stays cached across app deploys.
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] } },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
