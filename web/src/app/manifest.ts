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
 * ICON NOTE: `public/logo.png` is the only brand asset in this repo (and is
 * actually a 1008x1040 JPEG despite its `.png` name/extension — confirmed via
 * its file header, unrelated to this pass, not fixed here). Referenced
 * verbatim below with its real `image/jpeg` type — non-square, not a proper
 * icon set (no 192x192/512x512 square PNGs), so a mobile OS's Home Screen
 * icon will be scaled/cropped rather than pixel-exact. A real icon set is an
 * asset/design task, out of scope for this pass; flagged in the report.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} — ${BRAND.product}`,
    short_name: BRAND.name,
    description: BRAND.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#07080A',
    theme_color: '#00B1D7',
    icons: [
      {
        src: '/logo.png',
        sizes: '1008x1040',
        type: 'image/jpeg',
      },
    ],
  };
}
