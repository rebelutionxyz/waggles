/* ============================================================
   Waggles (web) - Supabase clients.

   THE FORK'S OWN PROJECT AND ITS OWN AUTH REALM (WAGGLES_F3). The
   constellation version of this file shared one Supabase project and one
   account set with every astra, and carried the session in a
   Domain=.rebelution.app cookie, so a sign-in on one subdomain was a sign-in
   on all of them.

   Both are gone here. The URL and key come from the environment and nothing
   else - there is no default backend - and the session uses supabase-js
   DEFAULT storage, so it is scoped to THIS origin and shared with nobody.
   That is the AUTH_CROSSDOMAIN STRIP verdict in WAGGLES_FORK_PLAN v0.2: a
   self-hosted Waggles has no sibling subdomains to federate with, and a
   cookie scoped to someone else's parent domain would be both useless here
   and a leak.

   TWO CLIENTS, and the difference is load-bearing:

     browser  - persists the session, so `auth.uid()` is populated inside every
                RLS check. Join/leave writes run through this one, from a client
                component. Singleton per tab.

     server   - anon, no session, no persistence. Public reads only: the public
                groups list, one public group. Private groups are invisible to
                anon by policy - an SSR render has no uid to be.

   Never import the service-role key here. Everything a user does, a user does as
   themselves.
   ============================================================ */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function env(): { url: string; anon: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Waggles has NO default backend by design (WAGGLES_FORK_PLAN v0.2, ' +
        'ruling #4): point it at your own Supabase project in web/.env.local ' +
        '(see .env.example). It will not fall back to anyone else’s server.',
    );
  }
  return { url, anon };
}

let browserCached: SupabaseClient | null = null;

/** Session-carrying client. Browser only - throws if called during SSR. */
export function getBrowserClient(): SupabaseClient {
  if (typeof window === 'undefined') {
    throw new Error('getBrowserClient() is browser-only - server reads use getServerClient().');
  }
  if (browserCached) return browserCached;
  const { url, anon } = env();
  browserCached = createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // No `storage` override: supabase-js default (localStorage, this origin
      // only). The constellation set a Domain=.rebelution.app cookie here.
    },
  });
  return browserCached;
}

/** Anon client for SSR/ISR public reads. No session, ever. */
export function getServerClient(): SupabaseClient {
  const { url, anon } = env();
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Whichever client this execution context can legitimately use. */
export function getClient(): SupabaseClient {
  return typeof window === 'undefined' ? getServerClient() : getBrowserClient();
}

/** True when this call can carry a user identity at all. */
export function canAuthenticate(): boolean {
  return typeof window !== 'undefined';
}
