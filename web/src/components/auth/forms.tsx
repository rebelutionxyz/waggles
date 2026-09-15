'use client';

/*
 * Waggles' OWN auth forms (WAGGLES_F3).
 *
 * These replace `SignInForm`, `NewPasswordForm` and `AuthGate`, which the
 * constellation build imported from `@honeycomb/shell`. The fork REPLACES that
 * package outright (WAGGLES_FORK_PLAN v0.2): it is a private workspace package,
 * so a self-hoster cloning this repo could not install it, and a messenger whose
 * sign-in screen cannot be built from its own source is not self-hostable in any
 * meaningful sense.
 *
 * Same PROP CONTRACTS as the components they replace, so the four call sites
 * (`SignInScreen`, `Door`, `ResetScreen`, `ProfilePanel`) are untouched:
 *   SignInForm      { onSignedIn }
 *   NewPasswordForm { onDone }
 *   AuthGate        { session, reason, onSignedIn, children }
 *
 * Email + password, both co-equal and permanent (AUTH_METHOD): sign in, create
 * an account, or ask for a reset link. No magic-link-only path, which is what
 * `Door` used to hand-roll before it mounted the shared form.
 *
 * Every call goes through `getBrowserClient()` — the fork's own project, its own
 * auth realm, supabase-js default (origin-scoped) session storage. There is no
 * cross-domain cookie and no shared account set.
 */

import { type ReactNode, useState } from 'react';
import { getBrowserClient } from '@/lib/supabase/client';

type Mode = 'sign-in' | 'create' | 'forgot';

function describe(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Try again.';
}

export function SignInForm({ onSignedIn }: { onSignedIn?: () => void }) {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    setBusy(true);
    try {
      const sb = getBrowserClient();
      if (mode === 'forgot') {
        const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset`,
        });
        if (error) throw new Error(error.message);
        setNotice('Check your email for a reset link.');
        return;
      }
      if (mode === 'create') {
        const { error } = await sb.auth.signUp({ email: email.trim(), password });
        if (error) throw new Error(error.message);
        // Whether a session exists now depends on the project's email-confirm
        // setting, so say what is true rather than guessing.
        const { data } = await sb.auth.getSession();
        if (data.session) onSignedIn?.();
        else setNotice('Account created. Confirm your email, then sign in.');
        return;
      }
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(error.message);
      onSignedIn?.();
    } catch (e2) {
      setErr(describe(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="waggle-auth">
      <label>
        <span>Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      {mode !== 'forgot' && (
        <label>
          <span>Password</span>
          <input
            type="password"
            autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      )}

      {err && <p className="waggle-auth-error">{err}</p>}
      {notice && <p className="waggle-auth-notice">{notice}</p>}

      <button type="submit" disabled={busy}>
        {busy
          ? 'Working…'
          : mode === 'create'
            ? 'Create account'
            : mode === 'forgot'
              ? 'Send reset link'
              : 'Sign in'}
      </button>

      <div className="waggle-auth-switch">
        {mode !== 'sign-in' && (
          <button type="button" onClick={() => setMode('sign-in')}>
            Sign in instead
          </button>
        )}
        {mode !== 'create' && (
          <button type="button" onClick={() => setMode('create')}>
            Create an account
          </button>
        )}
        {mode !== 'forgot' && (
          <button type="button" onClick={() => setMode('forgot')}>
            Forgot password?
          </button>
        )}
      </div>
    </form>
  );
}

export function NewPasswordForm({ onDone }: { onDone?: () => void }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password !== again) {
      setErr('Those two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      // The recovery link gives supabase-js a session before this mounts, so
      // updateUser is authenticated as the account being recovered.
      const { error } = await getBrowserClient().auth.updateUser({ password });
      if (error) throw new Error(error.message);
      onDone?.();
    } catch (e2) {
      setErr(describe(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="waggle-auth">
      <label>
        <span>New password</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        <span>New password again</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
      </label>
      {err && <p className="waggle-auth-error">{err}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Set password'}
      </button>
    </form>
  );
}

/**
 * Renders `children` when signed in, and the sign-in form when not.
 *
 * `session` is accepted for call-site compatibility with the component this
 * replaces. It is only consulted as a hint: the real answer comes from
 * supabase-js, so a stale prop cannot wrongly reveal a signed-in view.
 */
export function AuthGate({
  session,
  reason,
  onSignedIn,
  children,
}: {
  session?: { status?: string };
  reason?: string;
  onSignedIn?: () => void;
  children?: ReactNode;
}) {
  const [signedIn, setSignedIn] = useState(session?.status === 'signed-in');

  if (signedIn) return <>{children}</>;

  return (
    <div className="waggle-auth-gate">
      {reason && <p className="waggle-auth-reason">{reason}</p>}
      <SignInForm
        onSignedIn={() => {
          setSignedIn(true);
          onSignedIn?.();
        }}
      />
    </div>
  );
}
