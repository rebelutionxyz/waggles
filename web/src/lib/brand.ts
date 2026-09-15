/* ============================================================
   REBELUTION.talk - brand constants.

   `name` is the ONE on-page wordmark; every title, og and twitter tag derives
   from it (see app/layout.tsx). Mirrors the REBELUTION.vote/group brand.ts shape.

   TALK_CONCEPT v0.1: TALK is the door + astra skin over the EXISTING in-Manual
   messenger - not a second messaging app. `.chat` (open/random) is the one
   remaining reserved sibling door; this repo scaffolds the `.talk` home and
   reserves the `/chat` route surface. TALK_MF v0.4 (owner ruling, TALK_GROUPS1):
   `.tel` is RETIRED - no PSTN surface in TALK, outside-number calling is
   Waggles', not TALK's.
   ============================================================ */

export const BRAND = {
  /** Wordmark as rendered in the sidebar and page titles. */
  name: 'TALK',
  /** Sub-line under the wordmark. */
  tagline: 'One roof. Real messages.',
  /** Product function, for metadata and copy. */
  product: 'Messages',
  domain: 'rebelution.talk',
  /** Platform surface slug - LOCKED, never renamed. */
  surfaceSlug: 'talk',
  description:
    'The messaging home of HONEYCOMB - DMs and groups, end-to-end encrypted, under the same login and ' +
    'balance as the rest of the constellation. .chat (open/random) is the reserved sibling ' +
    'door on the same product.',
} as const;

/** Canonical origin for absolute metadata / sitemap URLs. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://rebelution.talk';
