// Vercel Web Analytics and Google Analytics 4. Both run only in production builds served from
// maxrecursion.dev, so Vercel previews and other mirrors of this build are never counted, and GA4 also
// needs VITE_GA_MEASUREMENT_ID, which is set for the Vercel Production environment only.
import { inject } from '@vercel/analytics';

// Analytics storage starts denied in the EEA, the UK and Switzerland, where it needs consent this
// site does not ask for; Google then gets cookieless pings only. Ads storage is off for everyone.
// Google applies the region rule, so nothing here looks up where the visitor is.
const CONSENT_REGIONS = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH',
];

export function startHostedAnalytics(): void {
  if (!import.meta.env.PROD || !window.location.hostname.endsWith('maxrecursion.dev')) return;
  inject({ mode: 'production' });
  const id = String(import.meta.env.VITE_GA_MEASUREMENT_ID ?? '').trim();
  if (/^G-[A-Z0-9]+$/.test(id)) loadGoogleTag(id);
}

function loadGoogleTag(id: string): void {
  const w = window as unknown as { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
  const dataLayer = (w.dataLayer ??= []);
  // gtag.js reads Arguments objects from the data layer, not arrays, so this cannot be an arrow
  // function with rest parameters.
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    dataLayer.push(arguments);
  };
  const gtag = w.gtag;
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'granted',
  });
  gtag('consent', 'default', { analytics_storage: 'denied', region: CONSENT_REGIONS });
  gtag('js', new Date());
  gtag('config', id, { allow_google_signals: false, allow_ad_personalization_signals: false });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(script);
}
