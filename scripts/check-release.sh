#!/usr/bin/env bash
set -euo pipefail
repo=$(cd -- "$(dirname -- "$0")/.." && pwd)
python3 "$repo/scripts/update-next.test.py"
# Candidate code receives no host credentials or production environment file.
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e BUN_INSTALL_CACHE_DIR=/tmp/bun-cache \
  -v "$repo:/app" -w /app oven/bun:1 \
  sh -c 'bun install --frozen-lockfile --ignore-scripts && bun run check && bunx vitest run src/lib/addons/client.test.ts src/lib/watch/source-loading.svelte.test.ts src/lib/watch/stream-format.test.ts src/lib/player/transmux-session.test.ts src/lib/player/transmux.test.ts src/lib/player/media.test.ts src/lib/player/audio-language.test.ts'
node --check "$repo/deployment/scraper-bridge/server.mjs"
bash -n "$repo/scripts/update-next.sh"
