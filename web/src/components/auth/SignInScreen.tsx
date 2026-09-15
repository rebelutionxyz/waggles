'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SignInForm } from '@/components/auth/forms';
import { useSession } from '@/lib/auth';
import styles from './SignInScreen.module.css';

/**
 * AUTH_LOCAL2 — wraps the shared `SignInForm` (`@honeycomb/shell`) in this
 * app's own chrome. The form itself needs no astra-specific hook — it
 * reads `getShellSupabase()` directly, the same handle `TalkShell.tsx`
 * now wires on mount.
 */
export function SignInScreen({ next }: { next: string }) {
  const router = useRouter();
  const session = useSession();

  if (session.authEnabled && !session.ready) {
    return <div className={styles.wrap} aria-hidden="true" />;
  }

  if (!session.authEnabled || session.signedIn) {
    return (
      <div className={styles.wrap}>
        <span className="eyebrow">Sign in</span>
        <h1 className={styles.title}>
          {session.authEnabled ? "You're already signed in" : 'Sign-in runs on the live deployment'}
        </h1>
        <Link className={styles.link} href={next}>
          Continue &rarr;
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <span className="eyebrow">Sign in</span>
      <h1 className={styles.title}>Sign in to REBELUTION.talk</h1>
      {/* WAGGLES_F3: this used to read "The same account works across every
          REBELUTION site" — true of the constellation build, and FALSE here.
          The fork has its own project and its own auth realm; an account on
          this instance exists on this instance only. */}
      <p className={styles.sub}>Your account lives on this Waggles instance only.</p>
      <SignInForm onSignedIn={() => router.push(next)} />
    </div>
  );
}
