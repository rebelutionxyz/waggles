import type { Metadata } from 'next';
import { BRAND } from '@/lib/brand';

/* WAGGLES_PWA1 — the offline fallback. The service worker serves this static
 * page for navigations when the network is unavailable. It deliberately holds
 * NO user data (no messages, no keys, no account state) — it is only cached
 * shell, so it is safe to persist on-device. */
export const metadata: Metadata = {
  title: 'Offline',
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
        textAlign: 'center',
        background: '#07080A',
        color: '#F5F5F4',
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>You&rsquo;re offline</h1>
      <p style={{ fontSize: 15, lineHeight: 1.5, color: '#A1A1AA', maxWidth: 420, margin: 0 }}>
        {BRAND.name} needs a connection to reach the server you host. Your messages are
        end-to-end encrypted and are never stored here &mdash; reconnect and they&rsquo;ll be
        waiting.
      </p>
    </main>
  );
}
