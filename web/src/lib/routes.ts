/* ============================================================
   TALK_CONVURL1 - the per-conversation URL, in one place.

   TALK's routing idiom is plain Next App Router segments (`/chat`,
   `/sign-in`, `/reset`), so a conversation is `/c/<conversationId>` - short,
   because it is the shape old `/comms/<id>` push deep-links redirect INTO
   (see `next.config.mjs`), and those links are already in the wild.

   BASE PATH. `next.config.mjs` roots this app at `/` standalone and at
   `/talk` behind the manual's proxy (`NEXT_PUBLIC_BASE_PATH`). Next strips
   the base path from `usePathname()` but does NOT add it to a raw
   `window.history.pushState` - that is the whole reason these two directions
   are a shared helper rather than a template literal at each call site.
   ============================================================ */

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** `?q=` is the sidebar search (MENU_TALK1); it survives opening a thread. */
function withSearch(path: string, search?: string): string {
  return search ? `${path}?q=${encodeURIComponent(search)}` : path;
}

/** A browser-absolute URL for a conversation, base path included. */
export function conversationPath(conversationId: string, search?: string): string {
  return withSearch(`${BASE_PATH}/c/${encodeURIComponent(conversationId)}`, search);
}

/** The messages home (the conversation list), base path included. */
export function homePath(search?: string): string {
  return withSearch(BASE_PATH || '/', search);
}

/**
 * The conversation id in a `usePathname()` value, or null on any other route.
 * Takes the base-path-STRIPPED form Next hands components, and tolerates a
 * trailing slash. Nested segments never match: `/c/<id>/anything` is not a
 * conversation URL.
 */
export function parseConversationPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const match = /^\/c\/([^/]+)\/?$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}
