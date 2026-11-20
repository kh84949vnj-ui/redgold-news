"""Checks on the weather read wording: python -m unittest discover tests"""
import datetime as dt
import re
import unittest

from rgn.weather import DayForecast, day_line, narrative, sign_off

MON = dt.date(2026, 11, 16)


def day(i, high, low, rain, sky="Partly Sunny"):
    return DayForecast(date=MON + dt.timedelta(days=i), high=high, low=low, rain=rain, conditions=sky)


THIS_WEEK = [day(0, 72, 64, 0), day(1, 71, 58, 0), day(2, 77, 62, 0, "Mostly Cloudy"),
             day(3, 80, 68, 12, "Mostly Cloudy"), day(4, 83, 70, 10)]


def read(days):
    return " ".join(narrative(days) + [sign_off(days)])


class WeatherRead(unittest.TestCase):
    def test_every_day_is_named_with_its_high(self):
        # The weather board times each card on the day's name; graphics key off each high.
        text = read(THIS_WEEK)
        for f in THIS_WEEK:
            self.assertRegex(text, rf"{f.date:%A}[^.]*?\b{f.high}\b", f"{f.date:%A} {f.high}")

    def test_flows_like_tv_weather(self):
        lines = narrative(THIS_WEEK)
        self.assertLessEqual(len(lines), 5, lines)
        self.assertLessEqual(len(read(THIS_WEEK).split()), 80)
        self.assertTrue(lines[-1].startswith("And "), lines[-1])
        self.assertNotRegex(read(THIS_WEEK), r"highs of \d+ and \d+", "no numbers-before-days lists")

    def test_quiet_days_share_a_sentence(self):
        days = [day(0, 80, 70, 0), day(1, 81, 70, 0), day(2, 82, 70, 0), day(3, 83, 70, 0), day(4, 84, 70, 0)]
        lines = narrative(days)
        self.assertEqual(len(lines), 4, lines)  # Monday / Tuesday and Wednesday / Thursday / And Friday
        self.assertIn(", and ", lines[1])

    def test_never_says_what_isnt_happening(self):
        self.assertFalse(re.search(r"\bno\b", read(THIS_WEEK), re.I))

    def test_rain_under_20_percent_is_left_out(self):
        self.assertNotIn("percent", read(THIS_WEEK))
        wet = [day(0, 85, 72, 0), day(1, 85, 72, 30, "Chance Showers"), day(2, 85, 72, 0)]
        self.assertIn("Tuesday brings a 30 percent chance", read(wet))

    def test_south_texas_cool_morning_folded_in_with_one_quip(self):
        text = read(THIS_WEEK)
        self.assertIn("after a cool start at 58", text)
        self.assertEqual(text.count("start at"), 1, "only the coolest morning")
        self.assertIn("hoodie", text)
        warm = [day(0, 88, 72, 0), day(1, 89, 73, 0)]
        self.assertNotIn("start at", read(warm), "warm mornings aren't mentioned")

    def test_hot_week_never_cools_down_in_the_90s(self):
        hot = [day(1, 95, 77, 0, "Sunny"), day(2, 97, 78, 0, "Sunny"), day(3, 96, 78, 0, "Sunny"), day(4, 94, 77, 0, "Sunny")]
        text = read(hot)
        self.assertNotIn("cools down", text)
        self.assertIn("water", text)

    def test_heavy_rain_quip_wins_over_cool_morning(self):
        days = [day(0, 70, 55, 50, "Showers Likely"), day(1, 72, 60, 0)]
        text = read(days)
        self.assertIn("umbrella", text)
        self.assertNotIn("hoodie", text)

    def test_day_line_skips_dry_days_rain(self):
        self.assertNotIn("rain", day_line(day(0, 72, 64, 0)))
        self.assertIn("25 percent chance of rain", day_line(day(0, 72, 64, 25)))


class StationReadings(unittest.TestCase):
    def test_today_uses_measured_morning_low_and_past_days_measured_high(self):
        from rgn.weather import apply_observations
        from rgn.common import TZ
        at = lambda d, h, t, sky="Cloudy": (dt.datetime.combine(MON + dt.timedelta(days=d), dt.time(h), TZ), t, sky)
        obs = [at(0, 3, 61.0), at(0, 6, 58.6), at(0, 10, 70.0, "Sunny"), at(0, 14, 74.2, "Sunny"),
               at(1, 2, 60.0), at(1, 7, 59.4), at(1, 8, 62.0)]
        days = [day(0, 80, None, 30), day(1, 81, 54, 10), day(2, 82, 60, 0)]
        now = dt.datetime.combine(MON + dt.timedelta(days=1), dt.time(9), TZ)
        changed = apply_observations(days, obs, now)
        self.assertEqual(changed, ["Monday", "Tuesday"])
        self.assertEqual((days[0].high, days[0].low, days[0].conditions), (74, 59, "Sunny"))  # past day: measured
        self.assertEqual((days[1].high, days[1].low), (81, 59))  # today: forecast high, measured morning low
        self.assertEqual((days[2].high, days[2].low, days[2].observed), (82, 60, False))  # future: untouched
