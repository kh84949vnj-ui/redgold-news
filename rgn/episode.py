"""Draft the full episode script from the week's data, in the weekly Google
Doc format, ready for the prompter.

What it writes:
  - anchor open (anchor names left as [ANCHOR 1] / [ANCHOR 2] placeholders)
  - a news block drafted from the district calendar: one short line per
    event, alternating anchors. Flagged (sensitive) items appear only as a
    note for the adviser, never as a read. Board meetings are left out.
  - this week's closures and next week's break, if any
  - weather read, cue lines for the packages, and the close

Everything here comes from public sources (district calendar, NWS), so it's
safe to publish with the prompter. Students rewrite and verify it.

  python -m rgn.episode [--week 2026-11-16]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re

from . import common as c

DAY = c.DAY_NAMES


def _d(iso: str) -> dt.date:
    return dt.date.fromisoformat(iso)


def _say_time(t: str) -> str:
    """'6:30 PM' -> '6:30 p.m.', '6:00 PM' -> '6 p.m.'"""
    m = re.match(r"(\d{1,2}):(\d\d) ([AP])M", t or "")
    if not m:
        return t
    h, mm, ap = m.groups()
    return f"{h}{'' if mm == '00' else ':' + mm} {ap.lower()}.m."


def _join(items: list[str]) -> str:
    if len(items) <= 2:
        return " and ".join(items)
    return ", ".join(items[:-1]) + ", and " + items[-1]


def _long_date(d: dt.date) -> str:
    return f"{DAY[d.weekday()]}, {d.strftime('%B')} {d.day}"


def _show_name(title: str) -> str:
    """Group repeat showings: 'X Public School Show' / 'X Public Show' -> 'X'."""
    return re.sub(r"\s*(public\s+)?(school\s+)?shows?\s*(\(.*\))?$", "", title, flags=re.I).strip() or title


def news_lines(week: dict) -> list[tuple[str, str]]:
    """[(kind, text)] where kind is 'read' or 'note'."""
    news = week.get("news") or {}
    out: list[tuple[str, str]] = []
    leads = [l for l in news.get("leads", []) if l.get("date")]

    # Group events that repeat (several showings of one musical).
    groups: dict[str, list[dict]] = {}
    order: list[str] = []
    for l in leads:
        key = _show_name(l["title"]) if l.get("time") else l["title"]
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(l)

    for key in order:
        items = groups[key]
        first = items[0]
        if any(l.get("flagged") for l in items):
            out.append(("note", f"FLAGGED: {first['title']}. See the adviser before covering this."))
            continue
        day = DAY[_d(first["date"]).weekday()]
        if not first.get("time"):  # all-day observance like "National STEM Day"
            out.append(("read", f"{day} is {key}."))
            continue
        times = []
        for l in items:
            dd = DAY[_d(l["date"]).weekday()]
            times.append(f"{dd} at {_say_time(l['time'])}")
        name = key if key.lower().startswith("the ") else "The " + key
        verb = "has showings" if len(items) > 1 else "is"
        sentence = f"{name} {verb} {_join(times)}"
        out.append(("read", sentence if sentence.endswith(".") else sentence + "."))
        out.append(("note", "VERIFY: location"))
    return out


def closures_line(week: dict) -> str | None:
    cl = week.get("closures") or []
    if not cl:
        return None
    by: dict[str, list[str]] = {}
    for x in cl:
        by.setdefault(x["reason"], []).append(DAY[_d(x["date"]).weekday()])
    parts = [f"there's no school {_join(days)} for {reason}" for reason, days in by.items()]
    return "Remember, " + "; ".join(parts) + "."


def next_break(week: dict) -> dict | None:
    """Next week's break, if most of next week is closed."""
    monday = _d(week["episode_date"])
    nm = monday + dt.timedelta(days=7)
    nxt = {x["date"]: x["reason"] for x in week.get("next_closures") or []}
    days = [nm + dt.timedelta(days=i) for i in range(5)]
    closed = [d for d in days if d.isoformat() in nxt]
    if len(closed) < 3:
        return None
    reason = nxt[closed[0].isoformat()]
    first, last = closed[0], closed[-1]
    back = last + dt.timedelta(days=1)
    while back.weekday() >= 5 or back.isoformat() in nxt:
        back += dt.timedelta(days=1)
    return {"reason": reason, "first": first, "last": last, "back": back}


def build_script(week: dict) -> str:
    out: list[str] = []
    add = out.append
    brk = next_break(week)

    # Anchor open
    add("[BOTH]")
    if week.get("prior_break"):
        add(f"Hello RedWolves, I'm [ANCHOR 1] and I'm [ANCHOR 2]. Welcome back from {week['prior_break']}, "
            "and welcome to another episode of the RGN. Here's what you need to know.")
    else:
        add("Hello RedWolves, I'm [ANCHOR 1] and I'm [ANCHOR 2]. Welcome to another episode of the RGN. "
            "Here's what you need to know.")
    add("")
    add("[CUE INTRO SEQUENCE]")
    add("")

    # News block, alternating anchors
    anchor = 1
    def read(text: str) -> None:
        nonlocal anchor
        add(f"[ANCHOR {anchor}]")
        add(text)
        add("")
        anchor = 2 if anchor == 1 else 1

    if (cl := closures_line(week)):
        read(cl)
    for kind, text in news_lines(week):
        if kind == "note":
            # VERIFY notes go at the end of the read they belong to; other notes
            # (flagged topics) stand alone. Either way they're shown, never read.
            if text.startswith("VERIFY") and out and out[-1] == "" and len(out) >= 2 and not out[-2].startswith("["):
                out[-2] = out[-2] + f" [{text}]"
            else:
                add(f"[{text}]")
                add("")
            continue
        read(text)
    if brk:
        read(f"Mark your calendars: next week is {brk['reason']}. There's no school "
             f"{_long_date(brk['first'])}, through {_long_date(brk['last'])}. "
             f"Classes start back up {_long_date(brk['back'])}.")
    read("[ADD CAMPUS STORY: Jimmy Carter news or an RGN package]")
    read("Now on with the show.")

    add("[CUE BUMPER]")
    add("")
    add("[WEATHER]")
    wx = (week.get("weather") or {}).get("script") or []
    out.extend(wx or ["[ADD: weather read]"])
    add("")
    add("[CUE BUMPER]")
    add("")
    add("[CUE STUDENT VOICES]")
    add("")
    add("[CUE MENU]")
    add("")

    # Close
    if brk:
        holiday = re.sub(r"\s*break$", "", brk["reason"], flags=re.I).strip()
        add("[ANCHOR 1]")
        add(f"That's all for this week. Enjoy your {brk['reason']}, and we'll see you back on "
            f"{brk['back'].strftime('%B')} {brk['back'].day}.")
        add("")
        add("[ANCHOR 2]")
        add(f"Have a safe and happy {holiday}, RedWolves!" if holiday else "Have a safe and happy break, RedWolves!")
        add("")
        add("[BOTH]")
        add("See you after the break!")
    else:
        add("[ANCHOR 1]")
        add("That's all for this week.")
        add("")
        add("[ANCHOR 2]")
        add("Have a great week, RedWolves!")
        add("")
        add("[BOTH]")
        add("See you next Monday!")
    add("")
    add("[CUE OUTRO]")
    return "\n".join(out).strip() + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--week", help="any date in the target week (default: the episode week)")
    args = ap.parse_args()
    monday = c.parse_week(args.week)
    path = c.OUTPUT_DIR / monday.isoformat() / "week.json"
    if not path.exists():
        raise SystemExit(f"No {path}. Run python -m rgn.weekly first.")
    print(build_script(json.loads(path.read_text(encoding="utf-8"))))


if __name__ == "__main__":
    main()
