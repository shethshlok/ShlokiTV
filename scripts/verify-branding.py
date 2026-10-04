#!/usr/bin/env python3
"""Verify the deployed branding before accepting an automated update."""
import hashlib
import json
import sys
from pathlib import Path
from urllib.request import urlopen

origin = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:4181"
assets = Path(__file__).resolve().parents[1] / "local-branding/assets"


def get(path):
    with urlopen(origin + path, timeout=15) as response:
        return response.read()


html = get("/auth/sign-in").decode()
if "<title>ShlokiTV" not in html or 'alt="ShlokiTV"' not in html or '/shlokitv-logo-text.webp' not in html:
    raise SystemExit("Deployed sign-in page is missing ShlokiTV branding")
manifest = json.loads(get("/shlokitv-manifest.webmanifest"))
if manifest.get("name") != "ShlokiTV" or manifest.get("short_name") != "ShlokiTV":
    raise SystemExit("Deployed app manifest is missing ShlokiTV branding")
for asset in assets.iterdir():
    if hashlib.sha256(get("/shlokitv-" + asset.name)).digest() != hashlib.sha256(asset.read_bytes()).digest():
        raise SystemExit(f"Deployed branding asset differs: {asset.name}")
print(f"Verified ShlokiTV title, logo, manifest and all icons at {origin}")
