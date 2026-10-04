#!/usr/bin/env bash
set -euo pipefail
repo=$(cd -- "$(dirname -- "$0")/.." && pwd)
exec 9>"$repo/.update-next.lock"
flock -n 9 || exit 0
cd "$repo"
config="$repo/compose.local.yaml"
[[ ! -f "$repo/.runtime-config/compose.yaml" ]] || config="$repo/.runtime-config/compose.yaml"
compose() { docker compose --project-directory "$repo" -p nuvioweb-next -f "$config" "$@"; }
for service in gateway ui scraper-bridge; do
  id=$(compose ps -aq "$service")
  if [[ -z "$id" ]]; then
    compose up -d --no-build "$service"
    continue
  fi
  state=$(docker inspect --format '{{.State.Status}}' "$id")
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id")
  if [[ "$state" == exited || "$state" == dead || "$health" == unhealthy ]]; then
    docker restart "$id"
  fi
done
