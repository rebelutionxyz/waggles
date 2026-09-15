'use client';

/* .talk — the PROFILE drawer (SHELL_LINKS1, AUTH_CROSSDOMAIN v2.1 owner
 * ruling 2026-09-12: no user-facing surface may bounce to themanual.tech).
 * Ported from REBELUTION.org's/h24's ProfilePanel.tsx (KNOW_PROFILE1
 * pattern): the avatar opens this quick-look drawer on-astra instead of
 * bouncing off-astra.
 *
 * SCOPED DOWN from the org/h24 template: .talk's own session (`lib/auth.ts`)
 * resolves no `bees.handle`/`avatar_url` today — TalkShell.tsx's header
 * already stands in with the signed-in email (see its own `handle` line) —
 * and this app has no /profile route to link to. This drawer shows exactly
 * what the session actually knows (email, sign out) rather than inventing a
 * handle lookup or a destination that doesn't exist yet.
 *
 * SIDEBAR_LOGIN1 (owner ruling 2026-09-12, ENTITY_PAGE_SPEC v1.2 §4: the
 * inline sign-in law includes sidebars) — signed-out now renders the shared
 * AuthGate in place instead of a "Sign in →" link away to /sign-in (the same
 * shared SignInForm the astra's own Door.tsx already mounts, per AUTH_LOCAL2).
 */

import { useRouter } from 'next/navigation';
import { AuthGate } from '@/components/auth/forms';
import { signOut, useSession } from '@/lib/auth';

function Row({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '9px 10px',
        borderTop: '1px solid var(--hairline)',
        color: 'var(--body)',
        fontSize: 13,
        cursor: 'pointer',
        background: 'transparent',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--body)')}
    >
      {label}
    </button>
  );
}

export function ProfilePanel({ onClose }: { onClose: () => void }) {
  const session = useSession();
  const router = useRouter();

  if (!session.ready) return null;

  if (!session.signedIn) {
    return (
      <div style={{ padding: 12, color: 'var(--body)' }}>
        <AuthGate
          session={{ status: 'signed-out' }}
          // WAGGLES_F3 — was "the same account works across every REBELUTION
          // site"; the fork has its own auth realm, so that is no longer true.
          reason="Sign in to this Waggles instance."
          onSignedIn={() => router.refresh()}
        >
          {null}
        </AuthGate>
      </div>
    );
  }

  return (
    <div style={{ padding: 12, color: 'var(--body)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            overflow: 'hidden',
            background: 'var(--accent-bg)',
            border: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent)',
            fontSize: 14,
            textTransform: 'uppercase',
          }}
        >
          {(session.email ?? '·').slice(0, 1)}
        </span>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: 'var(--ink)',
              fontSize: 14,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {session.email ?? 'Your seat'}
          </div>
        </div>
      </div>

      <Row
        label="Sign out"
        onClick={() => {
          void signOut().then(() => {
            onClose();
            router.refresh();
          });
        }}
      />
    </div>
  );
}
