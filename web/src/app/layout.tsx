import type { Metadata } from 'next';
import { BRAND, SITE_URL } from '@/lib/brand';
import { TalkShell } from '@/components/shell/TalkShell';
import { RegisterSW } from '@/components/pwa/RegisterSW';
import './globals.css';

// WAGGLES_PWA1 — basePath for the apple-touch icon URL (env-driven, default '/').
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${BRAND.name} - ${BRAND.product}`,
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.description,
  applicationName: BRAND.name,
  openGraph: {
    type: 'website',
    siteName: BRAND.name,
    title: `${BRAND.name} - ${BRAND.product}`,
    description: BRAND.description,
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${BRAND.name} - ${BRAND.product}`,
    description: BRAND.description,
  },
  // TALK_MSGPUSH1 — Apple's Home-Screen-install meta tags. Next's Metadata API
  // emits the `apple-mobile-web-app-*` tags from `appleWebApp` and the
  // `<link rel="apple-touch-icon">` from `icons.apple`.
  // WAGGLES_PWA1 — apple-touch-icon now points at the square 192 PNG (the old
  // `/logo.png` was a non-square JPEG); the full icon set lives in manifest.ts.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: BRAND.name,
  },
  icons: {
    apple: `${BASE_PATH}/icon-192.png`,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* The shared constellation chrome (@honeycomb/shell). SHELLPORT_TALK1
            replaces the local astra-shell copy (VOTE-lineage) with the shared
            UniversalShell, per ONE_ROOF v2.2. */}
        <TalkShell>{children}</TalkShell>
        {/* WAGGLES_PWA1 — register the offline-shell service worker. */}
        <RegisterSW />
      </body>
    </html>
  );
}
