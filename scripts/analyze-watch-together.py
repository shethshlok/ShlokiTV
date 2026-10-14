#!/usr/bin/env python3
"""Summarize allowlisted playback diagnostics from the current and rotated log."""
import argparse
import json
from collections import defaultdict
from pathlib import Path


def percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[min(len(ordered) - 1, round((len(ordered) - 1) * fraction))], 1)


def summarize(records):
    playing = [r for r in records if r.get("event") == "sample" and r.get("serverPlaying") and not r.get("paused")]
    by_room = defaultdict(lambda: defaultdict(list))
    for record in playing:
        by_room[(record["room"], record["revision"])][record["viewer"]].append(record)
    gaps = []
    for viewers in by_room.values():
        if len(viewers) != 2:
            continue
        first, second = viewers.values()
        for sample in first:
            other = min(second, key=lambda r: abs(r["at"] - sample["at"]))
            if abs(other["at"] - sample["at"]) <= 5000:
                gaps.append(abs(sample["driftMs"] - other["driftMs"]))
    return {
        "records": len(records),
        "playing_samples": len(playing),
        "paired_samples": len(gaps),
        "estimated_peer_gap_ms": {"p50": percentile(gaps, .5), "p95": percentile(gaps, .95), "max": max(gaps, default=None)},
        "absolute_timeline_drift_ms": {"p95": percentile([abs(r["driftMs"]) for r in playing], .95)},
        "network_rtt_ms": {"p50": percentile([r["rttMs"] for r in playing], .5), "p95": percentile([r["rttMs"] for r in playing], .95)},
        "buffering_events": sum(r.get("event") == "buffering" for r in records),
        "drift_corrections": sum(r.get("event") == "drift-correction" for r in records),
        "blocked_play_attempts": sum(r.get("event") == "play-blocked" for r in records),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("log", type=Path)
    args = parser.parse_args()
    records = []
    for file in [Path(str(args.log) + ".1"), args.log]:
        if not file.exists():
            continue
        for line in file.read_text().splitlines():
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    print(json.dumps(summarize(records), indent=2))
