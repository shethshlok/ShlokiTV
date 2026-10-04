# Native Nuvio scraper bridge

Separate engine for the community web UI at ../NuvioWeb-Next. Production at
https://tv.shloksheth.tech uses this bridge with the new community UI.

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
- Provider requests use a fixed HTTPS host allowlist and public-address DNS
  validation. Tokens are used only for the official Nuvio API.
- Starts the fastest previously working providers first; responds when the first
  source is available, or after a 1.5-second snapshot wait after account validation. Other providers populate a
  five-minute account/profile/config/title cache. searchPending tells the web UI to poll automatically for later results.
- Search background budget is 90 seconds; unsupported or unavailable providers
  can produce no results. This does not guarantee every provider works.
- Repository manifests and scripts are refreshed after a five-minute cache TTL.

## Preview limitations

Only GitHub native JavaScript repositories are supported here. DEX/CS3 plugins
cannot execute in this engine. Standard Stremio addons remain in the UI.
Individual scraper toggles and custom scraper settings from the previous
browser's local storage are not imported; this prototype uses script defaults.
Provider domains added upstream need review and addition to the host allowlist.
The UI requests an initial source snapshot; refresh can reveal additional cached
sources. Playback, CORS and codec support still depend on each source/browser.

## Attribution

worker.mjs adapts the browser worker protocol to Node worker threads. The vendored
worker, providerProxy.mjs and envProperties.mjs derive from GYK-Studio/NuvioWeb
main ff5eb45 with the local patches in ../NuvioWeb-PluginPreview; see LICENSE.GYK.
The vendored QuickJS browser bundle was copied from that same deployment and
includes quickjs-emscripten. Preserve vendor license notices on redistribution.
Actual provider scripts remain in their upstream repository and are fetched at
runtime, not included in this checkout.

## Checks completed

QuickJS async/timer fixture; unauthorized stream request returns 401; manifest
and health return 200. Direct Castle worker returned one Matrix source in 1195ms
and three Reacher S1E1 sources in 1554ms. These measure discovery, not playback.
Account-specific discovery, sign-in, and movie/episode playback passed through
the new UI. Domain cutover and daily update details are in
../NuvioWeb-Next/LOCAL-INTEGRATION.md.
