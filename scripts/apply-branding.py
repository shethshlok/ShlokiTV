#!/usr/bin/env python3
"""Apply the local ShlokiTV identity before building any upstream release.

Only presentation changes: upstream account/service names remain accurate.
Validate all anchors before writing, so upstream drift fails before deployment.
"""
import json
import re
import shutil
import sys
from pathlib import Path

BRAND = "ShlokiTV"
ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
ASSETS = Path(__file__).resolve().parents[1] / "local-branding" / "assets"
changes = {}


def replace(relative, old, new):
    path = ROOT / relative
    text = changes.get(path, path.read_text())
    if old in text:
        text = text.replace(old, new)
    elif new not in text:
        raise SystemExit(f"Branding anchor changed in {relative}: {old!r}; keeping current deployment")
    changes[path] = text


replace("src/lib/core/title.svelte.ts", '`Nuvio · ${this.#segment}` : "Nuvio"',
        '`ShlokiTV · ${this.#segment}` : "ShlokiTV"')
replace("src/routes/auth/+layout.svelte", 'alt="Nuvio"', 'alt="ShlokiTV"')
replace("src/routes/(protected)/(app)/+layout.svelte", '>Nuvio</span>', '>ShlokiTV</span>')
# Separate URLs bypass an older service worker's cached upstream artwork.
for relative, names in {
    "src/routes/auth/+layout.svelte": ("logo-text.webp",),
    "src/routes/(protected)/(app)/+layout.svelte": ("logo-text.webp", "logo-text-dark.webp"),
    "src/lib/player/components/loading-mark.svelte": ("logo.webp",),
    "src/app.html": ("favicon.png", "apple-touch-icon.png", "manifest.webmanifest"),
}.items():
    for name in names:
        replace(relative, f'"/{name}"', f'"/shlokitv-{name}"')

identity_keys = {"admin_back", "shell_logo_home", "notice_description", "notice_hosts_nothing",
                 "settings_addons_disclaimer", "small_screen_before"}
for path in sorted((ROOT / "messages").glob("*.json")):
    data = json.loads(path.read_text())
    for key in identity_keys:
        if key not in data or not re.search(r"Nuvio|ShlokiTV", data[key]):
            raise SystemExit(f"Branding message changed: {path.name}:{key}")
        data[key] = re.sub(r"Nuvio(?: [Ww]eb)?", BRAND, data[key])
    # Keep Nuvio account, API, mobile-app, and upstream attribution wording.
    changes[path] = json.dumps(data, ensure_ascii=False, indent="\t") + "\n"

path = ROOT / "static/manifest.webmanifest"
manifest = json.loads(path.read_text())
manifest.update(name=BRAND, short_name=BRAND,
                description="ShlokiTV — your library, profiles, addons and watch progress in a browser.")
for icon in manifest["icons"] + [icon for shortcut in manifest.get("shortcuts", []) for icon in shortcut.get("icons", [])]:
    name = icon["src"].removeprefix("/").removeprefix("shlokitv-")
    if name not in ("icon-192.png", "icon-512.png"):
        raise SystemExit(f"Upstream manifest icon changed: {name}")
    icon["src"] = "/shlokitv-" + name
changes[path] = json.dumps(manifest, ensure_ascii=False, indent="\t") + "\n"
changes[ROOT / "static/shlokitv-manifest.webmanifest"] = changes[path]

asset_names = ("logo-text.webp", "logo-text-dark.webp", "logo.webp", "favicon.png",
               "apple-touch-icon.png", "icon-192.png", "icon-512.png")
for name in asset_names:
    if not (ASSETS / name).is_file() or not (ROOT / "static" / name).is_file():
        raise SystemExit(f"Branding asset missing or upstream path changed: {name}")
for path, text in changes.items():
    path.write_text(text)
for name in asset_names:
    shutil.copyfile(ASSETS / name, ROOT / "static" / name)
    shutil.copyfile(ASSETS / name, ROOT / "static" / ("shlokitv-" + name))
print(f"Applied {BRAND} identity to {ROOT}")
