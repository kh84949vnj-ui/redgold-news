"""Shared settings and helpers for the Red Gold News prep scripts."""
from __future__ import annotations

import datetime as dt
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
OUTPUT_DIR = ROOT / "output"
CACHE_DIR = OUTPUT_DIR / "cache"

load_dotenv(ROOT / ".env")

TZ = ZoneInfo("America/Chicago")

# La Joya, TX. NWS maps this to the Brownsville office (BRO) grid.
LAT = float(os.getenv("RGN_LAT", "26.2470"))
LON = float(os.getenv("RGN_LON", "-98.4814"))

DISTRICT_BASE = "https://www.lajoyaisd.com"
DISTRICT_CALENDAR_ID = 145985  # "LJISD Calendar" on the ParentSquare site
BOARDBOOK_ORG = 3263
BOARDBOOK_BASE = "https://meetings.boardbook.org"

# How the show writes the mascot (matches the weekly script doc).
MASCOT = "RedWolves"

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

# All-day calendar events with these words mean students are not in class.
CLOSURE_RE = re.compile(
    r"\b(break|closed|no school|student holiday|staff development|"
    r"professional development|teacher work ?day|bad weather)\b",
    re.I,
)


def user_agent() -> str:
    contact = os.getenv("NWS_CONTACT", "").strip()
    return f"RedGoldNews/1.0 (student news program{', ' + contact if contact else ''})"


_session: requests.Session | None = None


def http() -> requests.Session:
    global _session
    if _session is None:
        _session = requests.Session()
        _session.headers["User-Agent"] = user_agent()
    return _session


def get(url: str, **kw) -> requests.Response:
    kw.setdefault("timeout", 30)
    r = http().get(url, **kw)
    r.raise_for_status()
    return r


def next_monday(today: dt.date | None = None) -> dt.date:
    """Monday of the episode week.

    Episodes are recorded Friday or Monday and always presented as recorded on
    Monday, for that Monday-Friday week. So on a Monday this is today; any other
    day (Thursday/Friday prep, Sunday prep) it is the coming Monday.
    """
    today = today or dt.datetime.now(TZ).date()
    return today if today.weekday() == 0 else today + dt.timedelta(days=7 - today.weekday())


def parse_week(arg: str | None) -> dt.date:
    """--week accepts any date; it is snapped back to that week's Monday."""
    if not arg:
        return next_monday()
    d = dt.date.fromisoformat(arg)
    return d - dt.timedelta(days=d.weekday())


def weekdays(monday: dt.date) -> list[dt.date]:
    return [monday + dt.timedelta(days=i) for i in range(5)]


def week_dir(monday: dt.date) -> Path:
    p = OUTPUT_DIR / monday.isoformat()
    p.mkdir(parents=True, exist_ok=True)
    return p


def fmt_date(d: dt.date) -> str:
    return f"{DAY_NAMES[d.weekday()]}, {d.strftime('%B')} {d.day}"


def fmt_time(t: dt.datetime) -> str:
    return t.strftime("%I:%M %p").lstrip("0")


def load_keywords(name: str) -> list[str]:
    path = DATA_DIR / name
    if not path.exists():
        return []
    return [
        ln.strip().lower()
        for ln in path.read_text(encoding="utf-8").splitlines()
        if ln.strip() and not ln.lstrip().startswith("#")
    ]


def matches_any(text: str, keywords: list[str]) -> list[str]:
    low = text.lower()
    return [k for k in keywords if re.search(r"\b" + re.escape(k) + r"\b", low)]


@dataclass
class SchoolWeek:
    """Which weekdays have school, based on the district calendar."""

    monday: dt.date
    closures: dict[dt.date, str] = field(default_factory=dict)  # date -> reason
    prior_break: str | None = None  # set when the previous week was a break

    @property
    def days(self) -> list[dt.date]:
        return weekdays(self.monday)

    @property
    def school_days(self) -> list[dt.date]:
        return [d for d in self.days if d not in self.closures]
