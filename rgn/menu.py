"""This week's school breakfast and lunch, as a short read for the menu segment.

The menus come from the lajoya-menus project, which downloads the district's
High School menu PDFs every day and saves them as a CSV:
date, weekday, breakfast, lunch (lunch items separated by "; ").
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import os
import re

from . import common as c

MENU_CSV = os.getenv(
    "RGN_MENU_CSV",
    "https://raw.githubusercontent.com/kh84949vnj-ui/lajoya-menus/main/output/menus.csv",
)
SOURCE_URL = "https://www.lajoyaisdcns.com/index.php?sid=0208131445498761&page=menus"


def parse_csv(text: str) -> dict[str, dict]:
    """{iso date: {"breakfast": str, "lunch": [items]}}"""
    out = {}
    for row in csv.DictReader(io.StringIO(text)):
        d = (row.get("date") or "").strip()
        if not d:
            continue
        lunch = [tidy(x) for x in (row.get("lunch") or "").split(";")]
        out[d] = {"breakfast": tidy(row.get("breakfast") or ""), "lunch": [x for x in lunch if x]}
    return out


def fetch() -> dict[str, dict]:
    return parse_csv(c.get(MENU_CSV).text)


def tidy(item: str) -> str:
    """Menu shorthand into words someone can read out loud."""
    s = re.sub(r"\s+", " ", item).strip()
    s = re.sub(r"\bw/\s*", "with ", s, flags=re.I)
    s = s.replace("&", "and")
    return s


def and_list(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def script(school_days: list[dt.date], menus: dict[str, dict]) -> tuple[list[str], list[str]]:
    """(lines to read, notes). One line per school day: breakfast, then lunch."""
    lines = ["Hey, RedWolves! Here's what's cookin' this week."]
    notes = []
    for d in school_days:
        day = c.DAY_NAMES[d.weekday()]
        m = menus.get(d.isoformat())
        if not m or (not m["breakfast"] and not m["lunch"]):
            lines.append(f"[ADD MENU: {day}]")
            notes.append(f"No menu posted for {c.fmt_date(d)}.")
            continue
        parts = []
        if m["breakfast"]:
            parts.append(f"On {day}, breakfast is {m['breakfast']}.")
        else:
            parts.append(f"On {day},")
        if m["lunch"]:
            main, sides = m["lunch"][0], m["lunch"][1:]
            lunch = f"For lunch, it's {main}" + (f", plus {and_list(sides)}." if sides else ".")
            parts.append(lunch if m["breakfast"] else lunch[0].lower() + lunch[1:])
        lines.append(" ".join(parts))
    lines.append("Enjoy your meals, RedWolves!")
    return lines, notes
