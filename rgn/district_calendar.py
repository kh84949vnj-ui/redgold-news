"""District calendar (lajoyaisd.com, ParentSquare site, fed from a Google Calendar).

The public site loads events from a JSON endpoint:
  https://www.lajoyaisd.com/api/calendars/145985/events?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
No key needed. Times come back in UTC and are converted to Central time here.
"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass

from . import common as c


@dataclass
class Event:
    id: str
    title: str
    start: dt.date
    end: dt.date  # inclusive
    time: dt.datetime | None  # local start time, None if all-day
    all_day: bool
    description: str
    url: str

    @property
    def when(self) -> str:
        if self.start != self.end:
            return f"{c.fmt_date(self.start)} through {c.fmt_date(self.end)}"
        s = c.fmt_date(self.start)
        return f"{s}, {c.fmt_time(self.time)}" if self.time else f"{s} (all day)"


def fetch_events(start: dt.date, end: dt.date) -> list[Event]:
    """Events overlapping start..end (inclusive), oldest first, repeats merged."""
    r = c.get(
        f"{c.DISTRICT_BASE}/api/calendars/{c.DISTRICT_CALENDAR_ID}/events",
        params={
            "start_date": (start - dt.timedelta(days=1)).isoformat(),
            "end_date": (end + dt.timedelta(days=1)).isoformat(),
            "view_source": "event-slider",
        },
        headers={"Accept": "application/json"},
    )
    payload = r.json()
    if not payload.get("success"):
        raise RuntimeError(f"District calendar error: {payload.get('error')}")

    events: list[Event] = []
    for e in payload["data"]["events"]:
        if e["all_day"]:
            s = dt.date.fromisoformat(e["start_date"])
            en = dt.date.fromisoformat(e["end_date"])
            if en > s:  # Google all-day end dates are exclusive
                en -= dt.timedelta(days=1)
            t = None
        else:
            t = dt.datetime.fromisoformat(e["start_datetime"]).astimezone(c.TZ)
            s = en = t.date()
        if en < start or s > end:
            continue
        link = e.get("event_url") or e.get("link") or ""
        if link.startswith("/"):
            link = c.DISTRICT_BASE + link
        events.append(
            Event(
                id=e["id"],
                title=re.sub(r"\s+", " ", e["title"]).strip(),
                start=s,
                end=en,
                time=t,
                all_day=e["all_day"],
                description=(e.get("description") or "").strip(),
                url=link,
            )
        )
    return merge_repeats(sorted(events, key=lambda x: (x.start, x.time or dt.datetime.min.replace(tzinfo=c.TZ))))


def merge_repeats(events: list[Event]) -> list[Event]:
    """Collapse the same all-day event repeated on back-to-back days into a range."""
    out: list[Event] = []
    for e in events:
        prev = next((p for p in reversed(out) if p.all_day and e.all_day and p.title == e.title), None)
        if prev and (e.start - prev.end).days <= 1:
            prev.end = max(prev.end, e.end)
            continue
        out.append(e)
    return out


def closure_reason(title: str) -> str:
    """'Thanksgiving Break (Schools/Offices Closed)' -> 'Thanksgiving Break'."""
    return re.sub(r"\s*\(.*?\)\s*", " ", title).strip()


def closures(events: list[Event]) -> dict[dt.date, str]:
    out: dict[dt.date, str] = {}
    for e in events:
        if e.all_day and c.CLOSURE_RE.search(e.title):
            d = e.start
            while d <= e.end:
                out.setdefault(d, closure_reason(e.title))
                d += dt.timedelta(days=1)
    return out


def school_week(monday: dt.date) -> tuple[c.SchoolWeek, list[Event]]:
    """Build the SchoolWeek for monday and return the week's events (Mon-Sun).

    Also looks at the previous week so the weather read can say
    "welcome back" after a break.
    """
    prev_monday = monday - dt.timedelta(days=7)
    events = fetch_events(prev_monday, monday + dt.timedelta(days=6))
    closed = closures(events)

    week = c.SchoolWeek(monday=monday)
    week.closures = {d: r for d, r in closed.items() if d in week.days}

    prev_closed = [d for d in c.weekdays(prev_monday) if d in closed]
    if len(prev_closed) >= 3:  # most of last week off counts as a break
        week.prior_break = closed[prev_closed[-1]]

    this_week = [e for e in events if e.end >= monday]
    return week, this_week
