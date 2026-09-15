/** @type {import('next').NextConfig} */

/*
 * Waggles (web) — Next config (WAGGLES_F3).
 *
 * Deliberately small. The constellation version of this file carried three
 * things the fork does not want, all removed here:
 *
 *  - `experimental.externalDir` plus turbopack/webpack `resolveAlias` entries.
 *    Those existed ONLY so Next could compile `@honeycomb/shell` from
 *    `../shared/shell/src`, outside the app directory. The fork replaces that
 *    package with its own components, so nothing resolves outside this folder
 *    any more — which is also what makes the repo cloneable by a self-hoster
 *    who has no `shared/` tree.
 *  - `/comms` → `/` redirects. Those landed already-delivered constellation
 *    push notifications whose deep links pointed at a retired route. A fresh
 *    Waggles install has no such history and no such notifications.
 *  - the workspace-relative import surface generally.
 *
 * BASE PATH IS ENV-DRIVEN, default deliberately empty: Waggles roots at `/`.
 * `NEXT_PUBLIC_` because basePath is baked into every asset URL at BUILD time,
 * so changing it needs a rebuild.
 */

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig = {
  reactStrictMode: true,
  basePath,
};

export default nextConfig;
