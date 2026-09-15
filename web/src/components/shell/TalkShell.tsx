'use client';

/*
 * WaggleShell — the fork's OWN chrome (WAGGLES_F3).
 *
 * The constellation version of this file wore `@honeycomb/shell`'s
 * `UniversalShell`, with `ASTRA_TOKENS.talk`, `SidebarSearch`,
 * `setShellSupabase`, a BLiNG! ledger button and a push banner. The fork
 * REPLACES `@honeycomb/shell` outright (WAGGLES_FORK_PLAN v0.2 dependency
 * verdicts) — a self-hostable messenger cannot depend on a private workspace
 * package that nobody outside the constellation can install. So this is a
 * deliberately small, local shell rather than a port of that one:
 *
 *  - no `UniversalShell`     — a sidebar + content column, written here.
 *  - no `ASTRA_TOKENS`       — the plan keeps token NAMES and replaces VALUES;
 *                              the values live in `src/styles/tokens.css`.
 *  - no `setShellSupabase`   — that existed only to hand the shared package a
 *                              client; the fork's own auth forms take it
 *                              directly.
 *  - no BLiNG! ledger button — `bling` is STRIP (and it pointed at
 *                              bling.rebelution.app, a constellation host).
 *  - no push banner / `registerPush` — push is F5, with its own VAPID pair.
 *  - no `CallProvider`       — calls are F6, and v1 MVP is E2EE 1:1 text.
 *
 * "Open / Random" is kept as a nav item because the route still exists; it is
 * a door, not a call.
 */

import { Inbox, Sparkles } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { ProfilePanel } from '@/components/shell/ProfilePanel';
import { useSession } from '@/lib/auth';

interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
  href: string;
}

const NAV: { id: string; label?: string; items: NavItem[] }[] = [
  {
    id: 'talk',
    items: [{ id: 'messages', label: 'Messages', icon: <Inbox size={17} />, href: '/' }],
  },
  {
    id: 'doors',
    label: 'Doors',
    items: [{ id: 'chat', label: 'Open / Random', icon: <Sparkles size={17} />, href: '/chat' }],
  },
];

/*
 * Which nav item is current (WAGGLES_F4).
 *
 * A plain `pathname === href` left NO item highlighted on a conversation
 * route: `/c/<id>` equals neither `/` nor `/chat`, so opening a thread —
 * the thing you spend all your time in — silently dropped the sidebar
 * highlight. Caught in the F4 live run. Messages owns the conversation
 * routes; every other item still matches exactly, so `/` does not light up
 * for `/chat`.
 */
function isActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/' || pathname.startsWith('/c/');
  return pathname === href;
}

export function TalkShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const session = useSession();
  const [profileOpen, setProfileOpen] = useState(false);
  const [query, setQuery] = useState('');

  return (
    <div className="waggle-shell">
      <aside className="waggle-sidebar">
        <div className="waggle-brand">Waggles</div>

        <form
          className="waggle-search"
          onSubmit={(e) => {
            e.preventDefault();
            const q = query.trim();
            router.push(q ? `/?q=${encodeURIComponent(q)}` : '/');
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
          />
        </form>

        <nav>
          {NAV.map((group) => (
            <div key={group.id} className="waggle-nav-group">
              {group.label && <div className="waggle-nav-label">{group.label}</div>}
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={isActive(item.href, pathname) ? 'waggle-nav-item is-active' : 'waggle-nav-item'}
                  aria-current={isActive(item.href, pathname) ? 'page' : undefined}
                  onClick={() => router.push(item.href)}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <button type="button" className="waggle-seat" onClick={() => setProfileOpen(true)}>
          {session.signedIn ? (session.email ?? 'Your seat') : 'Sign in'}
        </button>
      </aside>

      <main className="waggle-content">{children}</main>

      {profileOpen && (
        <div className="waggle-panel" role="dialog" aria-label={session.signedIn ? 'Your seat' : 'Sign in'}>
          <ProfilePanel onClose={() => setProfileOpen(false)} />
        </div>
      )}
    </div>
  );
}
