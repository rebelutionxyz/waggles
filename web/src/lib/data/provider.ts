/* ============================================================
   REBELUTION.talk - the data seam.
   Every screen reads through here. Nothing else in the app imports
   `data/mock` or `data/supabase` directly.
   ============================================================ */

import type { TalkData } from '@/lib/contract';
import { mockTalkData } from '@/lib/data/mock';
import { supabaseTalkData } from '@/lib/data/supabase';

/**
 * `mock` (default) or `live`. Read from the environment, not inferred from
 * whether credentials happen to be present. NEXT_PUBLIC_ so the value is
 * identical in the server render and the browser bundle.
 */
const SOURCE = (process.env.NEXT_PUBLIC_DATA_SOURCE ?? 'mock').trim().toLowerCase();

export type DataSource = 'mock' | 'live';

export const DATA_SOURCE: DataSource = SOURCE === 'live' ? 'live' : 'mock';

/**
 * PRODUCTION MUST BE LIVE. Fails the BUILD, loudly, rather than shipping
 * fixtures to a public site. `next build` runs with NODE_ENV=production and
 * inlines NEXT_PUBLIC_* into the bundle, so this fires at BUILD time.
 * Required by DEPLOY AMENDMENT v2. No escape hatch.
 */
if (process.env.NODE_ENV === 'production' && DATA_SOURCE !== 'live') {
  throw new Error(
    'REFUSING TO BUILD: NEXT_PUBLIC_DATA_SOURCE is ' +
      (process.env.NEXT_PUBLIC_DATA_SOURCE === undefined
        ? 'unset'
        : `"${process.env.NEXT_PUBLIC_DATA_SOURCE}"`) +
      ', so this production build would serve FIXTURE data. ' +
      'Set NEXT_PUBLIC_DATA_SOURCE=live in your deployment environment and rebuild ' +
      '(the value is inlined at build time - changing it without a rebuild does nothing). ' +
      'See web/.env.example.',
  );
}

/** Server components and route handlers call this directly. */
export function getTalkData(): TalkData {
  return DATA_SOURCE === 'live' ? supabaseTalkData : mockTalkData;
}

/** Client components call this - a stable singleton, nothing to subscribe to. */
export function useTalkData(): TalkData {
  return getTalkData();
}
