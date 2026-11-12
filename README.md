# Red Gold News prep scripts

Weekly prep for the Red Gold News program at Jimmy Carter Early College High
School (La Joya ISD). These scripts take over the repetitive prep work. Students
still do the reporting.

Phase 1 (this folder): one dated prep doc with the weather read, the menu read,
and a news tip sheet, generated the day before recording.

## Setup (once)

```bash
cd redgold-news
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # then fill in .env (never commit it)
```

## Weekly run

```bash
python -m rgn.weekly
```

That makes `output/<monday>/`:

| File | What it is |
|---|---|
| `RGN Prep <monday>.docx` / `.txt` | The weekly doc: weather read, menu read, tip sheet |
| `weather.csv` | Day, high, low, rain chance, conditions (for Canva Bulk Create or Phase 2 graphics) |
| `menu.csv` | Day, breakfast, entree, sides, and the finished read line (for Canva Bulk Create) |
| `menu_read.mp3` | ElevenLabs voiceover, only with `--tts` |
| `week.json` | Data for the student page (also copied to `site/week.json`) |
| `tip_sheet.txt` | Only when you run `python -m rgn.events` by itself |

Options:

- `--week 2026-11-30` targets the week with that date. The default is the episode week. Episodes are recorded on Friday or Monday and always air as Monday's episode for that Monday through Friday. Run on a Monday, the scripts use that same week. Run on any other day (for example Thursday before a Friday recording), they use the next Monday.
- `--tts` sends the menu read to ElevenLabs and saves the MP3. This needs `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` in `.env`.
- `--menu-csv FILE` uses your own menu CSV instead of the district PDF.

Each piece also runs by itself: `python -m rgn.weather`, `python -m rgn.menu [--tts]`, `python -m rgn.events`.

## Where the data comes from

- **School days.** The district calendar on lajoyaisd.com. It is a ParentSquare site fed from a Google Calendar, with a public JSON feed at `/api/calendars/145985/events`. All-day events with words like "Break", "Closed", "Student Holiday" or "Staff Development" count as no-school days. All three pieces skip those days.
- **Menu.** The monthly High School menu PDF from lajoyaisdcns.com. Breakfast is printed in red and lunch in black. An empty day box means no school. The parser joins items that wrap across lines. Two files in `data/` fix what it gets wrong:
  - `data/menu_fixes.csv` fixes spelling. For example, the November PDF says "Cheses Steak".
  - `data/menu_known_items.txt` lists items that wrap across lines in a way the parser can't guess, like "Chili & Cheese / Hot Dog".
- **Weather.** api.weather.gov for La Joya (the Brownsville office's grid point). The low is the overnight low before each school day. NWS forecasts only reach about 7 days out, so run this the day before recording. The read starts with "Welcome back from ___" when most of the previous week was a break, and it mentions any no-school days in the week.
- **Tip sheet.** Lists district calendar events for Monday through Sunday with links. The board section only appears when the board or a board committee meets that week. It pulls from BoardBook (org 3263), lists the agenda items with procedure removed, and tags some items "[student interest]". If a board meeting is on the district calendar but its agenda isn't posted yet, the sheet says so.
- **Sensitive topics.** Anything that matches `data/sensitive_keywords.txt` is marked FLAGGED with no lead text, so an adult decides how to cover it. Edit that list as needed.

## Student page

`site/index.html` is the shareable Story Desk page. It shows the week in episode
order: news leads (block 3), weather (block 5) and menu (block 8). Each read has a
copy button. Flagged items show "See adviser" and have no copy button. The page
reads `site/week.json`, so updating it each week is a re-publish of that one file
after `python -m rgn.weekly`.

`site-script/index.html` is the Episode Script page: all 10 rundown blocks in order.
Students write the anchor open, news block and anchor close right on the page
(saved and shared, with "last edited by"). Weather and menu start from the
generated reads and can be edited or reset. "Open prompter" shows only the
on-camera reads, white on black, with cue cards for each package
(Space play/pause, arrows for speed, +/- for size, M to mirror for a beam-splitter
glass). It reads the same `week.json`; students need Contributor access to edit.

Weather timing: NWS's 7-day text forecast often stops at Thursday when you prep
the week before. Friday then comes from NWS grid data (marked "Early outlook"),
which can still shift. If you prep on Thursday for a
Friday recording, next Thursday and Friday won't have forecasts yet. In that
case the read covers through the last day it has ("through Wednesday") instead
of leaving gaps. Rerun the morning of recording to get the most days.

## Menu CSV format (if you keep the Apps Script project)

```
date,breakfast,entree,sides
2026-11-09,Mini Donuts,Chicken Burger,Tater Tots; Burger Salad
```

Dates can be `YYYY-MM-DD` or `MM/DD/YYYY`. Put a semicolon between sides. The
header names don't have to match exactly: `Lunch Entree` works for `entree`.

## Scheduling

Recording is on Friday or Monday, so run it the morning of recording. For example,
every Friday at 7 AM covers a Friday recording. On a Monday recording, run it by hand
that morning to get fresher weather:

- Mac/Linux, using `crontab -e`:
  `0 7 * * 5 cd /path/to/redgold-news && .venv/bin/python -m rgn.weekly`
- Windows: use Task Scheduler with the same command.

## Rules this project follows

- Keys live in `.env`, which is listed in `.gitignore`.
- Generated docs use one font, black text and bold headings, nothing else.
- Phase 2 involves footage of minors. Plan on local processing (local Whisper) and check district policy before sending any footage to an outside service.

## Phase 2 (not built yet)

The weather overlays can be made from `weather.csv`: transparent PNGs placed
over the Canva background, then joined with ffmpeg. The other Phase 2 pieces are
the student voices auto-cut, review notes, and compile-from-rundown.
