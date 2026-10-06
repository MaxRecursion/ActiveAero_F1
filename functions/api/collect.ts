import { storeFromEnv, type AnalyticsEnv } from '../../src/analytics/cloudflareStore';
import { handleAnalytics } from '../../src/analytics/server';

export async function onRequest(context: { request: Request; env: AnalyticsEnv }): Promise<Response> {
  const url = new URL(context.request.url);
  const response = await handleAnalytics(context.request, storeFromEnv(context.env), url.pathname);
  return response ?? new Response('not found', { status: 404 });
}
