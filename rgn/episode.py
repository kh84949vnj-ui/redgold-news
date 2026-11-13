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


# One plain line explaining observances the calendar lists often. Only facts
# about what the day is; nothing about specific people or events.
OBSERVANCES = [
    (r"education support professional", "It's a day to thank the people who keep our schools running, like custodians, cafeteria workers, and bus drivers."),
    (r"substitute", "Substitute teachers step in when our teachers are out, and they help keep our classes going."),
    (r"parent(al)? involvement", "It's a day to thank the parents and families who help out at school and at home."),
    (r"veteran", "It's a day to honor the people who served in our military."),
    (r"\bste(a)?m\b", "It celebrates science, technology, engineering, art, and math."),
    (r"superintendent", "It's a day to recognize the leader of our school district."),
    (r"principal", "It's a day to thank the principals who lead our campuses."),
    (r"counselor", "It's a day to thank the counselors who help students every day."),
    (r"school nurse|nurses", "It's a day to thank the nurses who keep us healthy at school."),
    (r"teacher appreciation|teachers'? day", "It's a time to thank the teachers who help us learn every day."),
    (r"custodian", "It's a day to thank the custodians who keep our campuses clean."),
    (r"bus driver|transportation", "It's a day to thank the drivers who get us to school safely."),
    (r"school lunch|nutrition|cafeteria", "It's a time to thank the cafeteria staff who serve us every day."),
    (r"librar", "It's a time to celebrate our libraries and the people who run them."),
    (r"coach", "It's a day to thank the coaches who help our athletes grow."),
    (r"kindness", "It's a good reminder to be kind to the people around you."),
]

# What to say after a timed event, by kind of event. Encouragement only.
EVENT_KIND = [
    (r"musical|theat|play\b", "If you like theater, it's a great way to support our students."),
    (r"concert|choir|band|orchestra|mariachi|folkl[oó]rico|conjunto|music", "It's a great way to support our student musicians."),
    (r"\bvs\.?\b|game|tournament|meet\b", "Come out and cheer on our teams."),
    (r"walk|run\b|5k", "It's a great way to get moving with our community."),
    (r"art|exhibit|chalk", "It's a fun way to see what our student artists can do."),
]


def _observance_line(title: str) -> str:
    for pat, line in OBSERVANCES:
        if re.search(pat, title, re.I):
            return line
    return ""


def _event_line(title: str) -> str:
    for pat, line in EVENT_KIND:
        if re.search(pat, title, re.I):
            return line
    return "It's a good chance to support our students."


def news_items(week: dict) -> list[dict]:
    """[{kind: "read"|"flag", fact, context, verify}] from the calendar leads."""
    news = week.get("news") or {}
    leads = [l for l in news.get("leads", []) if l.get("date")]
    groups: dict[str, list[dict]] = {}
    order: list[str] = []
    for l in leads:
        key = _show_name(l["title"]) if l.get("time") else l["title"]
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(l)

    items = []
    for key in order:
        group = groups[key]
        first = group[0]
        if any(l.get("flagged") for l in group):
            items.append({"kind": "flag", "fact": f"FLAGGED: {first['title']}. See the adviser before covering this."})
            continue
        day = DAY[_d(first["date"]).weekday()]
        if not first.get("time"):  # an all-day observance
            items.append({"kind": "read", "fact": f"{day} is {key}.", "context": _observance_line(key), "verify": ""})
            continue
        name = key if key.lower().startswith("the ") else "the " + key
        times = [f"{DAY[_d(l['date']).weekday()]} at {_say_time(l['time'])}" for l in group]
        if len(group) > 1:
            fact = f"You can catch {name} {_join(times)}"
            fact = fact if fact.endswith(".") else fact + "."
        else:
            fact = f"{name[0].upper() + name[1:]} is {times[0]}"
            fact = fact if fact.endswith(".") else fact + "."
        items.append({"kind": "read", "fact": fact, "context": _event_line(key), "verify": "VERIFY: location"})
    return items


# Kept for older callers: flat (kind, text) pairs.
def news_lines(week: dict) -> list[tuple[str, str]]:
    out = []
    for it in news_items(week):
        if it["kind"] == "flag":
            out.append(("note", it["fact"]))
        else:
            out.append(("read", it["fact"]))
            if it["verify"]:
                out.append(("note", it["verify"]))
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


# Phrase banks. One is picked per episode from the episode date, so reruns in
# the same week give the same words and each week sounds a little different.
# No "good morning" or other time-of-day words: episodes air at different times.
GREETINGS = ["Hey, RedWolves!", "Welcome to the RGN, RedWolves!", "What's up, RedWolves!"]
PREVIEWS = [
    "Coming up, we've got school news, your weather, and Student Voices.",
    "This week we have school news, the forecast, and Student Voices.",
    "Stick with us for school news, the weather, and Student Voices.",
]
NEWS_STARTS = ["Let's get into the news.", "Let's start with what's happening this week.", "First up, here's what's going on."]
HANDOFFS = ["Thanks, [ANCHOR {other}].", "Thanks, [ANCHOR {other}].", "That's right, [ANCHOR {other}]."]
WEATHER_TOSS = [
    "After the break, [WEATHER REPORTER] has your forecast. Stick around.",
    "Stay with us. [WEATHER REPORTER] has the weather after the break.",
    "Up next, [WEATHER REPORTER] with the weather. Don't go anywhere.",
]
SIGN_OFFS = ["Have a great week, and go RedWolves!", "Have a great week, RedWolves!", "Make it a great week, RedWolves!"]


def board_pick_lines(week: dict, picks) -> dict:
    """Picked board items -> {key: line}, in agenda order. The first pick from a
    meeting opens with the meeting time; the rest say "also"."""
    from .board import board_line, item_key

    picks = set(picks or [])
    out: dict[str, str] = {}
    for m in (week.get("news") or {}).get("board", []):
        first = True
        for it in (m.get("items") or []) or [None]:
            if it is not None and it.get("flagged"):
                continue
            key = item_key(m, it)
            if key in picks:
                out[key] = board_line(m, it, first)
                first = False
    return out


def build_script(week: dict, board_picks=None) -> str:
    import random

    rnd = random.Random(int(week["episode_date"].replace("-", "")))
    pick = lambda bank: bank[rnd.randrange(len(bank))]
    out: list[str] = []
    add = out.append
    brk = next_break(week)
    items = news_items(week)

    def say(anchor: int, *lines: str) -> None:
        add(f"[ANCHOR {anchor}]")
        add(" ".join(l for l in lines if l))
        add("")

    # ---- Anchor open: both anchors, a hook from the calendar, a preview.
    if week.get("prior_break"):
        hook = f"Welcome back from {week['prior_break']}. We hope you got some rest."
    elif brk:
        hook = f"It's the last week before {brk['reason']}, and we have a lot to cover."
    elif len(items) >= 3:
        hook = "It's a busy week in La Joya ISD, so let's get right to it."
    else:
        hook = "Here's what you need to know this week."
    say(1, pick(GREETINGS), "I'm [ANCHOR 1].")
    say(2, "And I'm [ANCHOR 2].", hook, pick(PREVIEWS))
    add("[CUE INTRO SEQUENCE]")
    add("")

    # ---- News: each story is a fact plus one plain line about why it matters.
    anchor = 1
    first = True
    reads = [it for it in items if it["kind"] == "read"]
    for it in items:
        if it["kind"] == "flag":
            add(f"[{it['fact']}]")
            add("")
            continue
        lead = pick(NEWS_STARTS) if first else ""
        hand = ""
        if not first and it is reads[min(2, len(reads) - 1)]:
            hand = pick(HANDOFFS).format(other=1 if anchor == 2 else 2)  # one handoff mid-block
        fact = it["fact"] + (f" [{it['verify']}]" if it["verify"] else "")
        say(anchor, hand, lead, fact, it["context"])
        anchor = 2 if anchor == 1 else 1
        first = False

    if (cl := closures_line(week)):
        say(anchor, cl)
        anchor = 2 if anchor == 1 else 1
    if brk:
        say(anchor, "Mark your calendars.",
            f"Next week is {brk['reason']}, so there's no school {_long_date(brk['first'])}, "
            f"through {_long_date(brk['last'])}.",
            f"Classes start back up {_long_date(brk['back'])}.")
        anchor = 2 if anchor == 1 else 1
    for line in board_pick_lines(week, board_picks).values():
        say(anchor, line)
        anchor = 2 if anchor == 1 else 1
    add(f"[ANCHOR {anchor}]")
    add("[ADD CAMPUS STORY: Jimmy Carter news or an RGN package]")
    add("")
    anchor = 2 if anchor == 1 else 1
    say(anchor, pick(WEATHER_TOSS))

    add("[CUE BUMPER]")
    add("")

    # ---- Weather (its own script on the start page).
    add("[WEATHER]")
    wx = (week.get("weather") or {}).get("script") or []
    if wx:
        # The reporter's name goes in front of the forecast's own opener.
        add("Hey, RedWolves! I'm [WEATHER REPORTER]. " + wx[0])
        out.extend(wx[1:])
    else:
        add("[ADD: weather read]")
    add("")
    add("[CUE BUMPER]")
    add("")
    add("[CUE STUDENT VOICES]")
    add("")
    add("[CUE MENU]")
    add("")

    # ---- Close: a quick reminder and the sign-off.
    if brk:
        say(1, "That's it for this week's RGN.",
            f"Remember, there's no school next week for {brk['reason']}.",
            f"We'll see you back on {brk['back'].strftime('%B')} {brk['back'].day}.")
        holiday = re.sub(r"\s*break$", "", brk["reason"], flags=re.I).strip()
        say(2, "Thanks for watching.",
            f"Have a safe and happy {holiday}, RedWolves!" if holiday else "Have a safe and happy break, RedWolves!")
    else:
        timed = [it for it in reads if it["verify"]]
        reminder = ""
        if timed:
            reminder = "Don't forget, " + timed[0]["fact"][0].lower() + timed[0]["fact"][1:]
        say(1, "That's it for this week's RGN.", reminder)
        say(2, "Thanks for watching.", pick(SIGN_OFFS))
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
