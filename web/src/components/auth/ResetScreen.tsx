'use client';

import { useState } from 'react';
import Link from 'next/link';
import { NewPasswordForm } from '@/components/auth/forms';
import { useSession } from '@/lib/auth';
import styles from './ResetScreen.module.css';

/**
 * RESET_ROUTES1 — wraps the shared `NewPasswordForm` (`@honeycomb/shell`) in
 * this app's own chrome, the same shape `SignInScreen` already uses for
 * `/sign-in`. Clicking the "Forgot password?" email link (`SignInForm`'s
 * `resetPasswordForEmail` call) gives Supabase's client SDK a recovery
 * session before this component ever mounts, so `useSession()` — the same
 * hook `SignInScreen` uses — already tells us honestly whether there is
 * one: `signedIn` true (once `ready`) means a session exists (recovery or
 * otherwise) and `updateUser` will work; `signedIn` false means the link
 * was invalid, expired, or already used, and we say so instead of
 * rendering a dead form.
 */
export function ResetScreen() {
  const session = useSession();
  const [done, setDone] = useState(false);

  if (session.authEnabled && !session.ready) {
    return <div className={styles.wrap} aria-hidden="true" />;
  }

  if (!session.authEnabled) {
    return (
      <div className={styles.wrap}>
        <span className="eyebrow">Reset password</span>
        <h1 className={styles.title}>Reset runs on the live deployment</h1>
      </div>
    );
  }

  if (!session.signedIn) {
    return (
      <div className={styles.wrap}>
        <span className="eyebrow">Reset password</span>
        <h1 className={styles.title}>This reset link is invalid or has expired</h1>
        <p className={styles.sub}>Request a new one from sign-in.</p>
        <Link className={styles.link} href="/sign-in">
          Back to sign in &rarr;
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className={styles.wrap}>
        <span className="eyebrow">Reset password</span>
        <h1 className={styles.title}>Password updated</h1>
        <Link className={styles.link} href="/">
          Continue &rarr;
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <span className="eyebrow">Reset password</span>
      <h1 className={styles.title}>Set a new password</h1>
      <NewPasswordForm onDone={() => setDone(true)} />
    </div>
  );
}
