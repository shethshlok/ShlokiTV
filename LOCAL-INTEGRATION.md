# ShlokiTV production fork

Site: https://tv.shloksheth.tech
Fork: https://github.com/shethshlok/ShlokiTV
Production branch: `shlokitv`
Upstream: https://github.com/orochibraru/nuvio-web

## Source ownership

The fork commits the complete ShlokiTV web app: branding, account integration,
native scraper bridge, source-loading status and polling, and bounded playback
recovery. The bridge lives in `deployment/scraper-bridge`, including its original
license notices. Upstream source and AGPL licensing remain intact.

`origin` points to our fork; `upstream` points to the original repository. The
fork's `main` is the upstream baseline. Our production changes live on
`shlokitv`, which is the fork's default branch. Do not force-sync that branch:
new upstream stable releases are merged so local changes are preserved.

The former patch files are recovery artifacts under `../NuvioWeb-Backups`.
Production builds use committed fork source directly and do not apply patches.
`scripts/apply-branding.py` remains an optional maintenance tool, not a build step.

## Runtime

`compose.local.yaml` describes three services:

- `gateway`: Nginx on localhost:4173, behind the existing Cloudflare tunnel.
- `ui`: the web app on localhost:4181, with sessions in the `next-data` volume.
- `scraper-bridge`: the private native plugin engine, built from the fork.

The production runtime configuration is copied to ignored `.runtime-config/`.
The gateway mounts `.runtime-config/domain.conf`. This lets deployment roll back
images and gateway/Compose configuration independently of the Git checkout.
The updater uses the explicit Compose project `nuvioweb-next` to retain the
existing containers, network and session volume.

Secrets remain only in `../NuvioScraperBridge/.env` on this host. No account
credentials, session data or private environment files are stored in the fork.
Do not use `down -v`: `next-data` holds sign-in data.

## Daily sync and deployment

The existing `nuvioweb-next-update.timer` runs daily at 03:55 America/Phoenix,
with up to ten minutes jitter. It runs `scripts/update-next.sh`, which:

1. Requires a clean production checkout and fetches the fork and upstream refs.
2. Creates a temporary worktree from `origin/shlokitv`.
3. Merges the latest numeric stable upstream release if not already included.
4. Runs type checks and focused addon, source-loading and stream-format tests.
5. Builds candidate UI and bridge images before changing the running app.
6. Pushes the validated merge to the fork with a normal non-forced push.
7. Deploys both images and candidate runtime configuration with health checks,
   Nginx validation and reload, and a served branding check through the gateway.
8. Fast-forwards the local checkout and records the exact deployed commit.

A change pushed to `shlokitv` is deployed even when no new upstream version exists.
An unchanged deployed commit is a no-op. Conflicts, failed checks or a concurrent
non-fast-forward fork push stop before deployment. Failed runtime checks restore
both previous images and runtime configuration. A failed candidate can remain in
the fork after runtime rollback; the deployment marker stays on the working
commit so it can be retried or corrected.

The watchdog runs every five minutes, using the active runtime configuration.
It shares `.update-next.lock` with the updater.

    ./scripts/update-next.sh
    systemctl --user list-timers 'nuvioweb-next-*'
    journalctl --user -u nuvioweb-next-update.service

Future work: commit and push changes on `shlokitv`, then run the updater or wait
for the daily timer. Uncommitted or unpushed local work pauses automated updates.
Merge conflicts need resolution and a new commit on the fork; they are never
resolved by discarding our changes.

## Playback behavior

The bridge returns `searchPending` while providers are running. The UI keeps
showing loading for early empty snapshots and polls every two seconds while
mounted. Available sources remain usable as later batches arrive. Playback locks
the first playable selection so later batches do not restart it. Discovery stops
after two minutes with an explicit retry message; closing the drawer cancels its
polling. Fatal playback failures can try up to four alternative sources.

Known provider limits remain: a discovered link can be unavailable, unsupported,
or a poor match for the requested title. Source discovery does not guarantee
that every provider link plays the correct media.

## Recovery

Rollback image tags: `nuvio-next-ui:rollback` and `nuvio-scraper-bridge:rollback`.
Runtime backups: `.runtime-config/rollback-compose.yaml` and
`.runtime-config/rollback-domain.conf`. Earlier domain-cutover backups remain in
`../NuvioWeb-Backups`; they do not run.
