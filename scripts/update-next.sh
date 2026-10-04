#!/usr/bin/env bash
set -euo pipefail
repo=$(cd -- "$(dirname -- "$0")/.." && pwd)
exec 9>"$repo/.update-next.lock"
flock -n 9 || exit 0
cd "$repo"
branch=shlokitv
if [[ $(git branch --show-current) != "$branch" || -n $(git status --porcelain) ]]; then
  printf 'Update stopped: production checkout must be on %s with no uncommitted changes.\n' "$branch" >&2
  exit 1
fi
# Keep upstream release refs separate from any tags made in our own fork.
git fetch origin "$branch"
git fetch upstream '+refs/heads/main:refs/remotes/upstream/main' 'refs/tags/v*:refs/remotes/upstream/releases/v*'
release=$(git for-each-ref --sort=-version:refname --format='%(refname:strip=4)' refs/remotes/upstream/releases | sed -n '/^v[0-9]\+\.[0-9]\+\.[0-9]\+$/p' | head -1)
[[ -n "$release" ]] || { printf 'No stable upstream release found.\n' >&2; exit 1; }
if ! git merge-base --is-ancestor HEAD "origin/$branch"; then
  printf 'Update stopped: local commits must be pushed to the fork first.\n' >&2
  exit 1
fi
scratch=$(mktemp -d "$repo/../.fork-sync-build.XXXXXX")
cleanup() { git worktree remove --force "$scratch" >/dev/null 2>&1 || true; }
trap cleanup EXIT
git worktree add --detach "$scratch" "origin/$branch"
upstream_commit=$(git rev-parse "refs/remotes/upstream/releases/$release^{commit}")
if ! git -C "$scratch" merge-base --is-ancestor "$upstream_commit" HEAD; then
  if ! git -C "$scratch" merge --no-ff --no-edit "$upstream_commit"; then
    printf 'Upstream %s conflicts with ShlokiTV. The running app has not changed; resolve the merge on the fork.\n' "$release" >&2
    exit 1
  fi
fi
candidate=$(git -C "$scratch" rev-parse HEAD)
deployed=$(cat .next-deployed-sha 2>/dev/null || true)
if [[ "$candidate" == "$deployed" ]]; then
  git merge --ff-only "$candidate"
  printf 'ShlokiTV is current: %s (upstream %s).\n' "$candidate" "$release"
  exit 0
fi
"$scratch/scripts/check-release.sh"
docker build --pull -t nuvio-next-ui:candidate "$scratch"
docker build --pull -t nuvio-scraper-bridge:candidate "$scratch/deployment/scraper-bridge"
# A concurrent fork push makes this fail instead of overwriting it.
git push origin "$candidate:refs/heads/$branch"
ui_previous=$(docker inspect --format '{{.Image}}' nuvioweb-next-ui-1)
bridge_previous=$(docker inspect --format '{{.Image}}' nuvioweb-next-scraper-bridge-1)
docker image tag "$ui_previous" nuvio-next-ui:rollback
docker image tag "$bridge_previous" nuvio-scraper-bridge:rollback
runtime="$repo/.runtime-config"
mkdir -p "$runtime"
if [[ -f "$runtime/compose.yaml" ]]; then
  cp "$runtime/compose.yaml" "$runtime/rollback-compose.yaml"
  cp "$runtime/domain.conf" "$runtime/rollback-domain.conf"
else
  cp "$repo/compose.local.yaml" "$runtime/rollback-compose.yaml"
  cp "$repo/nginx/domain.conf" "$runtime/rollback-domain.conf"
fi
cp "$scratch/compose.local.yaml" "$runtime/compose.yaml"
cp "$scratch/nginx/domain.conf" "$runtime/domain.conf"
docker image tag nuvio-next-ui:candidate nuvio-next-ui:local
docker image tag nuvio-scraper-bridge:candidate nuvio-scraper-bridge:local
compose() { docker compose --project-directory "$repo" -p nuvioweb-next -f "$runtime/compose.yaml" "$@"; }
if ! compose up -d --no-build --wait --wait-timeout 90 ||
   ! compose exec -T gateway nginx -t ||
   ! compose exec -T gateway nginx -s reload ||
   ! python3 "$scratch/scripts/verify-branding.py" http://127.0.0.1:4173; then
  docker image tag nuvio-next-ui:rollback nuvio-next-ui:local
  docker image tag nuvio-scraper-bridge:rollback nuvio-scraper-bridge:local
  cp "$runtime/rollback-compose.yaml" "$runtime/compose.yaml"
  cp "$runtime/rollback-domain.conf" "$runtime/domain.conf"
  compose up -d --no-build --wait --wait-timeout 90
  compose exec -T gateway nginx -s reload
  printf 'Deployment failed; restored the previous images and runtime configuration.\n' >&2
  exit 1
fi
git merge --ff-only "$candidate"
printf '%s\n' "$candidate" > .next-deployed-sha
printf '%s\n' "$release" > .next-deployed-tag
printf 'Deployed ShlokiTV %s, including upstream %s.\n' "$candidate" "$release"
