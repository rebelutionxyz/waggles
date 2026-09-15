import type { Session } from '@supabase/supabase-js';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getHostConfig } from './config';
import { forgetCurrentBee, initComms } from './comms';
import { wipeDeviceIdentity } from './e2ee';
import { clearAllCache } from './cache';
import { getSupabase, hasSupabase, initSupabase, resetSupabase } from './supabase';

interface AuthState {
  booting: boolean;
  connected: boolean; // a self-host endpoint is configured + client built
  session: Session | null;
  beeId: string | null;
  /** Rebuild the client from freshly-saved host config (after Settings save). */
  reconnect: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [connected, setConnected] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  async function connectFromConfig(): Promise<boolean> {
    const cfg = await getHostConfig();
    if (!cfg) {
      setConnected(false);
      return false;
    }
    if (!hasSupabase()) initSupabase(cfg);
    setConnected(true);
    return true;
  }

  useEffect(() => {
    let unsub: (() => void) | null = null;
    (async () => {
      const ok = await connectFromConfig();
      if (ok) {
        const { data } = await getSupabase().auth.getSession();
        setSession(data.session ?? null);
        const sub = getSupabase().auth.onAuthStateChange((_e, s) => setSession(s));
        unsub = () => sub.data.subscription.unsubscribe();
      }
      setBooting(false);
    })();
    return () => {
      if (unsub) unsub();
    };
  }, []);

  // Publish the E2EE identity key whenever a Bee is signed in.
  useEffect(() => {
    const beeId = session?.user?.id;
    if (beeId) initComms(beeId).catch(() => {});
  }, [session?.user?.id]);

  const value = useMemo<AuthState>(
    () => ({
      booting,
      connected,
      session,
      beeId: session?.user?.id ?? null,
      reconnect: async () => {
        resetSupabase();
        setConnected(false);
        const ok = await connectFromConfig();
        if (ok) {
          const { data } = await getSupabase().auth.getSession();
          setSession(data.session ?? null);
        }
      },
      signOut: async () => {
        const beeId = session?.user?.id;
        try {
          if (hasSupabase()) await getSupabase().auth.signOut();
        } catch {
          /* ignore */
        }
        if (beeId) await wipeDeviceIdentity(beeId);
        forgetCurrentBee();
        await clearAllCache();
        setSession(null);
      },
    }),
    [booting, connected, session],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used within AuthProvider');
  return v;
}
