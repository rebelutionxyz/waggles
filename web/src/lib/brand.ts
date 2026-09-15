/* ============================================================
   Waggles - brand constants.

   `name` is the ONE on-page wordmark; every title, og and twitter tag derives
   from it (see app/layout.tsx), as do the manifest's name/short_name and the
   sign-in door. Change it here and the whole surface follows.

   WAGGLES_F7 (WAGGLES_CONCEPT v0.10, owner ruling): Waggles is a SEPARATE
   ENTITY from REBELUTION.talk, so this file no longer describes the TALK astra
   at all. It previously read `name: 'TALK'`, `domain: 'rebelution.talk'` and a
   description calling this "the messaging home of HONEYCOMB ... under the same
   login and balance as the rest of the constellation" - every clause of which
   is now false: the fork has its own project, its own auth realm, and no
   balance of any kind.

   METADATA-TRUTH RULE (this file is where it is easiest to break): the copy
   below may not claim more than the build delivers. v1 is END-TO-END ENCRYPTED
   ONE-TO-ONE TEXT, self-hosted. It deliberately does NOT have:
     - groups            (gated off; the fork's schema ships no group RPCs)
     - calls or voice    (a later fork pass)
     - media attachments (a later fork pass; text only today)
     - phone / PSTN      (no carrier surface exists)
     - push notifications (a later fork pass)
     - interop with a rebelution.talk instance (ROADMAP in v0.10, NOT built -
       and naming it here would read as a shipped feature)
   So none of those words appear in the description. If you add a feature, add
   the word then - not before.
   ============================================================ */

export const BRAND = {
  /** Wordmark as rendered in the sidebar, the door and page titles. */
  name: 'Waggles',
  /** Sub-line under the wordmark. */
  tagline: 'Your messages. Your server.',
  /** Product function, for metadata and copy. */
  product: 'Messages',
  /**
   * No canonical domain. Waggles is self-hosted: the instance a Bee uses is
   * whichever one its operator runs, so there is no one address to print.
   * Shown on the door in place of the old `rebelution.talk` chip.
   */
  selfHostedLabel: 'self-hosted',
  description:
    'End-to-end encrypted one-to-one messages you host yourself. ' +
    'Message bodies are sealed on your device before they are sent, so the ' +
    'server - even your own - stores only ciphertext.',
} as const;

/**
 * Canonical origin for absolute metadata / sitemap URLs.
 *
 * Set `NEXT_PUBLIC_SITE_URL` to the address YOUR instance is served from. The
 * fallback is localhost, not a vendor domain, for the same reason
 * `DEFAULT_HOST_URL` was dropped in WAGGLES_F2 (ruling #4): a self-hostable app
 * that defaults to someone else's address is not self-hosted. This value only
 * ever affects metadata URLs - it is not a backend endpoint.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
