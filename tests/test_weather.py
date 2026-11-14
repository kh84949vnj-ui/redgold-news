"""Checks on the weather read wording: python -m unittest discover tests"""
import datetime as dt
import unittest

from rgn.weather import DayForecast, narrative

MON = dt.date(2026, 11, 16)


def day(i, high, low, rain, sky="Partly Sunny"):
    return DayForecast(date=MON + dt.timedelta(days=i), high=high, low=low, rain=rain, conditions=sky)


class WeatherRead(unittest.TestCase):
    def test_no_rain_once_per_dry_stretch(self):
        lines = narrative([day(0, 72, 64, 0), day(1, 71, 58, 0), day(2, 77, 62, 0),
                           day(3, 80, 68, 12, "Mostly Cloudy"), day(4, 83, 70, 0, "Mostly Cloudy")])
        said = [("no rain" in l) for l in lines]
        self.assertEqual(said, [True, False, False, False, True], lines)
        self.assertIn("Expect partly sunny skies and a morning low of 58.", lines[1])

    def test_rain_chance_still_read_every_day(self):
        lines = narrative([day(0, 80, 70, 30), day(1, 80, 70, 40)])
        self.assertTrue(all("percent chance" in l for l in lines), lines)
