"""News block tip sheet: district calendar events plus BoardBook agendas.

This is a list of leads, not a script. Students verify each one and write the
final copy. Anything matching data/sensitive_keywords.txt is FLAGGED with no
suggested lead so an adult decides how (or whether) to cover it.

The board section only appears when the board (or a board committee) meets
during the week, either on BoardBook or on the district calendar.

  python -m rgn.events [--week 2026-11-09]
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
from dataclasses import dataclass, field

from bs4 import BeautifulSoup

from . import common as c
from .district_calendar import Event

BOARD_PAGE = f"{c.BOARDBOOK_BASE}/Public/Organization/{c.BOARDBOOK_ORG}"

# Agenda sections that are procedure, not news.
SKIP_SECTIONS = re.compile(
    r"^(call (the )?meeting to order|roll call|pledge|invocation|public comments?|closed session|"
    r"reconvene|adjourn|approval of minutes|next meeting|.*remarks$)",
    re.I,
)
STUDENT_INTEREST = re.compile(
    r"\b(student|campus|high school|early college|jimmy carter|calendar|schedule|uniform|"
    r"dress code|graduation|athletic|football|band|choir|dual credit|scholarship|recognition|"
    r"lunch|nutrition|safety|bus|transportation|technology)\b",
    re.I,
)


@dataclass
class Lead:
    when: str
    title: str
    url: str
    flagged: list[str] = field(default_factory=list)
    detail: str = ""
    date: str = ""       # ISO start date
    end: str = ""        # ISO end date (same as date for one-day events)
    time: str = ""       # "6:30 PM", or "" for all-day events

    @property
    def suggestion(self) -> str:
        if self.flagged:
            return "FLAGGED (sensitive topic): no draft. Adviser review before any coverage."
        return f"Possible lead: {self.title}, {self.when}."


@dataclass
class AgendaItem:
    number: str
    text: str
    flagged: list[str] = field(default_factory=list)
    student_interest: bool = False


@dataclass
class Meeting:
    when: dt.datetime
    title: str
    agenda_url: str
    posted: str = ""
    items: list[AgendaItem] = field(default_factory=list)
    from_calendar_only: bool = False


@dataclass
class TipSheet:
    leads: list[Lead]
    closures: list[str]
    meetings: list[Meeting]
    notes: list[str]


# ---------------------------------------------------------------- BoardBook

MEETING_RE = re.compile(
    r"^(?P<date>[A-Z][a-z]+ \d{1,2}, \d{4}) at (?P<time>\d{1,2}:\d{2} [AP]M) - (?P<title>.+?)"
    r"(?: Meeting Type:.*?)?(?: Posted: (?P<posted>.+?))?(?: By:.*)?$"
)


def board_meetings() -> list[Meeting]:
    soup = BeautifulSoup(c.get(BOARD_PAGE).text, "html.parser")
    out = []
    for tr in soup.select("table tr"):
        tds = tr.find_all("td")
        if not tds:
            continue
        text = re.sub(r"\s+", " ", tds[0].get_text(" ", strip=True).replace("\xa0", " "))
        m = MEETING_RE.match(text)
        if not m:
            continue
        when = dt.datetime.strptime(f"{m['date']} {m['time']}", "%B %d, %Y %I:%M %p").replace(tzinfo=c.TZ)
        agenda = next((a["href"] for a in tr.find_all("a", href=True) if "/Public/Agenda/" in a["href"]), "")
        out.append(Meeting(
            when=when,
            title=m["title"].strip(),
            agenda_url=c.BOARDBOOK_BASE + agenda if agenda.startswith("/") else agenda,
            posted=(m["posted"] or "").strip(),
        ))
    return out


def agenda_items(url: str, sensitive: list[str]) -> list[AgendaItem]:
    """Newsworthy agenda items (up to 3 levels deep), procedure skipped."""
    soup = BeautifulSoup(c.get(url).text, "html.parser")
    items: list[AgendaItem] = []
    skip_prefix: str | None = None
    for tr in soup.select("tr.agenda-item-information"):
        box = tr.select_one("div.form-check")
        text = re.sub(r"\s+", " ", (box or tr).get_text(" ", strip=True))
        m = re.match(r"^(\d+(?:\.\d+)*)\.\s*(.*)$", text)
        if not m:
            continue
        num, body = m.groups()
        body = re.sub(r"\s*-\s*\((?:[A-Z][\w &]+)\)\s*", " ", body).strip(" -,")  # drop "(Goal tag)"
        depth = num.count(".") + 1
        if skip_prefix and (num == skip_prefix or num.startswith(skip_prefix + ".")):
            continue
        skip_prefix = None
        if SKIP_SECTIONS.match(body):
            skip_prefix = num
            continue
        if depth > 3 or body.endswith(":"):  # category headers like "Business, Finance :"
            continue
        if depth == 1 and _has_children(tr):
            continue  # the section title; its children are the news
        items.append(AgendaItem(
            number=num,
            text=body[:220] + ("..." if len(body) > 220 else ""),
            flagged=c.matches_any(body, sensitive),
            student_interest=bool(STUDENT_INTEREST.search(body)),
        ))
    return items


def _has_children(tr) -> bool:
    inp = tr.select_one("input.hasChildren")
    return bool(inp and inp.get("value") == "true")


# ---------------------------------------------------------------- tip sheet

def build(week: c.SchoolWeek, events: list[Event]) -> TipSheet:
    sensitive = c.load_keywords("sensitive_keywords.txt")
    notes: list[str] = []
    leads: list[Lead] = []
    closures: list[str] = []

    for e in events:
        if e.all_day and c.CLOSURE_RE.search(e.title):
            closures.append(f"{e.when}: {e.title}")
            continue
        if re.search(r"\bboard (meeting|workshop)\b", e.title, re.I):
            continue  # covered in the board section
        leads.append(Lead(
            when=e.when,
            title=e.title,
            url=e.url,
            flagged=c.matches_any(f"{e.title} {e.description}", sensitive),
            detail=e.description[:300],
            date=e.start.isoformat(),
            end=e.end.isoformat(),
            time=c.fmt_time(e.time) if e.time else "",
        ))

    start = dt.datetime.combine(week.monday, dt.time(), c.TZ)
    end = start + dt.timedelta(days=7)
    meetings: list[Meeting] = []
    try:
        meetings = [m for m in board_meetings() if start <= m.when < end]
    except Exception as ex:  # BoardBook down should not sink the whole doc
        notes.append(f"Could not read BoardBook ({ex}). Check {BOARD_PAGE} by hand.")
    for m in meetings:
        if m.agenda_url:
            try:
                m.items = agenda_items(m.agenda_url, sensitive)
            except Exception as ex:
                notes.append(f"Could not read the agenda for {m.title} ({ex}).")

    # Board meetings on the district calendar whose agenda is not posted yet.
    for e in events:
        if e.time and re.search(r"\bboard (meeting|workshop)\b", e.title, re.I):
            if not any(m.when.date() == e.start for m in meetings):
                meetings.append(Meeting(when=e.time, title=e.title, agenda_url=BOARD_PAGE, from_calendar_only=True))
    meetings.sort(key=lambda m: m.when)

    if not leads:
        notes.append("No district calendar events this week. Ask campus staff for school news.")
    return TipSheet(leads=leads, closures=closures, meetings=meetings, notes=notes)


def as_text(t: TipSheet) -> str:
    out: list[str] = ["Leads only. Verify every item and write your own script."]
    if t.closures:
        out += ["", "No school / closures:"] + [f"- {x}" for x in t.closures]
    out += ["", "District calendar:"]
    for l in t.leads:
        out.append(f"- {l.when}: {l.title}")
        if l.detail:
            out.append(f"  Details: {l.detail}")
        if l.flagged:
            out.append(f"  {l.suggestion}")
        out.append(f"  Link: {l.url}")
    if not t.leads:
        out.append("- (nothing listed)")
    if t.meetings:
        out += ["", "School board this week:"]
        for m in t.meetings:
            out.append(f"- {c.fmt_date(m.when.date())}, {c.fmt_time(m.when)}: {m.title}")
            if m.from_calendar_only:
                out.append("  On the district calendar, agenda not posted on BoardBook yet (agendas post at least 72 hours ahead). Check again before writing.")
            elif m.posted:
                out.append(f"  Agenda posted {m.posted}")
            out.append(f"  Link: {m.agenda_url}")
            for it in m.items:
                tag = " [FLAGGED: sensitive, no draft]" if it.flagged else (" [student interest]" if it.student_interest else "")
                out.append(f"    {it.number} {it.text}{tag}")
    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--week", help="any date in the target week (default: next Monday)")
    args = ap.parse_args()

    from .district_calendar import school_week

    week, events = school_week(c.parse_week(args.week))
    t = build(week, events)
    text = as_text(t)
    (c.week_dir(week.monday) / "tip_sheet.txt").write_text(text + "\n", encoding="utf-8")
    print(text)
    for n in t.notes:
        print("NOTE:", n)


if __name__ == "__main__":
    main()
