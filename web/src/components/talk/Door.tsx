'use client';

/* ============================================================
   THE DOOR (TALK_CONCEPT v0.1 s2/s4) - signed-out landing. Brands TALK and
   hands into the ONE roof: same HONEYCOMB account, same login flow every
   astra uses. Never a separate auth world - per DOMAINS_MAP v2.2,
   rebelution.* front doors never host logged-in pages.

   AUTH_LOCAL2 — stopped hand-rolling its own email-only form here (it
   never offered a password, which AUTH_METHOD v0.2 requires as a
   permanent, co-equal method) and mounts the shared `SignInForm`
   (`@honeycomb/shell`) in place instead — the SAME component `/sign-in`
   mounts, so `/` and `/sign-in` are one real capability, not two
   diverging auth UIs. `signInWithEmail`/`src/lib/auth.ts` is unchanged
   and still used elsewhere (`useSession`) — only this form's own
   hand-rolled submit path is retired.
   ============================================================ */

import { SignInForm } from '@/components/auth/forms';
import { BRAND } from '@/lib/brand';
import styles from './Door.module.css';

export function Door() {
  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <span className="eyebrow">{BRAND.domain}</span>
        <h1 className={styles.title}>{BRAND.name}</h1>
        <p className={styles.sub}>{BRAND.description}</p>

        <div className={styles.doors}>
          <span className={styles.doorChip}>.talk - messages</span>
          <span className={styles.doorChip}>.chat - open/random</span>
        </div>

        {/* No explicit action needed: TalkHome's own useSession() shares the
            same Supabase client SignInForm just signed in on, so its
            onAuthStateChange subscription flips session.signedIn reactively
            and TalkHome stops rendering Door on its own next render. */}
        <SignInForm onSignedIn={() => {}} />
      </div>
    </div>
  );
}
