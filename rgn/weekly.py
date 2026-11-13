"""One weekly prep package: the weather read and the news tip sheet.

Episodes are recorded Friday or Monday and presented as recorded on Monday, for
that Monday-Friday week. Run this the day before recording (or that morning):

  python -m rgn.weekly                  # episode week (this Monday if today is Monday, else next Monday)
  python -m rgn.weekly --week 2026-11-30
  python -m rgn.weekly --publish        # also publish the episode script to the live prompter

Writes to output/<monday>/:
  RGN Prep <monday>.docx / .txt  plain doc, all black text
  RGN Script <monday>.txt        full episode script draft (also prompter/scripts/current.json)
  week.json                      data for the student page (also copied to site/week.json)
  weather.csv                    for Canva Bulk Create or weather graphics
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import subprocess
from pathlib import Path

from docx import Document
from docx.enum.text import WD_BREAK
from docx.shared import Pt, RGBColor

from . import common as c
from . import events as ev
from . import weather as wx
from .district_calendar import closures as find_closures, fetch_events, school_week

BLACK = RGBColor(0, 0, 0)
SITE_DIR = c.ROOT / "site"
PROMPTER_SCRIPT = c.ROOT / "prompter" / "scripts" / "current.json"


# ---------------------------------------------------------------- gather

def collect(monday: dt.date) -> dict:
    """Everything for the week as plain data (also what the student page reads)."""
    out = c.week_dir(monday)
    week, events = school_week(monday)
    now = dt.datetime.now(c.TZ)
    data: dict = {
        "episode_date": monday.isoformat(),
        "episode_label": c.fmt_date(monday) + f", {monday.year}",
        "generated": now.isoformat(timespec="minutes"),
        "generated_label": f"{c.fmt_date(now.date())} at {c.fmt_time(now)}",
        "school_days": [{"date": d.isoformat(), "day": c.DAY_NAMES[d.weekday()]} for d in week.school_days],
        "closures": [{"date": d.isoformat(), "label": c.fmt_date(d), "reason": r} for d, r in sorted(week.closures.items())],
        "prior_break": week.prior_break,
    }

    # Next week's closures, so the close can say "next week is Thanksgiving Break".
    try:
        nm = monday + dt.timedelta(days=7)
        nxt = find_closures(fetch_events(nm, nm + dt.timedelta(days=13)))
        data["next_closures"] = [{"date": d.isoformat(), "reason": r}
                                 for d, r in sorted(nxt.items()) if d.weekday() < 5]
    except Exception:
        data["next_closures"] = []

    try:
        w = wx.build(week)
        wx.write_outputs(w, out)
        data["weather"] = {
            "script": w.lines,
            "days": [
                {"day": c.DAY_NAMES[f.date.weekday()], "date": f.date.isoformat(), "high": f.high, "low": f.low,
                 "rain": f.rain, "conditions": f.conditions, "available": f.available,
                 "extended": f.extended}
                for f in w.days
            ],
            "updated": w.updated,
            "source": "National Weather Service, La Joya TX",
            "source_url": f"https://forecast.weather.gov/MapClick.php?lat={c.LAT}&lon={c.LON}",
            "notes": w.notes,
        }
    except Exception as ex:
        data["weather"] = {"error": f"Weather failed: {ex}. Check forecast.weather.gov for La Joya, TX."}

    try:
        t = ev.build(week, events)
        data["news"] = {
            "closures": t.closures,
            "leads": [
                {"when": l.when, "title": l.title, "url": l.url, "detail": l.detail, "flagged": bool(l.flagged),
                 "date": l.date, "end": l.end, "time": l.time}
                for l in t.leads
            ],
            "board": [
                {
                    "when": f"{c.fmt_date(mt.when.date())}, {c.fmt_time(mt.when)}",
                    "title": mt.title,
                    "url": mt.agenda_url,
                    "posted": mt.posted,
                    "agenda_pending": mt.from_calendar_only,
                    "items": [
                        {"number": it.number, "text": it.text, "flagged": bool(it.flagged),
                         "student_interest": it.student_interest}
                        for it in mt.items
                    ],
                }
                for mt in t.meetings
            ],
            "board_page": ev.BOARD_PAGE,
            "calendar_page": f"{c.DISTRICT_BASE}/calendar",
            "notes": t.notes,
        }
    except Exception as ex:
        data["news"] = {"error": f"Tip sheet failed: {ex}. Check {c.DISTRICT_BASE}/calendar and {ev.BOARD_PAGE}."}
    return data


# ---------------------------------------------------------------- doc

class PlainDoc:
    """Word doc with one font, black text, bold headings and nothing else."""

    def __init__(self) -> None:
        self.doc = Document()
        for style in self.doc.styles:
            font = getattr(style, "font", None)
            if font is not None:
                font.color.rgb = BLACK
        normal = self.doc.styles["Normal"]
        normal.font.name = "Arial"
        normal.font.size = Pt(11)
        normal.paragraph_format.space_after = Pt(4)
        self.text: list[str] = []

    def heading(self, s: str, size: int = 13) -> None:
        p = self.doc.add_paragraph()
        p.paragraph_format.space_before = Pt(10)
        r = p.add_run(s)
        r.bold = True
        r.font.size = Pt(size)
        r.font.color.rgb = BLACK
        self.text += ["", s.upper() if size > 13 else s, ""]

    def para(self, s: str = "", indent: int = 0, bold: bool = False) -> None:
        p = self.doc.add_paragraph()
        if indent:
            p.paragraph_format.left_indent = Pt(18 * indent)
        r = p.add_run(s)
        r.bold = bold
        r.font.color.rgb = BLACK
        self.text.append(("  " * indent) + s)

    def page_break(self) -> None:
        self.doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    def save(self, path: Path) -> None:
        self.doc.save(path)
        path.with_suffix(".txt").write_text("\n".join(self.text).strip() + "\n", encoding="utf-8")


def write_doc(data: dict, path: Path) -> None:
    d = PlainDoc()
    d.heading(f"Red Gold News prep: episode of {data['episode_label']}", 16)
    d.para(f"Generated {data['generated_label']}")
    days = data["school_days"]
    d.para("School days: " + ", ".join(x["day"] for x in days) if days else "No school days this week.")
    for x in data["closures"]:
        d.para(f"No school {x['label']}: {x['reason']}")

    w = data["weather"]
    d.heading("Weather read")
    if "error" in w:
        d.para(w["error"])
    else:
        for line in w["script"]:
            d.para(line)
        d.para(f"Source: {w['source']}, updated {w['updated']}")
        for n in w["notes"]:
            d.para(f"Note: {n}")

    n = data["news"]
    d.heading("News block tip sheet")
    d.para("Leads only. Students verify every item and write the final script. Flagged items get no draft.")
    if "error" in n:
        d.para(n["error"])
    else:
        if n["closures"]:
            d.para("No school / closures", bold=True)
            for x in n["closures"]:
                d.para(x, indent=1)
        d.para("District calendar", bold=True)
        for l in n["leads"]:
            d.para(f"{l['when']}: {l['title']}", indent=1)
            if l["detail"]:
                d.para(f"Details: {l['detail']}", indent=2)
            if l["flagged"]:
                d.para("FLAGGED (sensitive topic): no draft. Adviser review before any coverage.", indent=2)
            d.para(l["url"], indent=2)
        if not n["leads"]:
            d.para("(nothing listed)", indent=1)
        if n["board"]:
            d.para("School board this week", bold=True)
            for mt in n["board"]:
                d.para(f"{mt['when']}: {mt['title']}", indent=1)
                if mt["agenda_pending"]:
                    d.para("Agenda not on BoardBook yet (posted at least 72 hours ahead). Check before writing.", indent=2)
                elif mt["posted"]:
                    d.para(f"Agenda posted {mt['posted']}", indent=2)
                d.para(mt["url"], indent=2)
                for it in mt["items"]:
                    tag = " [FLAGGED: sensitive, no draft]" if it["flagged"] else (" [student interest]" if it["student_interest"] else "")
                    d.para(f"{it['number']} {it['text']}{tag}", indent=2)
        for x in n["notes"]:
            d.para(f"Note: {x}")
    d.save(path)


def run(monday: dt.date, board_picks_file: Path | None = None) -> Path:
    out = c.week_dir(monday)
    data = collect(monday)
    # Board agenda items picked on the Story Desk (saved by Claude from the
    # page, or written by hand): a JSON list of item keys.
    picks_path = board_picks_file or out / "board_picks.json"
    board_picks = json.loads(picks_path.read_text(encoding="utf-8")) if picks_path.exists() else []
    path = out / f"RGN Prep {monday.isoformat()}.docx"
    write_doc(data, path)
    (out / "week.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
    SITE_DIR.mkdir(exist_ok=True)
    shutil.copy(out / "week.json", SITE_DIR / "week.json")

    # Full episode script for the prompter (public sources only: district
    # calendar and NWS, with anchor names left as placeholders).
    from .episode import board_pick_lines, build_script

    text = build_script(data, board_picks)
    (out / f"RGN Script {monday.isoformat()}.txt").write_text(text, encoding="utf-8")
    PROMPTER_SCRIPT.parent.mkdir(parents=True, exist_ok=True)
    PROMPTER_SCRIPT.write_text(json.dumps({
        "episode_date": data["episode_date"],
        "episode_label": data["episode_label"],
        "generated": data["generated"],
        "generated_label": data["generated_label"],
        "text": text,
        # Board meetings this week, so the editor can offer agenda items to add.
        # BoardBook agendas are public; flagged items are marked and can't be added.
        "board": [
            {"when": m["when"], "title": m["title"], "url": m["url"], "agenda_pending": m["agenda_pending"],
             "items": [{"number": it["number"], "text": it["text"], "flagged": it["flagged"],
                        "student_interest": it["student_interest"]} for it in m["items"]]}
            for m in (data.get("news") or {}).get("board", [])
        ],
        # Items already written into the draft, so the prompter shows them checked.
        "board_picks": board_pick_lines(data, board_picks),
    }, indent=1), encoding="utf-8")
    return path


def publish(monday: dt.date) -> str:
    """Commit and push the prompter script so the live site picks it up."""
    rel = PROMPTER_SCRIPT.relative_to(c.ROOT)
    git = lambda *a: subprocess.run(["git", "-C", str(c.ROOT), *a], capture_output=True, text=True)
    git("add", str(rel))
    if git("diff", "--cached", "--quiet", "--", str(rel)).returncode == 0:
        return "Prompter script unchanged; nothing to publish."
    r = git("commit", "-m", f"Publish episode script for {monday.isoformat()}", "--", str(rel))
    if r.returncode != 0:
        raise SystemExit("Couldn't commit the prompter script: " + (r.stderr or r.stdout).strip())
    r = git("push")
    if r.returncode != 0:
        raise SystemExit("Committed, but the push failed: " + r.stderr.strip())
    return "Published. The live prompter will have it in a minute or two."


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--week", help="any date in the target week (default: the episode week)")
    ap.add_argument("--publish", action="store_true", help="commit and push the episode script to the live prompter")
    ap.add_argument("--board-picks", type=Path, help="JSON list of board item keys to include (default: output/<monday>/board_picks.json)")
    args = ap.parse_args()
    path = run(c.parse_week(args.week), args.board_picks)
    print("Saved", path)
    print("Saved", path.with_suffix(".txt"))
    print("Saved", SITE_DIR / "week.json", "(publish this with the student page)")
    print("Saved", PROMPTER_SCRIPT)
    if args.publish:
        print(publish(c.parse_week(args.week)))


if __name__ == "__main__":
    main()
