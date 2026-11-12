"""Menu read for the week.

Source, in order of preference:
  1. --csv FILE: a CSV you already have (for example from the Apps Script
     project). Columns: date, breakfast, entree, sides  (sides separated by ;)
  2. Otherwise the monthly menu PDF from lajoyaisdcns.com is downloaded and
     parsed. On those PDFs breakfast is printed in red and lunch in black, and
     an empty day box means no school.

Read pattern:
  "[Day], [breakfast] for breakfast. Lunch will be [entree] with [sides]."

Outputs (in output/<monday>/): menu.csv (one row per school day, ready for
Canva Bulk Create), menu_read.txt, and menu_read.mp3 with --tts.

  python -m rgn.menu [--week 2026-11-09] [--csv my_menu.csv] [--tts]
"""
from __future__ import annotations

import argparse
import calendar
import csv
import datetime as dt
import re
from dataclasses import dataclass, field
from pathlib import Path

from bs4 import BeautifulSoup

from . import common as c


@dataclass
class MenuDay:
    date: dt.date
    breakfast: str = ""
    entree: str = ""
    sides: list[str] = field(default_factory=list)
    note: str = ""  # anything the parser was unsure about

    @property
    def empty(self) -> bool:
        return not (self.breakfast or self.entree)


# ---------------------------------------------------------------- PDF source

def find_menu_pdf(year: int, month: int) -> str | None:
    """URL of the month's menu PDF (link text like 'November High School Menu')."""
    r = c.get(
        f"{c.CNS_BASE}/index.php",
        params={"sid": c.CNS_SID, "page": "menus", "sm": month, "sy": year},
    )
    soup = BeautifulSoup(r.text, "html.parser")
    month_name = calendar.month_name[month].lower()
    for a in soup.find_all("a", href=True):
        text = a.get_text(" ", strip=True).lower()
        if c.MENU_LABEL.lower() in text and month_name in text and "downloadMenu" in a["href"]:
            href = a["href"]
            return href if href.startswith("http") else c.CNS_BASE + "/" + href.lstrip("/")
    return None


def download_pdf(url: str, year: int, month: int) -> Path:
    c.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = c.CACHE_DIR / f"menu_{year}-{month:02d}.pdf"
    path.write_bytes(c.get(url).content)
    return path


def _is_red(color) -> bool:
    return isinstance(color, (tuple, list)) and len(color) == 3 and color[0] > 0.7 and color[1] < 0.3 and color[2] < 0.3


def _lines(words: list[dict]) -> list[tuple[str, bool]]:
    """Group words into text lines -> [(text, is_red)] top to bottom."""
    rows: list[list[dict]] = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if rows and abs(rows[-1][0]["top"] - w["top"]) < 3:
            rows[-1].append(w)
        else:
            rows.append([w])
    return [
        (" ".join(w["text"] for w in sorted(r, key=lambda w: w["x0"])), _is_red(r[0]["non_stroking_color"]))
        for r in rows
    ]


JOIN_END = re.compile(r"(\bw/|&|,|\band|\bwith)$", re.I)
JOIN_START = re.compile(r"^(w/|&|with\b|[a-z])")
# A one-word line right after the entree is usually the entree wrapping
# ("Cherry Blossom" / "Chicken"), unless it is a common side.
COMMON_SIDES = {
    "fries", "salad", "corn", "rice", "beans", "fruit", "tots", "broccoli", "carrots",
    "coleslaw", "chips", "vegetables", "potatoes", "applesauce", "milk", "juice",
}


def _known_items() -> set[str]:
    return set(c.load_keywords("menu_known_items.txt"))


def _join_wraps(lines: list[str]) -> list[str]:
    known = _known_items()

    def join_entree_word(ls: list[str]) -> None:
        if len(ls) >= 2 and " " not in ls[1] and not ls[1].lower().startswith("w/") and ls[1].lower() not in COMMON_SIDES:
            ls[0] = f"{ls[0]} {ls[1]}"
            del ls[1]

    lines = list(lines)
    # Known multi-line items first ("Chili & Cheese" / "Hot Dog").
    i = 0
    while i < len(lines) - 1:
        if f"{lines[i]} {lines[i + 1]}".lower() in known:
            lines[i : i + 2] = [f"{lines[i]} {lines[i + 1]}"]
        else:
            i += 1
    join_entree_word(lines)  # "Cherry Blossom" / "Chicken"
    out: list[str] = []
    for ln in lines:
        if out and (JOIN_END.search(out[-1]) or JOIN_START.search(ln)):
            out[-1] = f"{out[-1]} {ln}"
        else:
            out.append(ln)
    join_entree_word(out)  # "...w/Garlic" / "Breadstick"
    return out


def parse_menu_pdf(path: Path, year: int, month: int) -> dict[dt.date, MenuDay]:
    import pdfplumber

    days: dict[dt.date, MenuDay] = {}
    with pdfplumber.open(path) as pdf:
        page = pdf.pages[0]
        words = page.extract_words(extra_attrs=["size", "non_stroking_color", "fontname"])

    # Day numbers are the big (~14pt) digits inside the calendar grid.
    nums = [w for w in words if w["text"].isdigit() and 12 <= w["size"] <= 16 and w["top"] > 90 and int(w["text"]) <= 31]
    if not nums:
        raise RuntimeError(f"Could not find day numbers in {path.name}; the PDF layout may have changed.")
    cols = sorted({round(w["x0"]) for w in nums})
    cols = [x for i, x in enumerate(cols) if i == 0 or x - cols[i - 1] > 40]
    rows = sorted({round(w["top"]) for w in nums})
    rows = [y for i, y in enumerate(rows) if i == 0 or y - rows[i - 1] > 20]
    col_w = (cols[-1] - cols[0]) / max(len(cols) - 1, 1)
    row_h = (rows[-1] - rows[0]) / max(len(rows) - 1, 1)
    small = [w for w in words if w["size"] < 12]

    for n in nums:
        day = int(n["text"])
        try:
            date = dt.date(year, month, day)
        except ValueError:
            continue
        ci = min(range(len(cols)), key=lambda i: abs(cols[i] - n["x0"]))
        ri = min(range(len(rows)), key=lambda i: abs(rows[i] - n["top"]))
        x0, x1 = cols[ci] - 5, (cols[ci + 1] - 5 if ci + 1 < len(cols) else cols[ci] + col_w - 5)
        y0, y1 = rows[ri] - 8, (rows[ri + 1] - 8 if ri + 1 < len(rows) else rows[ri] + row_h - 8)
        cell = [w for w in small if x0 <= w["x0"] < x1 and y0 <= w["top"] < y1]
        lines = _lines(cell)
        md = MenuDay(date=date)
        md.breakfast = " ".join(t for t, red in lines if red)
        lunch = _join_wraps([t for t, red in lines if not red])
        if lunch:
            md.entree, md.sides = lunch[0], lunch[1:]
        if md.breakfast and not md.entree:
            md.note = "breakfast only on the PDF"
        days[date] = md
    return days


# ---------------------------------------------------------------- CSV source

def load_menu_csv(path: Path) -> dict[dt.date, MenuDay]:
    """Read date,breakfast,entree,sides. Header names are matched loosely."""
    days: dict[dt.date, MenuDay] = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        keys = {k.lower().strip(): k for k in reader.fieldnames or []}

        def col(*names):
            for n in names:
                for k, orig in keys.items():
                    if n in k:
                        return orig
            return None

        kd, kb = col("date"), col("breakfast")
        ke, ks = col("entree", "lunch"), col("side")
        if not kd:
            raise ValueError(f"{path} needs a 'date' column")
        for row in reader:
            raw = (row.get(kd) or "").strip()
            if not raw:
                continue
            date = _parse_date(raw)
            sides = re.split(r"\s*[;|]\s*", row.get(ks) or "") if ks else []
            days[date] = MenuDay(
                date=date,
                breakfast=(row.get(kb) or "").strip() if kb else "",
                entree=(row.get(ke) or "").strip() if ke else "",
                sides=[s for s in sides if s],
            )
    return days


def _parse_date(raw: str) -> dt.date:
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return dt.datetime.strptime(raw, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"Unrecognized date: {raw!r}")


# ---------------------------------------------------------------- the read

def load_fixes() -> list[tuple[str, str]]:
    path = c.DATA_DIR / "menu_fixes.csv"
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return [(r["find"], r["replace"]) for r in csv.DictReader(f) if r.get("find")]


def clean(text: str, fixes: list[tuple[str, str]]) -> str:
    for a, b in fixes:
        text = text.replace(a, b)
    return re.sub(r"\s+", " ", text).strip()


def spoken(text: str) -> str:
    """Make menu shorthand read naturally for the anchor / TTS."""
    text = re.sub(r"\bw/\s*", "with ", text)
    text = text.replace("&", "and")
    return re.sub(r"\s+", " ", text).strip()


def join_list(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def canva_lines(days: list[MenuDay]) -> list[str]:
    """Menu text for the Canva graphic: one block per school day, blank line between.

    MONDAY
    Breakfast: Mini Donuts
    Lunch: Chicken Burger, Tater Tots, Burger Salad
    """
    out: list[str] = []
    for md in days:
        if out:
            out.append("")
        out.append(c.DAY_NAMES[md.date.weekday()].upper())
        if md.breakfast:
            out.append(f"Breakfast: {md.breakfast}")
        if md.entree:
            out.append("Lunch: " + ", ".join([md.entree] + md.sides))
    return out


# Opening line of the menu voiceover. Edit here to change it.
MENU_INTRO = f"Hey {c.MASCOT}, here's what's cookin' this week."


def read_line(md: MenuDay) -> str:
    day = c.DAY_NAMES[md.date.weekday()]
    parts = []
    if md.breakfast:
        parts.append(f"{day}, {spoken(md.breakfast)} for breakfast.")
    else:
        parts.append(f"{day}:")
    if md.entree:
        entree = spoken(md.entree)
        sides = join_list([spoken(s) for s in md.sides])
        if sides:
            glue = ", along with" if " with " in f" {entree} " else " with"
            parts.append(f"Lunch will be {entree}{glue} {sides}.")
        else:
            parts.append(f"Lunch will be {entree}.")
    return " ".join(parts)


@dataclass
class MenuResult:
    days: list[MenuDay]
    lines: list[str]  # one per school day (menu.csv rows line up with these)
    notes: list[str]
    sources: list[str]

    @property
    def script_lines(self) -> list[str]:
        """The full voiceover read: the opening line, then one line per day."""
        return [MENU_INTRO] + self.lines if self.lines else []

    @property
    def script(self) -> str:
        return "\n".join(self.script_lines)


def build(week: c.SchoolWeek, csv_path: Path | None = None) -> MenuResult:
    notes: list[str] = []
    sources: list[str] = []
    menu: dict[dt.date, MenuDay] = {}
    loaded: set[tuple[int, int]] = set()

    if csv_path:
        menu = load_menu_csv(csv_path)
        sources.append(str(csv_path))
        loaded = {(d.year, d.month) for d in week.days}
    else:
        for y, m in sorted({(d.year, d.month) for d in week.school_days}):
            url = find_menu_pdf(y, m)
            if not url:
                notes.append(f"No {calendar.month_name[m]} {c.MENU_LABEL} posted yet on lajoyaisdcns.com.")
                continue
            sources.append(url)
            menu.update(parse_menu_pdf(download_pdf(url, y, m), y, m))
            loaded.add((y, m))

    fixes = load_fixes()
    days, lines = [], []
    for d in week.days:
        if d in week.closures:
            continue
        md = menu.get(d)
        if md is None or md.empty:
            if (d.year, d.month) in loaded:  # skip when that month's menu is missing entirely
                notes.append(f"{c.fmt_date(d)}: no menu listed (calendar shows school). Skipped; check.")
            continue
        md.breakfast = clean(md.breakfast, fixes)
        md.entree = clean(md.entree, fixes)
        md.sides = [clean(s, fixes) for s in md.sides]
        if md.note:
            notes.append(f"{c.fmt_date(d)}: {md.note}.")
        days.append(md)
        lines.append(read_line(md))
    return MenuResult(days=days, lines=lines, notes=notes, sources=sources)


def write_outputs(res: MenuResult, out: Path) -> None:
    with open(out / "menu.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["day", "date", "breakfast", "entree", "sides", "read"])
        for md, line in zip(res.days, res.lines):
            w.writerow([c.DAY_NAMES[md.date.weekday()], md.date.isoformat(), md.breakfast, md.entree, "; ".join(md.sides), line])
    (out / "menu_read.txt").write_text(res.script + "\n", encoding="utf-8")
    (out / "menu_canva.txt").write_text("\n".join(canva_lines(res.days)) + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--week", help="any date in the target week (default: next Monday)")
    ap.add_argument("--csv", type=Path, help="use this menu CSV instead of the district PDF")
    ap.add_argument("--tts", action="store_true", help="also make menu_read.mp3 with ElevenLabs")
    args = ap.parse_args()

    from .district_calendar import school_week

    week, _ = school_week(c.parse_week(args.week))
    res = build(week, args.csv)
    out = c.week_dir(week.monday)
    write_outputs(res, out)
    print(res.script or "(no school days with a menu this week)")
    for n in res.notes:
        print("NOTE:", n)
    if args.tts and res.lines:
        from .tts import synthesize

        print("Saved", synthesize(res.script, out / "menu_read.mp3"))


if __name__ == "__main__":
    main()
