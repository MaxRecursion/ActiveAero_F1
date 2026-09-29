import { defineConfig } from 'vitest/config';

// The desktop preview assigns a free port through PORT; honour it strictly so the preview
// never silently lands on a different port. Without PORT, Vite's default (5173, or next free).
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const port = Number(env.PORT) || undefined;

export default defineConfig({
  base: './',
  server: { port, strictPort: port !== undefined },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
