import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { HostConfig } from './config';

/**
 * Supabase client for the configured self-host endpoint. Unlike the web build
 * (a module-level singleton), the endpoint here is chosen at runtime by the Bee,
 * so the client is created after config loads (see initSupabase) and read via
 * getSupabase(). Sessions persist in AsyncStorage; no URL session detection (RN
 * has no window.location).
 */

let client: SupabaseClient | null = null;

export function initSupabase(cfg: HostConfig): SupabaseClient {
  client = createClient(cfg.url, cfg.anonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}

export function getSupabase(): SupabaseClient {
  if (!client) {
    throw new Error('Not connected. Set your self-host endpoint in Settings.');
  }
  return client;
}

export function hasSupabase(): boolean {
  return client !== null;
}

export function resetSupabase(): void {
  client = null;
}
