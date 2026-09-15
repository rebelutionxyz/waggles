'use client';

/* ============================================================
   Session state for the signed-in surfaces.

   A user signs in on rebelution.talk directly - separate domain, the SAME
   HONEYCOMB account, because both apps talk to the same Supabase project.

   In MOCK mode there is no session and none is needed: the mock provider always
   answers as its fixture member. (Cloned from the REBELUTION.vote template.)
   ============================================================ */

import { useEffect, useState } from 'react';
import { DATA_SOURCE } from '@/lib/data/provider';
import { MY_BEE_ID as MOCK_MY_BEE_ID } from '@/lib/data/mock';
import { getBrowserClient } from '@/lib/supabase/client';

export interface SessionState {
  ready: boolean;
  signedIn: boolean;
  email: string | null;
  /** The signed-in Bee's id (`auth.uid()`) - null when signed out or in mock mode. */
  beeId: string | null;
  authEnabled: boolean;
}

const MOCK_SESSION: SessionState = {
  ready: true,
  signedIn: false,
  email: null,
  // TALK_GROUPS1: the SAME id data/mock.ts's fixture uses for its own "you"
  // row - see MY_BEE_ID's comment there for why null broke "who is the
  // other participant" everywhere a DM needed to know.
  beeId: MOCK_MY_BEE_ID,
  authEnabled: false,
};

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>(
    DATA_SOURCE === 'live'
      ? { ready: false, signedIn: false, email: null, beeId: null, authEnabled: true }
      : MOCK_SESSION,
  );

  useEffect(() => {
    if (DATA_SOURCE !== 'live') return;
    const client = getBrowserClient();
    let live = true;

    void client.auth.getSession().then(({ data }) => {
      if (!live) return;
      setState({
        ready: true,
        signedIn: Boolean(data.session),
        email: data.session?.user.email ?? null,
        beeId: data.session?.user.id ?? null,
        authEnabled: true,
      });
    });

    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      if (!live) return;
      setState({
        ready: true,
        signedIn: Boolean(session),
        email: session?.user.email ?? null,
        beeId: session?.user.id ?? null,
        authEnabled: true,
      });
    });

    return () => {
      live = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}

/**
 * The HONEYCOMB login/handle flow (CAMPAIGN v1.0): a user signs in with their
 * email; a prior HONEYCOMB registration is offered for reuse. This scaffold
 * ships the magic-link entry point; the handle-reuse prompt is a tweak-week
 * refinement. Live mode only.
 */
export async function signInWithEmail(email: string): Promise<{ error: string | null }> {
  if (DATA_SOURCE !== 'live') return { error: 'Sign-in is only available on the live deployment.' };
  const { error } = await getBrowserClient().auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined },
  });
  return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
  if (DATA_SOURCE !== 'live') return;
  await getBrowserClient().auth.signOut();
}
