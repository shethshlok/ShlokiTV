# Native Nuvio scraper bridge

Native engine included in the ShlokiTV web fork. Production at
<https://tv.shloksheth.tech> uses this bridge with the new community UI.

## Behavior

- Standard Stremio manifest and movie/series stream endpoints.
- Stream requests require a current Nuvio access token and profile header.
- Reads installed GitHub native repositories from the account; honors repository
  enabled flags and profile inheritance. Does not write to cloud account data.
- Guest scripts execute in isolated QuickJS workers, with memory, code, DOM,
  network and execution limits. Four simultaneous workers across all searches.
- Stream links with unresolved/private hostnames or insecure HTTP are filtered
  before they enter source results. DNS checks are bounded and cached. This
  cannot guarantee that a resolvable host serves a valid video.
- Native magnet and infoHash-only results are omitted because client devices
  have no torrent app. Direct HTTPS video sources remain available.
- Provider requests use a fixed HTTPS host allowlist and public-address DNS
  validation. Tokens are used only for the official Nuvio API.
- GET, POST and HEAD provider requests are supported, including Range requests
  and file-length response headers. HEAD remains HEAD across redirects.
- IMDb and TMDB episode identifiers retain their season and episode numbers.
  Failed metadata lookups are evicted and reported as errors so the web client's
  bounded retries can recover instead of caching a false empty search.
- `provider-hosts.mjs` carries reviewed provider domain updates with the
  release; the private environment's host list extends it. Wildcard domains and
  automatic approval of script-supplied hosts are not supported.
- Starts the fastest previously working providers first; responds when the first
  source is available, or after a 1.5-second snapshot wait after account
  validation. Other providers populate a five-minute
  account/profile/config/title cache. searchPending tells the web UI to poll
  automatically for later results.
- Downloads repository manifests alongside title metadata. Each ready repository
  starts its providers independently, so an unavailable repository cannot delay
  working ones. Provider priority applies within each repository, and all
  repositories share the same four-worker limit.
- Publishes each source as soon as its destination check passes. A slow DNS
  lookup for another link cannot hold back links that have already passed.
- Search background budget is 90 seconds; unsupported or unavailable providers
  can produce no results. This does not guarantee every provider works.
- Repository manifests and scripts are refreshed after a five-minute cache TTL.

## Preview limitations

Only GitHub native JavaScript repositories are supported here. DEX/CS3 plugins
cannot execute in this engine. Standard Stremio addons remain in the UI.
Individual scraper toggles and custom scraper settings from the previous
browser's local storage are not imported; this prototype uses script defaults.
Provider domains added upstream need review and addition to the host allowlist.
The detail page, source drawer and player poll pending snapshots automatically.
Playback, CORS and codec support still depend on each source/browser. Failed
provider services, including stale upstream configuration URLs, can still return
no sources even when their request hosts are approved.

## Attribution

worker.mjs adapts the browser worker protocol to Node worker threads. The
vendored worker, providerProxy.mjs and envProperties.mjs derive from
GYK-Studio/NuvioWeb main ff5eb45 with the original local browser integration;
see LICENSE.GYK. The vendored QuickJS browser bundle was copied from that same
deployment and includes quickjs-emscripten. Preserve vendor license notices on
redistribution. Actual provider scripts remain in their upstream repository and
are fetched at runtime, not included in this checkout.

## Checks completed

QuickJS async/timer fixture; unauthorized stream request returns 401; manifest
and health return 200. Direct Castle worker returned one Matrix source in 1195ms
and three Reacher S1E1 sources in 1554ms. These measure discovery, not playback.
Account-specific discovery, sign-in, and movie/episode playback passed through
the new UI. Domain cutover and daily update details are in
../../LOCAL-INTEGRATION.md.
