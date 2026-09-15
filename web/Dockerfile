# SHIP_TALK1 (SHIP_KIT v1, 2026-09-08) — the .org/.vote Railway ship pattern.
# Railway: Root Directory = (blank), Config file = REBELUTION.talk/railway.json.
# SHELLPORT_TALK1 moved TALK off its own src/components/astra-shell copy onto
# @honeycomb/shell (../shared/shell) — the build context is the MONOREPO so
# that path exists. tsconfig.json: @honeycomb/shell -> ../shared/shell/src.
# ANY new ../shared/<pkg> alias added there needs a matching COPY here or the
# Docker build fails with "Module not found" while the local build passes
# (scripts/docker-alias-check.mjs, a prebuild guard, catches a drifted list
# before this Dockerfile does). This app carries only @honeycomb/shell today.
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# the shared package this app's tsconfig "@honeycomb/*" path alias points at
COPY shared/shell ./shared/shell
# deps first (layer cache)
COPY REBELUTION.talk/package.json REBELUTION.talk/package-lock.json ./REBELUTION.talk/
RUN cd REBELUTION.talk && npm ci --no-audit --no-fund
# the app
COPY REBELUTION.talk ./REBELUTION.talk
# NEXT_PUBLIC_* bake at build time — threaded in via railway.json buildArgs
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_DATA_SOURCE
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_BASE_PATH
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_DATA_SOURCE=$NEXT_PUBLIC_DATA_SOURCE \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
RUN cd REBELUTION.talk && npm run build

FROM node:22-alpine
WORKDIR /app/REBELUTION.talk
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/REBELUTION.talk ./
COPY --from=build /app/shared ../shared
EXPOSE 3000
CMD ["npm", "run", "start"]
