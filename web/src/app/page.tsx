import type { Metadata } from 'next';
import { BRAND } from '@/lib/brand';
import { TalkHome } from '@/components/talk/TalkHome';

export const metadata: Metadata = {
  title: BRAND.product,
  description: BRAND.description,
  alternates: { canonical: '/' },
};

interface HomeProps {
  searchParams: Promise<{ q?: string }>;
}

/**
 * THE ASTRA HOME (TALK_CONCEPT v0.1 s2). Signed-out door vs. messaging-first
 * two-pane view is resolved client-side in <TalkHome> - session state and the
 * live conversation list both need the browser's Supabase client (SSR has no
 * `auth.uid()`), matching the pattern the VOTE Composer already established.
 *
 * MENU_TALK1 - `?q=` from the sidebar's shared SidebarSearch is read here
 * (the one server-side hop this page needs) and handed down as a plain prop;
 * `<TalkHome>` does the actual (client-side, session-gated) fetch.
 */
export default async function TalkHomePage({ searchParams }: HomeProps) {
  const { q } = await searchParams;
  return <TalkHome initialSearch={q} />;
}
