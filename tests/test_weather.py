"""Checks on the weather read wording: python -m unittest discover tests"""
import datetime as dt
import re
import unittest

from rgn.weather import DayForecast, day_line, narrative

MON = dt.date(2026, 11, 16)


def day(i, high, low, rain, sky="Partly Sunny"):
    return DayForecast(date=MON + dt.timedelta(days=i), high=high, low=low, rain=rain, conditions=sky)


class WeatherRead(unittest.TestCase):
    def test_never_says_what_isnt_happening(self):
        lines = narrative([day(0, 72, 64, 0), day(1, 71, 58, 0), day(2, 77, 62, 0),
                           day(3, 80, 68, 12, "Mostly Cloudy"), day(4, 83, 70, 0, "Mostly Cloudy")])
        self.assertFalse(any(re.search(r"\bno\b", l, re.I) for l in lines), lines)
        self.assertIn("Expect partly sunny skies and a morning low of 64.", lines[0])
        self.assertIn("a 12 percent chance of rain", lines[3])

    def test_day_line_skips_dry_days_rain(self):
        self.assertNotIn("rain", day_line(day(0, 72, 64, 0)))
        self.assertIn("25 percent chance of rain", day_line(day(0, 72, 64, 25)))

    def test_rain_chance_still_read_every_day(self):
        lines = narrative([day(0, 80, 70, 30), day(1, 80, 70, 40)])
        self.assertTrue(all("percent chance" in l for l in lines), lines)
