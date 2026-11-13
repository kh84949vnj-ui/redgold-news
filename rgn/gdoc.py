"""Write this week's block into the weekly Google Doc.

The doc has a small Apps Script web app attached (gdoc/Code.gs). This module
sends it the lines to write between its two marker lines; the rest of the doc
is never touched. Needs RGN_GDOC_URL and RGN_GDOC_TOKEN in .env.

  python -m rgn.gdoc [--week 2026-11-09] [--script segments.json] [--dry-run]

--script takes the Episode Script page's saved segments ({"anchor_open": "...",
"news": "...", ...}) so the doc gets the whole episode, not just the generated
parts.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import requests

from . import common as c

CUES = [
    ("anchor_open", None),
    ("show_open", "[CUE INTRO SEQUENCE]"),
    ("news", None),
    ("bumper1", "[CUE BUMPER]"),
    ("weather", "[WEATHER]"),
    ("bumper2", "[CUE BUMPER]"),
    ("voices", "[CUE STUDENT VOICES]"),
    ("menu", "[CUE MENU]"),
    ("anchor_close", None),
    ("outro", "[CUE OUTRO]"),
]


def build_lines(week: dict, segments: dict | None = None) -> list:
    """Lines for the doc block, in the same layout as the weekly script doc."""
    segments = segments or {}
    weather = segments.get("weather") or "\n".join((week.get("weather") or {}).get("script") or [])
    out: list = [
        {"text": f"[EPISODE OF {week['episode_label'].upper()}]", "kind": "tag"},
        f"Updated {week['generated_label']}. Weather from the National Weather Service.",
        "",
    ]

    def block(lines_text: str):
        for ln in lines_text.splitlines():
            out.append(ln)

    if segments:  # whole episode from the script page
        for key, cue in CUES:
            # The menu segment comes from a separate project; it's just a cue here.
            text = weather if key == "weather" else ("" if key == "menu" else segments.get(key, ""))
            if cue:
                out.append(cue)
            if text.strip():
                block(text.strip())
            elif cue is None:
                out.append(f"({key.replace('_', ' ')} not written yet)")
            out.append("")
    else:  # generated parts only
        out.append("[WEATHER]")
        block(weather or "(no forecast this week)")
        out.append("")

    news = week.get("news") or {}
    if news.get("leads") or news.get("board"):
        out.append({"text": "[NEWS LEADS: verify every fact before you write]", "kind": "tag"})
        for l in news.get("leads", []):
            out.append(f"{l['when']}: {l['title']}" + (" (SEE ADVISER FIRST)" if l.get("flagged") else ""))
        for m in news.get("board", []):
            note = " (agenda not posted yet)" if m.get("agenda_pending") else ""
            out.append(f"School board, {m['when']}: {m['title']}{note}")
        out.append("")
    while out and out[-1] == "":
        out.pop()
    return out


def send(week: dict, segments: dict | None = None) -> str:
    url = os.getenv("RGN_GDOC_URL", "").strip()
    token = os.getenv("RGN_GDOC_TOKEN", "").strip()
    if not url or not token:
        raise SystemExit("Set RGN_GDOC_URL and RGN_GDOC_TOKEN in .env (see gdoc/README.md).")
    r = requests.post(
        url,
        data=json.dumps({"token": token, "lines": build_lines(week, segments)}),
        headers={"Content-Type": "application/json", "User-Agent": c.user_agent()},
        timeout=60,
        allow_redirects=True,
    )
    try:
        res = r.json()
    except ValueError:
        raise SystemExit(f"The doc writer didn't answer with JSON (HTTP {r.status_code}). Check the deployment's access setting.")
    if not res.get("ok"):
        raise SystemExit(f"The doc writer refused: {res.get('error')}")
    return f"Wrote {res.get('paragraphs')} lines into \"{res.get('doc')}\"."


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--week", help="any date in the target week (default: the episode week)")
    ap.add_argument("--script", type=Path, help="JSON of the Episode Script page's segments")
    ap.add_argument("--dry-run", action="store_true", help="print the block instead of sending it")
    args = ap.parse_args()
    monday = c.parse_week(args.week)
    path = c.OUTPUT_DIR / monday.isoformat() / "week.json"
    if not path.exists():
        raise SystemExit(f"No {path}. Run python -m rgn.weekly first.")
    week = json.loads(path.read_text(encoding="utf-8"))
    segments = json.loads(args.script.read_text(encoding="utf-8")) if args.script else None
    if args.dry_run:
        for ln in build_lines(week, segments):
            print(ln if isinstance(ln, str) else ln["text"])
        return
    print(send(week, segments))


if __name__ == "__main__":
    main()
