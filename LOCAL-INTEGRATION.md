# ShlokiTV production fork

Site: <https://tv.shloksheth.tech> Fork:
<https://github.com/shethshlok/ShlokiTV> Production branch: `shlokitv` Upstream:
<https://github.com/orochibraru/nuvio-web>

## Source ownership

The fork commits the complete ShlokiTV web app: branding, account integration,
native scraper bridge, source-loading status and polling, and bounded playback
recovery. The bridge lives in `deployment/scraper-bridge`, including its
original license notices. Upstream source and AGPL licensing remain intact.

`origin` points to our fork; `upstream` points to the original repository. The
fork's `main` is the upstream baseline. Our production changes live on
`shlokitv`, which is the fork's default branch. Do not force-sync that branch:
new upstream stable releases are merged so local changes are preserved.

The former patch files are recovery artifacts under `../NuvioWeb-Backups`.
Production builds use committed fork source directly and do not apply patches.
`scripts/apply-branding.py` remains an optional maintenance tool, not a build
step.

## Runtime

`compose.local.yaml` describes three services:

- `gateway`: Nginx on localhost:4173, behind the existing Cloudflare tunnel.
- `ui`: the web app on localhost:4181, with sessions in the `next-data` volume.
- `scraper-bridge`: the private native plugin engine, built from the fork.

The production runtime configuration is copied to ignored `.runtime-config/`.
The gateway mounts `.runtime-config/domain.conf`. This lets deployment roll back
images and gateway/Compose configuration independently of the Git checkout. The
updater uses the explicit Compose project `nuvioweb-next` to retain the existing
containers, network and session volume.

Secrets remain only in `../NuvioScraperBridge/.env` on this host. No account
credentials, session data or private environment files are stored in the fork.
Do not use `down -v`: `next-data` holds sign-in data.

## Daily sync and deployment

The existing `nuvioweb-next-update.timer` runs daily at 03:55 America/Phoenix,
with up to ten minutes jitter. It runs `scripts/update-next.sh`, which:

1. Requires a clean production checkout and fetches the fork and upstream refs.
2. Creates a temporary worktree from `origin/shlokitv`.
3. Merges the latest numeric stable upstream release if not already included.
4. Runs type checks and focused addon, source-loading, stream-format and audio
   tests.
5. Builds candidate UI and bridge images before changing the running app.
6. Pushes the validated merge to the fork with a normal non-forced push.
7. Deploys both images and candidate runtime configuration with health checks,
   Nginx validation and reload, and a served branding check through the gateway.
8. Fast-forwards the local checkout and records the exact deployed commit.

A change pushed to `shlokitv` is deployed even when no new upstream version
exists. An unchanged deployed commit is a no-op. Conflicts, failed checks or a
concurrent non-fast-forward fork push stop before deployment. Failed runtime
checks restore both previous images and runtime configuration. A failed
candidate can remain in the fork after runtime rollback; the deployment marker
stays on the working commit so it can be retried or corrected.

The watchdog runs every five minutes, using the active runtime configuration. It
shares `.update-next.lock` with the updater.

    ./scripts/update-next.sh
    systemctl --user list-timers 'nuvioweb-next-*'
    journalctl --user -u nuvioweb-next-update.service

Future work: commit and push changes on `shlokitv`, then run the updater or wait
for the daily timer. Uncommitted or unpushed local work pauses automated
updates. Merge conflicts need resolution and a new commit on the fork; they are
never resolved by discarding our changes.

## Playback behavior

The bridge returns `searchPending` while providers are running. The UI keeps
showing loading for early empty snapshots and polls every two seconds while
mounted, including on the detail page before the source drawer is opened. The
official-provider fallback waits for a completed empty search. The drawer shows
HTTP video sources by default, including audio-risk and external-player options,
and distinguishes filtered counts from total results. Magnet and infoHash-only
results are omitted because client devices have no torrent app. Available
sources remain usable as later batches arrive. Automatic playback waits for
discovery, then selects the highest resolution with browser-friendly audio. An
explicit quality preference selects the closest match. Manual choices stay fixed
while the player continues collecting later results in the background. Discovery
stops after two minutes; already available sources remain selectable. Empty
failed requests receive bounded retries and an error screen rather than a false
empty result. Closing the drawer cancels its polling; the mounted player keeps
its own discovery active. Fatal playback failures can try up to four alternative
sources, ranked by the same quality preference.

Automatic quality selection prefers sources explicitly labelled with browser
audio codecs and no known video-codec risk. Explicit quality preferences retain
their resolution choice. A source that supplies no first frame within 45 seconds
enters the same bounded recovery path as a fatal playback error; later buffering
and user pauses do not trigger this startup timeout.

A fatal error loading an embedded HLS subtitle playlist disables that rendition
and resumes video and audio. Some providers incorrectly point a subtitle
playlist at a plain WebVTT file. Addon subtitles remain available independently.

Known provider limits remain: a discovered link can be unavailable, unsupported,
or a poor match for the requested title. Source discovery does not guarantee
that every provider link plays the correct media.

Direct MP4/MKV files with multiple supported audio tracks use the existing MSE
transmux pipeline when the browser lacks native `audioTracks`. This exposes the
Audio menu even when the default audio already plays. Single-track files keep
native playback. HLS retains its existing track selection. The direct-file
fallback requires a readable source (CORS), supported video and audio codecs,
and browser MSE support; unavailable tracks cannot be supplied by the player.

The audio change was checked in the actual Chromium player with a generated
two-track H.264/AAC file: both options appeared, playback continued when
switching in both directions, and captured audio changed between the fixture's
440 Hz and 880 Hz tones. Focused tests also cover native track support,
single-track files and preferred audio language.

## Recovery

Rollback image tags: `nuvio-next-ui:rollback` and
`nuvio-scraper-bridge:rollback`. Runtime backups:
`.runtime-config/rollback-compose.yaml` and
`.runtime-config/rollback-domain.conf`. Earlier domain-cutover backups remain in
`../NuvioWeb-Backups`; they do not run.

## Watch together

The web player includes native rooms for two signed-in viewers. Start a playable
movie or episode, open **Watch together**, create a room, and share its invite
link. The other viewer signs in with their own account and resolves their own
sources. Stream URLs and addon credentials are never sent to the room.

Playback controls, skipping the intro, speed and host title changes use the
server's shared timeline. Playback waits while either player is loading or
reconnecting. Release filenames and sizes, when provided by addons, can select a
matching guest source. A different running time prompts the guest to select the
correct release or explicitly accept the difference. Equal durations alone do
not prove two files have the same cut.

Rooms live in the single UI process, expire after twelve hours, and end when
both viewers leave. Reloads and short connection interruptions retain
membership; an absent host is removed after 45 seconds and the remaining viewer
becomes the host. Rooms are saved to `watch-together/rooms.json` in the data
directory, so restarting or deploying the UI pauses them rather than ending
them: open players reconnect on their own, and playback resumes once every
viewer is back. A room that no longer exists, or an expired invite, is reported
with a prompt to start a new room instead of reconnecting indefinitely. Multiple
UI replicas would require a shared room store before enabling this feature
across them.

### Camera and microphone

Each viewer explicitly presses **Join video call** to grant browser permission.
The call is a two-peer WebRTC connection with offer-collision handling and ICE
restart. Camera/microphone capture stops on leaving the call or losing the room
connection. Closing the controls keeps small call tiles and audio available.
Camera and microphone permissions are limited to this site's origin. HTTPS is
required outside localhost.

A public STUN server is configured for direct connections. For dependable calls
on mobile or restricted networks, configure a TURN relay in the ignored file
`.runtime-config/watch-together.env`. Compose loads that optional file into the
UI service. It is not copied into source control. Example with placeholders:

    SHLOKITV_ICE_SERVERS='[{"urls":"stun:stun.cloudflare.com:3478"},{"urls":["turn:turn.example.com:3478?transport=udp","turns:turn.example.com:5349?transport=tcp"],"username":"YOUR_USERNAME","credential":"YOUR_CREDENTIAL"}]'

Use credentials from your TURN provider or your reachable coturn installation.
The authenticated room clients receive this ICE configuration. The TURN service
must be reachable independently of the HTTP Cloudflare tunnel. Do not publish
real credentials in Git. The room panel reports when no TURN relay is
configured. Changing this file requires recreating the UI container through the
normal deployment workflow.

### Validation

The focused watch-room tests cover membership authorization, capacity, shared
playback, buffering, revision checks, source replacement, host transfer and
consent before signaling. The browser harness uses two independent sessions and
a phone-sized viewport to check playback, pause/seek, reload/reconnection,
actual synthetic audio/video tracks, mute/camera controls and cleanup:

    bun --bun node_modules/vitest/vitest.mjs run src/lib/watch-together
    bun x playwright test e2e/watch-together.spec.ts --project=chromium
    bun x playwright test e2e/watch-together-mobile.spec.ts --project=watch-mobile-webkit

The fixtures use the real player and room API, with the existing gated E2E
session route. They do not require real account credentials or third-party
streams. Synthetic devices and mobile emulation do not replace testing physical
phones on separate mobile networks with the production TURN relay.

### Playback diagnostics

Authenticated room members send timing samples every ten seconds, plus play,
buffering and drift-correction events. The UI writes these asynchronously into
`/app/data/watch-together/playback.jsonl` on the existing persistent data
volume. The current file and one rotated backup each hold at most about 3 MiB.
Logging failures do not block playback. Telemetry does not adjust the playback
clock.

Records contain pseudonymous room/viewer identifiers, playback position, drift
against the room timeline, buffer depth, readiness, autoplay blocking, source
length mismatch, round-trip delay and clock offset. They exclude account data,
raw invite codes, membership tokens, source URLs, filenames and call media.

Copy both log files locally with `docker cp`, then run:

    python3 scripts/analyze-watch-together.py /path/to/playback.jsonl

The report estimates peer drift from two playing viewers' samples in the same
room and media revision, taken within five seconds of each other. Clock
estimation and changing network delay affect this estimate; it is not a
frame-by-frame measurement. Compare it with physical-device tests before
changing sync thresholds.
