-- ============================================================================
-- WAGGLES CORE v0.1 — 001 SCHEMA
--
-- WAGGLES_F1 (2026-09-15). Extracted from the HONEYCOMB constellation project
-- `anxmqiehpyznifqgskzc` by reading `pg_get_functiondef` / `pg_get_constraintdef`
-- / `pg_indexes` / `pg_policy` live, 2026-09-15. Read-only extraction; nothing
-- was applied there and this bundle does not belong in that database.
--
-- SCOPE: the MVP of WAGGLES_FORK_PLAN v0.1 §2.2 — E2EE 1:1 TEXT. Groups,
-- reactions, pins, rooms, calls, push, media and disappearing messages are
-- deliberately NOT here; they are F5/F6 and later.
--
-- ── THE ONE RENAME ──────────────────────────────────────────────────────────
-- `bees` → `profiles`. That is the ONLY identity rename in this bundle, and
-- everything else keeps the constellation's spelling on purpose:
--
--   * the COLUMNS stay `bee_id` / `sender_bee_id` / `blocker_bee_id`,
--   * the TABLE `bee_keys` stays `bee_keys`,
--   * every RPC keeps its exact constellation name (`comms_send`,
--     `bee_register_key`, `comms_put_conversation_keys`, …).
--
-- WHY: `Waggles.app` — the working Expo client that already exists — calls
-- these names today. Renaming them would fork the client as well as the
-- backend, for cosmetics. The fork's cost should be paid once, in the schema,
-- not again in every call site of two clients. A later pass may rename with a
-- compatibility layer; F1 is not that pass.
--
-- ── WHAT CHANGED vs. THE CONSTELLATION, AND WHY ────────────────────────────
-- 1. `profiles` CARRIES NO EMAIL. The constellation's `bees` has a NOT NULL
--    `email` and a `bees_public_read USING (true)` policy — i.e. every signed-in
--    user can read every other user's email address. That is a constellation
--    decision the fork should not inherit silently. `auth.users` already holds
--    the email; a self-hosted instance does not need a second, world-readable
--    copy. This is a deliberate narrowing, not an oversight.
-- 2. `bling_*`, `honeycomb_ring`, `action_count`, `is_admin`, `stripe_customer_id`
--    and `handle_changed_at` are gone — constellation economy and moderation
--    columns with no meaning in a fork.
-- 3. `bee_follows` is gone entirely. A fork has no social graph
--    (WAGGLES_FORK_PLAN v0.1 §1.4). Start-a-chat is handle lookup, which is
--    what the `profiles_handle_key` unique index below exists to serve.
-- 4. `notifications` is gone — see 003, `comms_send`.
-- ============================================================================

-- `gen_random_uuid()` is in core Postgres 13+, but a fresh Supabase project may
-- be older, and pgcrypto is present there by default. Harmless when redundant.
create extension if not exists pgcrypto;

-- ── identity ────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  handle       text not null,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Same handle grammar the constellation enforces (`^[a-z0-9_-]{2,30}$`), so a
  -- handle that is valid in one is valid in the other. The `@comb*` reservation
  -- is NOT carried over: that is a constellation namespace rule, and a
  -- self-hosted instance has no system bees to protect.
  constraint profiles_handle_format check (handle ~ '^[a-z0-9_-]{2,30}$')
);

create unique index if not exists profiles_handle_key
  on public.profiles (lower(handle));

-- ── E2EE device keys ────────────────────────────────────────────────────────
-- Copied from the constellation's `bee_keys` verbatim in shape. One row per
-- (account, device): X25519 public key, and optionally the account's secret key
-- encrypted under a passphrase-derived KDF for restore. The server never sees a
-- plaintext secret key — `encrypted_secret_key` is ciphertext the client made.

create table if not exists public.bee_keys (
  bee_id               uuid not null references public.profiles(id) on delete cascade,
  device_id            text not null,
  public_key           text not null,
  key_algo             text not null default 'x25519',
  encrypted_secret_key text,
  backup_kdf           jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (bee_id, device_id)
);

-- ── conversations ───────────────────────────────────────────────────────────
-- `kind` keeps the 'group' option even though groups are out of MVP scope: the
-- CHECK is one word, and widening a CHECK later is a migration while the column
-- values are already written. Nothing in this bundle creates a group.

create table if not exists public.comms_conversations (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null,
  title             text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  last_message_at   timestamptz,
  members_can_add   boolean not null default false,
  disappear_seconds integer,
  constraint comms_conversations_kind_check
    check (kind = any (array['direct'::text, 'group'::text])),
  constraint comms_conversations_disappear_seconds_check
    check (disappear_seconds is null
           or (disappear_seconds >= 60 and disappear_seconds <= 2592000))
);

create table if not exists public.comms_participants (
  conversation_id uuid not null references public.comms_conversations(id) on delete cascade,
  bee_id          uuid not null references public.profiles(id) on delete cascade,
  role            text not null default 'member',
  joined_at       timestamptz not null default now(),
  -- Unread in the fork is `last_read_at` vs. the conversation's
  -- `last_message_at`. That is the whole unread mechanism now that the
  -- constellation `notifications` inbox is gone — see 003, `comms_send`.
  last_read_at    timestamptz,
  muted           boolean not null default false,
  primary key (conversation_id, bee_id),
  constraint comms_participants_role_check
    check (role = any (array['owner'::text, 'member'::text]))
);

create index if not exists comms_participants_bee
  on public.comms_participants (bee_id);

-- ── messages ────────────────────────────────────────────────────────────────
-- `body` is ALWAYS ciphertext on this fork: `comms_send` refuses
-- `is_encrypted = false` outright (003). The column default of `false` is kept
-- only so the constraint lives in exactly one place — the RPC — rather than
-- being half-stated in two.

create table if not exists public.comms_messages (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references public.comms_conversations(id) on delete cascade,
  sender_bee_id       uuid references public.profiles(id) on delete set null,
  body                text not null,
  content_type        text not null default 'text',
  is_encrypted        boolean not null default false,
  key_epoch           integer not null default 1,
  reply_to_message_id uuid references public.comms_messages(id) on delete set null,
  created_at          timestamptz not null default now(),
  edited_at           timestamptz,
  deleted_at          timestamptz,
  expires_at          timestamptz
);

create index if not exists comms_messages_conv_time
  on public.comms_messages (conversation_id, created_at desc);

-- Kept although disappearing messages are out of MVP scope: the column exists
-- (it is written by `comms_send` when a conversation has a TTL), and an index
-- added later against a populated table is a lock this bundle can avoid now.
create index if not exists comms_messages_expires_at_idx
  on public.comms_messages (expires_at) where expires_at is not null;

-- ── blocking ────────────────────────────────────────────────────────────────
-- Symmetric in effect: `comms_is_blocked` checks both directions, so one side
-- blocking stops the conversation both ways.

create table if not exists public.comms_blocks (
  blocker_bee_id uuid not null references public.profiles(id) on delete cascade,
  blocked_bee_id uuid not null references public.profiles(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (blocker_bee_id, blocked_bee_id),
  constraint comms_blocks_check check (blocker_bee_id <> blocked_bee_id)
);

-- ── wrapped per-conversation keys ───────────────────────────────────────────
-- The conversation key (CK) is generated client-side and stored once per
-- (conversation, account, device, epoch), sealed to that device's X25519 public
-- key with `crypto_box_seal`. The server stores sealed blobs it cannot open.
-- The LiveKit SFrame media key is derived from the CK client-side and is never
-- transmitted at all (relevant from F6 onward, not MVP).

create table if not exists public.comms_conversation_keys (
  conversation_id uuid not null references public.comms_conversations(id) on delete cascade,
  bee_id          uuid not null references public.profiles(id) on delete cascade,
  device_id       text not null,
  epoch           integer not null default 1,
  wrapped_key     text not null,
  wrapped_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (conversation_id, bee_id, device_id, epoch)
);

create index if not exists comms_conversation_keys_bee
  on public.comms_conversation_keys (bee_id);
