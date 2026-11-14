"""Weather read for the school days in the coming week (api.weather.gov, no key).

For each school day: conditions, the daytime high, the low the morning of
(overnight before school), and the daytime rain chance.

Main source is the NWS 7-day text forecast. Days it doesn't reach yet (often
Friday when prepping the week before) come from the NWS grid data, the raw
hourly numbers the forecasters publish a little further out. Those days are
marked "extended" and can shift, so rerun the morning of recording.

Outputs (in output/<monday>/): weather.csv (one row per school day, ready for
Canva Bulk Create or Phase 2 graphics) and weather_read.txt.

  python -m rgn.weather [--week 2026-11-09]
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import re
from dataclasses import dataclass
from pathlib import Path

from . import common as c


@dataclass
class DayForecast:
    date: dt.date
    high: int | None = None
    low: int | None = None
    rain: int | None = None  # percent
    conditions: str = ""
    detail: str = ""
    icon: str = ""
    extended: bool = False  # filled from NWS grid data, not the 7-day text forecast

    @property
    def available(self) -> bool:
        return self.high is not None


GEO = {"Accept": "application/geo+json"}


def fetch_periods() -> tuple[list[dict], str, str]:
    pt = c.get(f"https://api.weather.gov/points/{c.LAT:.4f},{c.LON:.4f}", headers=GEO).json()
    fc = c.get(pt["properties"]["forecast"], headers=GEO).json()
    props = fc["properties"]
    stamp = props.get("updateTime") or props.get("generatedAt", "")
    try:
        t = dt.datetime.fromisoformat(stamp).astimezone(c.TZ)
        stamp = f"{c.fmt_date(t.date())} at {c.fmt_time(t)}"
    except ValueError:
        pass
    return props["periods"], stamp, pt["properties"]["forecastGridData"]


# ---------------------------------------------------------------- grid data

def _duration(s: str) -> dt.timedelta:
    m = re.fullmatch(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?", s)
    if not m:
        raise ValueError(s)
    d, h, mi = (int(x or 0) for x in m.groups())
    return dt.timedelta(days=d, hours=h, minutes=mi)


def _series(prop: dict) -> list[tuple[dt.datetime, dt.datetime, float]]:
    """NWS grid layer -> [(start, end, value)] in local time, values in °F where relevant."""
    out = []
    to_f = prop.get("uom", "").endswith("degC")
    for v in prop.get("values", []):
        if v["value"] is None:
            continue
        start_s, dur = v["validTime"].split("/")
        start = dt.datetime.fromisoformat(start_s).astimezone(c.TZ)
        val = v["value"] * 9 / 5 + 32 if to_f else v["value"]
        out.append((start, start + _duration(dur), val))
    return out


def sky_words(cover: float) -> str:
    # NWS's own sky-cover wording bands.
    if cover <= 12:
        return "sunny"
    if cover <= 37:
        return "mostly sunny"
    if cover <= 62:
        return "partly sunny"
    if cover <= 87:
        return "mostly cloudy"
    return "cloudy"


def grid_day(grid: dict, d: dt.date) -> DayForecast | None:
    """High, morning low, daytime rain chance and sky for one day from grid data."""
    day0 = dt.datetime.combine(d, dt.time(7), c.TZ)
    day1 = dt.datetime.combine(d, dt.time(18), c.TZ)
    highs = [v for s, e, v in _series(grid["maxTemperature"]) if s.date() == d]
    lows = [v for s, e, v in _series(grid["minTemperature"]) if e.date() == d and s < day0]
    if not highs:
        return None
    pops = [v for s, e, v in _series(grid["probabilityOfPrecipitation"]) if s < day1 and e > day0]
    sky = [v for s, e, v in _series(grid["skyCover"]) if s < day1 and e > day0]
    rain = int(round(max(pops))) if pops else 0
    cond = sky_words(sum(sky) / len(sky)) if sky else ""
    if rain >= 60:
        cond = (cond + " with showers likely").strip()
    elif rain >= 20:
        cond = (cond + " with a chance of showers").strip()
    return DayForecast(
        date=d, high=round(highs[0]), low=round(lows[-1]) if lows else None, rain=rain,
        conditions=cond, extended=True,
    )


def _date(p: dict) -> dt.date:
    return dt.datetime.fromisoformat(p["startTime"]).astimezone(c.TZ).date()


def _pop(p: dict | None) -> int | None:
    if not p:
        return None
    v = (p.get("probabilityOfPrecipitation") or {}).get("value")
    return int(v) if v is not None else 0


def daily(periods: list[dict], days: list[dt.date]) -> list[DayForecast]:
    out = []
    for d in days:
        f = DayForecast(date=d)
        day = next((p for p in periods if p["isDaytime"] and _date(p) == d), None)
        # The low students feel that morning is the night that starts the day before.
        night = next((p for p in periods if not p["isDaytime"] and _date(p) == d - dt.timedelta(days=1)), None)
        night = night or next((p for p in periods if not p["isDaytime"] and _date(p) == d), None)
        if day:
            f.high = day["temperature"]
            f.rain = _pop(day)
            f.conditions = day["shortForecast"]
            f.detail = day.get("detailedForecast", "")
            f.icon = day.get("icon", "")
        if night:
            f.low = night["temperature"]
        out.append(f)
    return out


def tidy_conditions(s: str) -> str:
    s = s.strip().lower()
    s = s.replace("t-storms", "thunderstorms")
    s = re.sub(r"\b(slight chance|chance)\b(?! of)", r"\1 of", s)
    parts = [p.strip() for p in s.split(" then ")]
    parts = [("a " + p if p.startswith(("chance", "slight chance")) else p) for p in parts]
    return ", then ".join(parts)


def day_line(f: DayForecast) -> str:
    name = c.DAY_NAMES[f.date.weekday()]
    if not f.available:
        return f"{name}: forecast not out yet. Rerun closer to recording."
    bits = [f"high of {f.high}"]
    if f.low is not None:
        bits.append(f"low of {f.low}")
    temps = ", ".join(bits)
    # Only say what's there: a rain chance, never "no rain".
    if f.rain and f.rain >= 10:
        article = "an" if str(f.rain).startswith(("8", "11", "18")) else "a"
        return f"{name}, {tidy_conditions(f.conditions)}. Expect a {temps}, and {article} {f.rain} percent chance of rain."
    return f"{name}, {tidy_conditions(f.conditions)}. Expect a {temps}."


# ---------------------------------------------------------------- the read
# Written in the show's on-air voice (see the weekly script doc): one sentence
# per day that compares it to the day before, then a sign-off to the RedWolves.

SKY_RE = re.compile(r"^(mostly |partly )?(sunny|cloudy|clear)\b")
WIND_WORDS = {"breezy", "windy", "blustery"}
CHANCE_RE = re.compile(r"^(a )?(slight )?chance of (.+)$")


def feel(high: int) -> str:
    if high >= 95:
        return "scorching"
    if high >= 90:
        return "hot"
    if high >= 80:
        return "warm"
    if high >= 70:
        return "mild"
    if high >= 60:
        return "cool"
    return "chilly"


def _details(f: DayForecast) -> list[str]:
    """['mostly cloudy skies', 'a morning low of 64', 'a 25 percent chance of rain showers']"""
    sky, wet, later = "", "", False
    for i, part in enumerate(tidy_conditions(f.conditions).split(", then ")):
        part = part.strip()
        m = CHANCE_RE.match(part)
        if m:
            wet = wet or m.group(3)
            later = later or i > 0
        elif part in WIND_WORDS and not sky:
            sky = f"{part} conditions"
        elif SKY_RE.match(part) and not sky:
            sky = SKY_RE.sub(lambda x: x.group(0) + " skies", part, count=1)
        elif not sky and not wet:
            sky = part  # e.g. "showers and thunderstorms likely"
    out = [sky] if sky else []
    if f.low is not None:
        out.append(f"a morning low of {f.low}")
    rain = f.rain or 0
    if rain >= 10:
        article = "an" if str(rain).startswith(("8", "11", "18")) else "a"
        out.append(f"{article} {rain} percent chance of {wet or 'rain'}{' later in the day' if later else ''}")
    # A dry day says nothing about rain: "no rain" isn't news.
    return out


def _list(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + ", and " + items[-1]


# South Texas scale: a 58-degree morning is hoodie weather here.
COOL_MORNING = 60      # mention the coolest morning at or below this
JACKET_MORNING = 52
BUNDLE_MORNING = 45
RAIN_WORTH_SAYING = 20  # percent; lower chances aren't mentioned


def _sky(f: DayForecast) -> str:
    """'partly sunny skies', 'breezy conditions', or ''."""
    d = _details(f)
    return d[0] if d and not d[0].startswith(("a morning low", "a ", "an ")) else ""


def _rain(f: DayForecast) -> str:
    """'a 30 percent chance of rain' when worth saying, else ''."""
    if (f.rain or 0) < RAIN_WORTH_SAYING:
        return ""
    return next((d for d in _details(f) if "percent chance" in d), "")


def _groups(days: list[DayForecast]) -> list[list[DayForecast]]:
    """The week as start / midweek / end stretches (five days: 2, 1, 2)."""
    n = len(days)
    sizes = {1: [1], 2: [1, 1], 3: [1, 1, 1], 4: [2, 2], 5: [2, 1, 2]}.get(n) or [n // 3, n - 2 * (n // 3), n // 3]
    out, i = [], 0
    for k in sizes:
        out.append(days[i:i + k])
        i += k
    return out


def _highs(g: list[DayForecast]) -> str:
    """'highs of 72 on Monday and 71 on Tuesday'"""
    return "highs of " + _join([f"{f.high} on {c.DAY_NAMES[f.date.weekday()]}" for f in g])


WET = re.compile(r"rain|shower|storm|drizzle", re.I)


def _under(sky: str) -> str:
    if not sky or WET.search(sky):
        return ""
    return f" under {sky}" if sky.endswith("skies") else f", with {sky}"


def _coolest(days: list[DayForecast]) -> DayForecast | None:
    lows = [f for f in days if f.low is not None and f.low <= COOL_MORNING]
    return min(lows, key=lambda f: f.low) if lows else None


def _quip_is_rain(days: list[DayForecast]) -> bool:
    return any((f.rain or 0) >= 40 for f in days)


def narrative(days: list[DayForecast]) -> list[str]:
    """A short, conversational read: the week in up to three stretches, every
    day's high (graphics and other automation key off them), the coolest
    morning only when it's cool for South Texas, and rain only at 20%+."""
    if not days:
        return []
    groups = _groups(days)
    cool = _coolest(days)
    lines = []
    prev: list[DayForecast] | None = None
    trend = ""
    for i, g in enumerate(groups):
        sky = _sky(g[0])
        if prev is None:
            mood = feel(round(sum(f.high for f in g) / len(g)))
            temps = f"a high of {g[0].high} on {c.DAY_NAMES[g[0].date.weekday()]}" if len(g) == 1 else _highs(g)
            line = f"We're starting the week off {mood}, with {temps}{_under(sky)}."
        else:
            delta = g[-1].high - prev[-1].high
            hot = min(f.high for f in g) >= 90
            if delta >= 3:
                verb, to = ("it gets even hotter", "it gets even hotter, up to") if hot else \
                    ("it keeps warming up", "it keeps warming up, to") if trend == "up" else ("it warms up", "it warms up to")
                trend = "up"
            elif delta <= -3 and not hot:
                verb, to = ("it keeps cooling down", "it keeps cooling down, to") if trend == "down" else \
                    ("it cools down", "it cools down to")
                trend = "down"
            elif hot:
                verb, to = "it stays hot", "it stays hot, around"
            else:
                verb, to = "it stays about the same", "it stays around"
            change = f"{to} {g[0].high}" if len(g) == 1 else f"{verb}, with {_highs(g)}"
            psky = _sky(prev[0])
            if sky != psky and "cloudy" in sky and "cloudy" not in psky:
                change = "the clouds roll in and " + change
            elif sky != psky and "sunny" in sky and "sunny" not in psky:
                change = "the sun comes back out and " + change
            elif sky != psky:
                change += _under(sky)
            names = [c.DAY_NAMES[f.date.weekday()] for f in g]
            if i == len(groups) - 1 and g[-1].date.weekday() == 4 and len(groups) > 1:
                lead = "And as we head into the weekend, "
            else:
                lead = f"By {names[0]}, "
            line = f"{lead}{change}."
        for f in g:
            r = _rain(f)
            if r:
                line += f" There's {r} " + (f"on {c.DAY_NAMES[f.date.weekday()]}." if len(g) > 1 else "that day.")
        if cool and cool in g:
            day = c.DAY_NAMES[cool.date.weekday()]
            if _quip_is_rain(days):
                line += f" {day} morning is the cool one, down to {cool.low}."
            elif cool.low <= BUNDLE_MORNING:
                line += f" {day} morning drops to {cool.low}, so bundle up!"
            elif cool.low <= JACKET_MORNING:
                line += f" {day} morning drops to {cool.low}, so grab a jacket!"
            else:
                line += f" {day} morning dips to {cool.low}. Hoodie weather!"
        lines.append(line)
        prev = g
    return lines


def sign_off(days: list[DayForecast]) -> str:
    """The sign-off, with one quick line about what stands out (if the cool
    morning didn't already get it)."""
    m = c.MASCOT
    if _quip_is_rain(days):
        return f"Keep an umbrella in your backpack, and have a great week, {m}!"
    if not _coolest(days):
        if max(f.high for f in days) >= 95:
            return f"Stay cool and drink plenty of water, {m}!"
        if max(f.high for f in days) >= 90:
            return f"Don't forget your water bottle, and have a great week, {m}!"
    return f"Have a great week, {m}!"


@dataclass
class WeatherResult:
    days: list[DayForecast]
    lines: list[str]
    updated: str
    notes: list[str]

    @property
    def script(self) -> str:
        return "\n".join(self.lines)


def build(week: c.SchoolWeek) -> WeatherResult:
    periods, updated, grid_url = fetch_periods()
    days = daily(periods, week.school_days)
    lines: list[str] = []
    notes: list[str] = []

    # Fill days the 7-day text forecast doesn't reach (and any missing low) from grid data.
    if any(not f.available or f.low is None for f in days):
        try:
            grid = c.get(grid_url, headers=GEO).json()["properties"]
            for i, f in enumerate(days):
                g = grid_day(grid, f.date)
                if g is None:
                    continue
                if not f.available:
                    days[i] = g
                elif f.low is None:
                    f.low = g.low
        except Exception as ex:
            notes.append(f"Could not read NWS grid data for the later days ({ex}).")
    extended = [c.DAY_NAMES[f.date.weekday()] for f in days if f.extended]
    if extended:
        notes.append(
            f"{_join(extended)} comes from NWS grid data because the 7-day text forecast doesn't reach "
            "it yet. These numbers can still change, so rerun the morning of recording."
        )

    if not week.school_days:
        return WeatherResult(days=[], lines=[], updated=updated, notes=["No school days this week, so no forecast read."])
    have = [f for f in days if f.available]
    missing = [c.DAY_NAMES[f.date.weekday()] for f in days if not f.available]
    # Never leave holes in the read: if NWS doesn't reach the end of the week
    # yet, the read covers the days it has and says so.
    intro = "Let's take a look at this week's weather forecast!" if not missing else (
        f"Let's take a look at the weather through {c.DAY_NAMES[have[-1].date.weekday()]}!" if have else "")
    if week.prior_break:
        intro = f"Welcome back from {week.prior_break}! {intro}".strip()
    if intro:
        lines.append(intro)
    if week.closures:
        by_reason: dict[str, list[str]] = {}
        for d, r in sorted(week.closures.items()):
            by_reason.setdefault(r, []).append(c.DAY_NAMES[d.weekday()])
        for r, names in by_reason.items():
            lines.append(f"Remember, there's no school {_join(names)} for {r}.")
    lines += narrative(have)
    if have:
        lines.append(sign_off(have))

    if missing:
        notes.append(
            f"No NWS forecast yet for {_join(missing)} (NWS reaches about 7 days out), so the read stops "
            f"at {c.DAY_NAMES[have[-1].date.weekday()] if have else 'the start of the week'}. "
            "Rerun the morning of recording to get as many days as possible."
        )
    return WeatherResult(days=days, lines=lines, updated=updated, notes=notes)


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def write_outputs(res: WeatherResult, out: Path) -> None:
    with open(out / "weather.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["day", "date", "high", "low", "rain_chance", "conditions", "icon_url"])
        for d in res.days:
            w.writerow([
                c.DAY_NAMES[d.date.weekday()], d.date.isoformat(),
                "" if d.high is None else d.high, "" if d.low is None else d.low,
                "" if d.rain is None else d.rain, d.conditions, d.icon,
            ])
    (out / "weather_read.txt").write_text(res.script + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--week", help="any date in the target week (default: next Monday)")
    args = ap.parse_args()

    from .district_calendar import school_week

    week, _ = school_week(c.parse_week(args.week))
    res = build(week)
    write_outputs(res, c.week_dir(week.monday))
    print(res.script)
    print(f"(NWS forecast updated {res.updated})")
    for n in res.notes:
        print("NOTE:", n)


if __name__ == "__main__":
    main()
