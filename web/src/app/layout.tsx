import type { Metadata } from 'next';
import { BRAND, SITE_URL } from '@/lib/brand';
import { TalkShell } from '@/components/shell/TalkShell';
import './globals.css';

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
  // TALK_MSGPUSH1 — Apple's Home-Screen-install meta tags, confirmed absent
  // before this pass (`TALK_PUSH1`'s report). Next's Metadata API emits the
  // `apple-mobile-web-app-*` tags from `appleWebApp` and the
  // `<link rel="apple-touch-icon">` from `icons.apple` — no manual <meta> in
  // the JSX below needed. `logo.png` is the only asset in the repo (see
  // `manifest.ts`'s own note on it actually being a non-square JPEG).
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: BRAND.name,
  },
  icons: {
    apple: '/logo.png',
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
      </body>
    </html>
  );
}
