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
    def test_every_days_high_is_said(self):
        # Graphics and other automation key off each day's high.
        text = read(THIS_WEEK)
        for f in THIS_WEEK:
            self.assertRegex(text, rf"\b{f.high}\b on {f.date:%A}|{f.date:%A}.*\b{f.high}\b")
        self.assertIn("highs of 72 on Monday and 71 on Tuesday", text)
        self.assertIn("highs of 80 on Thursday and 83 on Friday", text)

    def test_short_and_conversational(self):
        lines = narrative(THIS_WEEK)
        self.assertLessEqual(len(lines), 3, lines)
        self.assertLessEqual(len(read(THIS_WEEK).split()), 80)
        self.assertIn("as we head into the weekend", read(THIS_WEEK))

    def test_never_says_what_isnt_happening(self):
        self.assertFalse(re.search(r"\bno\b", read(THIS_WEEK), re.I))

    def test_rain_under_20_percent_is_left_out(self):
        self.assertNotIn("percent", read(THIS_WEEK))
        wet = [day(0, 85, 72, 30, "Chance Showers"), day(1, 85, 72, 0)]
        self.assertIn("30 percent chance", read(wet))

    def test_south_texas_cool_morning_gets_one_quip(self):
        text = read(THIS_WEEK)
        self.assertIn("Tuesday morning dips to 58. Hoodie weather!", text)
        self.assertNotIn("Monday morning", text, "only the coolest morning")
        warm = [day(0, 88, 72, 0), day(1, 89, 73, 0)]
        self.assertNotIn("morning", read(warm), "warm mornings aren't mentioned")

    def test_hot_week_never_cools_down_in_the_90s(self):
        hot = [day(1, 95, 77, 0, "Sunny"), day(2, 97, 78, 0, "Sunny"), day(3, 96, 78, 0, "Sunny"), day(4, 94, 77, 0, "Sunny")]
        text = read(hot)
        self.assertNotIn("cools down", text)
        self.assertIn("water", text)

    def test_heavy_rain_quip_and_cool_morning_dont_double_up(self):
        days = [day(0, 70, 55, 50, "Showers Likely"), day(1, 72, 60, 0)]
        text = read(days)
        self.assertIn("umbrella", text)
        self.assertNotIn("Hoodie", text)

    def test_day_line_skips_dry_days_rain(self):
        self.assertNotIn("rain", day_line(day(0, 72, 64, 0)))
        self.assertIn("25 percent chance of rain", day_line(day(0, 72, 64, 25)))
