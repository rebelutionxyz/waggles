import type { MetadataRoute } from 'next';
import { BRAND } from '@/lib/brand';

/**
 * TALK_MSGPUSH1 (2026-09-14) — TALK's web app manifest. Confirmed absent
 * before this pass (`TALK_PUSH1`'s report: "No `manifest.json` anywhere
 * under `public/`") — this is step zero of that pass's proposed build
 * order, item 1: needed for a correctly-named/iconed "Add to Home Screen"
 * install regardless of push, and a hard prerequisite for push specifically
 * on iOS (Safari only delivers Web Push to an installed Home Screen app,
 * never a plain tab — see `src/lib/push.ts`'s own header for the full rule).
 *
 * Next.js App Router convention (`app/manifest.ts`) — auto-serves at
 * `/manifest.webmanifest` and injects the `<link rel="manifest">` tag, so
 * `layout.tsx` needs no manual link.
 *
 * ICON NOTE (WAGGLES_PWA1): the icon set below (icon-192, icon-512, and a
 * maskable 512) is generated as PLACEHOLDERS from `public/logo.png` — which is
 * a 1008x1040 JPEG mislabeled `.png` — downscaled (via sharp) onto the brand
 * background as proper square PNGs. They are installability-correct but are
 * NOT the final brand icons; a real, purpose-drawn icon set is a later design
 * task (see the WAGGLES_PWA1 report).
 *
 * basePath-aware: Waggles may be served under NEXT_PUBLIC_BASE_PATH, so icon
 * `src`, `start_url`, `scope` and `id` are all prefixed with it.
 */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: `${BASE}/`,
    name: `${BRAND.name} — ${BRAND.product}`,
    short_name: BRAND.name,
    description: BRAND.description,
    start_url: `${BASE}/`,
    scope: `${BASE}/`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#07080A',
    theme_color: '#07080A',
    categories: ['communication', 'social'],
    icons: [
      { src: `${BASE}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${BASE}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${BASE}/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
