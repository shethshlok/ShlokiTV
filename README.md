# ShlokiTV

ShlokiTV is a self-hosted fork of [orochibraru/nuvio-web](https://github.com/orochibraru/nuvio-web).
The `shlokitv` branch contains the web branding, native scraper bridge, background
source discovery, playback recovery, and production update scripts. Upstream code
and its AGPL license are preserved. See [LOCAL-INTEGRATION.md](LOCAL-INTEGRATION.md)
for the deployment and daily synchronization workflow.

---

node_modules

# Output
.output
.vercel
.netlify
.wrangler
/.svelte-kit
/build

# OS
.DS_Store
Thumbs.db

# Env
.env
.env.*
!.env.example
!.env.test

# Vite
vite.config.js.timestamp-*
vite.config.ts.timestamp-*

# Playwright
/test-results/
/playwright-report/
/blob-report/
/.playwright/
screens/

# Vitest
/coverage/

# Local admin database (sign-in metrics + instance lock)
/data/

# Vale: packages are fetched by `vale sync` (the prek hook does it on first
# run); only our own config is committed.
/.vale/styles/*
!/.vale/styles/config/
.playwright-mcp/

# Production state belongs to this host, not the fork.
.update-next.lock
.next-deployed-tag
.next-deployed-sha
.next-update-error
.fork-sync-*
