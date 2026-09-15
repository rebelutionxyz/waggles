import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * SELF-HOST / SOVEREIGN endpoint configuration.
 *
 * Waggles is a sovereign messenger: it does not bake in a backend. You point it
 * at YOUR own Waggles backend (a Supabase project running the `db/` bundle's
 * schema + RPCs). You supply BOTH the project URL and its ANON key (a public,
 * client-safe value) — no key and no host ship in this repo.
 *
 * THERE IS DELIBERATELY NO DEFAULT HOST (WAGGLES_FORK_PLAN v0.2, RESOLVED
 * ruling #4, applied by WAGGLES_F2). This file used to export
 * `DEFAULT_HOST_URL = 'https://anxmqiehpyznifqgskzc.supabase.co'` — the
 * constellation project — and the setup screen pre-filled it, so an
 * unconfigured install silently became a client OF the constellation instead of
 * a self-hosted install. The fork keeps the constellation's RPC NAMES on
 * purpose (name-compatibility runs both ways), which means **this config
 * default was the only thing standing between "self-hostable" and
 * "constellation client."** An unconfigured install must now fail closed and
 * ask for a host; it can never reach someone else's backend by default.
 *
 * Optional convenience, never a fallback: if `EXPO_PUBLIC_WAGGLES_HOST_URL` is
 * set at build time, the setup screen pre-fills it. Unset — the shipped case —
 * the field starts empty. An operator opting into their own host is not the
 * same thing as a baked-in default, and nothing is contacted until the Bee
 * completes setup.
 *
 * Nothing here is a secret: the anon key is a public, RLS-gated client key. The
 * device identity SECRET key lives only in the OS keystore via expo-secure-store
 * (see e2ee.ts) and is never stored here.
 */

export interface HostConfig {
  url: string;
  anonKey: string;
}

const KEY = 'waggles.host.v1';

/**
 * Build-time pre-fill for the setup screen's host field, or '' when unset.
 *
 * NOT a default host and not a fallback: nothing reads this at connect time,
 * `getHostConfig()` still returns null until the Bee completes setup, and the
 * shipped build leaves it empty. It exists so an operator deploying their own
 * Waggles can save their users one paste — an opt-in by whoever runs the
 * build, which is the opposite of a vendor default.
 */
export const HOST_URL_PREFILL = process.env.EXPO_PUBLIC_WAGGLES_HOST_URL ?? '';

/**
 * Matching pre-fill for the anon/publishable key (WAGGLES_F2-ACK decision 2).
 *
 * Read from the environment, never hardcoded — `.env` is gitignored and
 * `.env.example` documents the variable with a placeholder, so no project's key
 * is committed to a public repo. A Supabase publishable key is client-safe by
 * design (it is RLS-gated and ships in every browser bundle), but "safe to
 * expose at runtime" is not "belongs in git": committing one bakes a specific
 * backend into the source of a self-hostable app, which is the same coupling
 * ruling #4 removed from the host URL.
 *
 * Same contract as the host pre-fill: empty in the shipped build, never read at
 * connect time, and the Bee can always type their own in setup.
 */
export const ANON_KEY_PREFILL = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

let cache: HostConfig | null = null;

function looksValid(c: unknown): c is HostConfig {
  const o = c as HostConfig | null;
  return (
    !!o &&
    typeof o.url === 'string' &&
    /^https?:\/\//i.test(o.url) &&
    typeof o.anonKey === 'string' &&
    o.anonKey.length > 20
  );
}

export async function getHostConfig(): Promise<HostConfig | null> {
  if (cache) return cache;
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as unknown;
    if (looksValid(c)) {
      cache = c;
      return c;
    }
  } catch {
    /* corrupt — treat as unconfigured */
  }
  return null;
}

export async function setHostConfig(cfg: HostConfig): Promise<void> {
  const clean: HostConfig = { url: cfg.url.trim().replace(/\/+$/, ''), anonKey: cfg.anonKey.trim() };
  if (!looksValid(clean)) throw new Error('Enter a valid https URL and anon key.');
  cache = clean;
  await AsyncStorage.setItem(KEY, JSON.stringify(clean));
}

export async function clearHostConfig(): Promise<void> {
  cache = null;
  await AsyncStorage.removeItem(KEY);
}
